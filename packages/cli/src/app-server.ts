import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { EvalConfig, ResultsJson, TraceEvent } from '@inspectr/mcplab-core';
import { loadConfig, runAll } from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import pkg from '../package.json' with { type: 'json' };
import {
  applySnapshotPolicyToRunResult,
  buildSnapshotFromRun,
  compareRunToSnapshot,
  listSnapshots,
  loadSnapshot,
  saveSnapshot
} from './snapshot.js';

export interface AppServerOptions {
  host: string;
  port: number;
  configsDir: string;
  runsDir: string;
  snapshotsDir: string;
  librariesDir: string;
  runPresetsDir: string;
  dev: boolean;
  open: boolean;
}

interface AppSettings {
  workspaceRoot: string;
  configsDir: string;
  runsDir: string;
  snapshotsDir: string;
  librariesDir: string;
  runPresetsDir: string;
}

interface ConfigRecord {
  id: string;
  name: string;
  path: string;
  mtime: string;
  hash: string;
  config: EvalConfig;
  error?: string;
}

interface RunSummary {
  runId: string;
  path: string;
  timestamp: string;
  configHash: string;
  totalScenarios: number;
  totalRuns: number;
  passRate: number;
  avgToolCalls: number;
  avgLatencyMs: number;
}

interface RunPresetRecord {
  id: string;
  name: string;
  config_path: string;
  agents: string[];
  scenario_ids: string[];
  runs_per_scenario: number;
  apply_snapshot_eval: boolean;
  created_at: string;
  updated_at: string;
}

interface ProviderModelsResponse {
  provider: 'anthropic' | 'openai' | 'azure';
  items: string[];
  kind: 'models' | 'deployments';
  source: string;
}

type TraceUiEvent =
  | { type: 'scenario_started'; scenario_id: string; ts: string }
  | { type: 'llm_request'; messages_summary: string; ts: string }
  | { type: 'llm_response'; raw_or_summary: string; ts: string }
  | { type: 'tool_call'; scenario_id?: string; tool: string; args?: unknown; ts_start?: string }
  | {
      type: 'tool_result';
      scenario_id?: string;
      tool: string;
      ok: boolean;
      result_summary: string;
      duration_ms?: number;
      ts_end?: string;
    }
  | { type: 'final_answer'; scenario_id?: string; text: string; ts: string }
  | { type: 'scenario_finished'; scenario_id: string; pass: boolean; ts: string };

interface JobEvent {
  type: 'started' | 'log' | 'completed' | 'error';
  ts: string;
  payload: Record<string, unknown>;
}

interface RunJob {
  id: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  events: JobEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
}

function asJson(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(body)}\n`);
}

function asText(res: ServerResponse, code: number, body: string) {
  res.statusCode = code;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

async function fetchProviderModels(provider: string): Promise<ProviderModelsResponse> {
  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic model discovery failed (${response.status}): ${text}`);
    }
    const parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const items = (parsed.data ?? [])
      .map((item) => String(item.id ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { provider: 'anthropic', items, kind: 'models', source: 'anthropic /v1/models' };
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI model discovery failed (${response.status}): ${text}`);
    }
    const parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const items = (parsed.data ?? [])
      .map((item) => String(item.id ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { provider: 'openai', items, kind: 'models', source: 'openai /v1/models' };
  }

  if (provider === 'azure') {
    const envCandidates = [
      process.env.AZURE_OPENAI_DEPLOYMENTS,
      process.env.AZURE_OPENAI_DEPLOYMENT,
      process.env.AZURE_OPENAI_DEPLOYMENT_NAME
    ]
      .flatMap((value) => (value ?? '').split(','))
      .map((item) => item.trim())
      .filter(Boolean);
    const items = Array.from(new Set(envCandidates)).sort((a, b) => a.localeCompare(b));
    if (items.length === 0) {
      throw new Error(
        'Azure OpenAI discovery uses deployment names. Set AZURE_OPENAI_DEPLOYMENTS (comma-separated) or AZURE_OPENAI_DEPLOYMENT.'
      );
    }
    return { provider: 'azure', items, kind: 'deployments', source: 'environment variables' };
  }

  throw new Error(`Unsupported provider for model discovery: ${provider}`);
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on('error', rejectBody);
  });
}

function ensureInsideRoot(rootDir: string, candidatePath: string): string {
  const root = resolve(rootDir);
  const candidate = resolve(candidatePath);
  if (!(candidate === root || candidate.startsWith(`${root}/`))) {
    throw new Error(`Path outside allowed root: ${candidatePath}`);
  }
  return candidate;
}

function encodeConfigId(absPath: string, rootDir: string): string {
  const rel = absPath.slice(resolve(rootDir).length + 1);
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function decodeConfigId(id: string, rootDir: string): string {
  const rel = Buffer.from(id, 'base64url').toString('utf8');
  return ensureInsideRoot(rootDir, join(rootDir, rel));
}

function safeFileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `config-${Date.now()}`
  );
}

function readConfigRecord(absPath: string, configsDir: string, bundleRoot?: string): ConfigRecord {
  const { config: _resolvedConfig, sourceConfig, hash } = loadConfig(absPath, { bundleRoot });
  const stat = statSync(absPath);
  const name = basename(absPath, extname(absPath));
  return {
    id: encodeConfigId(absPath, configsDir),
    name,
    path: absPath,
    mtime: stat.mtime.toISOString(),
    hash,
    config: sourceConfig
  };
}

function emptySourceConfig(): EvalConfig {
  return {
    servers: {},
    server_refs: [],
    agents: {},
    agent_refs: [],
    scenarios: [],
    scenario_refs: []
  };
}

function parseSourceConfigForInvalidRecord(absPath: string): EvalConfig {
  try {
    const raw = readFileSync(absPath, 'utf8');
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return emptySourceConfig();
    }
    const obj = parsed as Record<string, unknown>;
    return {
      servers:
        obj.servers && typeof obj.servers === 'object' && !Array.isArray(obj.servers)
          ? (obj.servers as EvalConfig['servers'])
          : {},
      server_refs: Array.isArray(obj.server_refs)
        ? obj.server_refs.map((v) => String(v))
        : [],
      agents:
        obj.agents && typeof obj.agents === 'object' && !Array.isArray(obj.agents)
          ? (obj.agents as EvalConfig['agents'])
          : {},
      agent_refs: Array.isArray(obj.agent_refs)
        ? obj.agent_refs.map((v) => String(v))
        : [],
      scenarios: Array.isArray(obj.scenarios)
        ? (obj.scenarios as EvalConfig['scenarios'])
        : [],
      scenario_refs: Array.isArray(obj.scenario_refs)
        ? obj.scenario_refs.map((v) => String(v))
        : [],
      snapshot_eval:
        obj.snapshot_eval && typeof obj.snapshot_eval === 'object' && !Array.isArray(obj.snapshot_eval)
          ? (obj.snapshot_eval as EvalConfig['snapshot_eval'])
          : undefined
    };
  } catch {
    return emptySourceConfig();
  }
}

function readConfigRecordOrInvalid(absPath: string, configsDir: string, bundleRoot?: string): ConfigRecord {
  try {
    return readConfigRecord(absPath, configsDir, bundleRoot);
  } catch (error) {
    const stat = statSync(absPath);
    const name = basename(absPath, extname(absPath));
    return {
      id: encodeConfigId(absPath, configsDir),
      name,
      path: absPath,
      mtime: stat.mtime.toISOString(),
      hash: '',
      config: parseSourceConfigForInvalidRecord(absPath),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function listConfigs(configsDir: string, bundleRoot?: string): ConfigRecord[] {
  if (!existsSync(configsDir)) return [];
  const files = readdirSync(configsDir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .map((name) => ensureInsideRoot(configsDir, join(configsDir, name)));
  const records = files.map((path) => readConfigRecordOrInvalid(path, configsDir, bundleRoot));
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

function listRuns(runsDir: string): RunSummary[] {
  if (!existsSync(runsDir)) return [];
  const runDirs = readdirSync(runsDir).map((name) =>
    ensureInsideRoot(runsDir, join(runsDir, name))
  );
  const summaries: RunSummary[] = [];
  for (const dir of runDirs) {
    const resultsPath = join(dir, 'results.json');
    if (!existsSync(resultsPath)) continue;
    try {
      const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
      summaries.push({
        runId: results.metadata.run_id,
        path: dir,
        timestamp: results.metadata.timestamp,
        configHash: results.metadata.config_hash,
        totalScenarios: results.summary.total_scenarios,
        totalRuns: results.summary.total_runs,
        passRate: results.summary.pass_rate,
        avgToolCalls: results.summary.avg_tool_calls_per_run,
        avgLatencyMs: results.summary.avg_tool_latency_ms ?? 0
      });
    } catch {
      // Ignore malformed runs.
    }
  }
  return summaries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function readYamlFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseYaml(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readLibraries(librariesDir: string): {
  servers: EvalConfig['servers'];
  agents: EvalConfig['agents'];
  scenarios: EvalConfig['scenarios'];
} {
  const root = resolve(librariesDir);
  const scenariosDir = join(root, 'scenarios');
  const servers = readYamlFile<EvalConfig['servers']>(join(root, 'servers.yaml'), {});
  const agents = readYamlFile<EvalConfig['agents']>(join(root, 'agents.yaml'), {});
  const scenarios: EvalConfig['scenarios'] = [];
  if (existsSync(scenariosDir)) {
    const files = readdirSync(scenariosDir)
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      const scenarioPath = ensureInsideRoot(scenariosDir, join(scenariosDir, file));
      const parsed = readYamlFile<EvalConfig['scenarios'][number] | null>(scenarioPath, null);
      if (!parsed || typeof parsed !== 'object') continue;
      const id = String(parsed.id ?? basename(file, extname(file)));
      scenarios.push({ ...parsed, id });
    }
  }
  return { servers, agents, scenarios };
}

function writeLibraries(
  librariesDir: string,
  libraries: {
    servers: EvalConfig['servers'];
    agents: EvalConfig['agents'];
    scenarios: EvalConfig['scenarios'];
  }
) {
  const root = resolve(librariesDir);
  const scenariosDir = join(root, 'scenarios');
  mkdirSync(root, { recursive: true });
  mkdirSync(scenariosDir, { recursive: true });

  writeFileSync(join(root, 'servers.yaml'), `${stringifyYaml(libraries.servers ?? {})}\n`, 'utf8');
  writeFileSync(join(root, 'agents.yaml'), `${stringifyYaml(libraries.agents ?? {})}\n`, 'utf8');

  const desired = new Set<string>();
  for (const scenario of libraries.scenarios ?? []) {
    const scenarioId = safeFileName(String(scenario.id ?? `scenario-${Date.now()}`));
    desired.add(`${scenarioId}.yaml`);
    const scenarioPath = ensureInsideRoot(scenariosDir, join(scenariosDir, `${scenarioId}.yaml`));
    writeFileSync(
      scenarioPath,
      `${stringifyYaml({ ...scenario, id: String(scenario.id ?? scenarioId) })}\n`,
      'utf8'
    );
  }

  for (const file of readdirSync(scenariosDir)) {
    if (!(file.endsWith('.yaml') || file.endsWith('.yml'))) continue;
    if (desired.has(file)) continue;
    unlinkSync(ensureInsideRoot(scenariosDir, join(scenariosDir, file)));
  }
}

function encodeRunPresetId(absPath: string, rootDir: string): string {
  const rel = absPath.slice(resolve(rootDir).length + 1);
  return Buffer.from(rel, 'utf8').toString('base64url');
}

function decodeRunPresetId(id: string, rootDir: string): string {
  const rel = Buffer.from(id, 'base64url').toString('utf8');
  return ensureInsideRoot(rootDir, join(rootDir, rel));
}

function normalizeRunPresetRecord(
  value: unknown,
  filePath: string,
  configsDir: string
): RunPresetRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = String(raw.name ?? '').trim();
  const configPath = String(raw.config_path ?? '').trim();
  const runsPerScenario = Number(raw.runs_per_scenario ?? 1);
  if (!name || !configPath || Number.isNaN(runsPerScenario) || runsPerScenario <= 0) return null;

  let safeConfigPath: string;
  try {
    safeConfigPath = ensureInsideRoot(configsDir, configPath);
  } catch {
    return null;
  }

  const stat = statSync(filePath);
  const now = new Date().toISOString();
  return {
    id: String(raw.id ?? encodeRunPresetId(filePath, dirname(filePath))),
    name,
    config_path: safeConfigPath,
    agents: Array.isArray(raw.agents)
      ? raw.agents.map((v) => String(v).trim()).filter(Boolean)
      : [],
    scenario_ids: Array.isArray(raw.scenario_ids)
      ? raw.scenario_ids.map((v) => String(v).trim()).filter(Boolean)
      : [],
    runs_per_scenario: Math.max(1, Math.floor(runsPerScenario)),
    apply_snapshot_eval: raw.apply_snapshot_eval !== false,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : stat.mtime.toISOString(),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : now
  };
}

function readRunPresetRecord(
  absPath: string,
  presetsDir: string,
  configsDir: string
): RunPresetRecord {
  const parsed = readYamlFile<unknown>(absPath, null);
  const record = normalizeRunPresetRecord(parsed, absPath, configsDir);
  if (!record) {
    throw new Error(`Invalid run preset: ${absPath}`);
  }
  return {
    ...record,
    id: encodeRunPresetId(absPath, presetsDir)
  };
}

function listRunPresets(presetsDir: string, configsDir: string): RunPresetRecord[] {
  if (!existsSync(presetsDir)) return [];
  const files = readdirSync(presetsDir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .map((name) => ensureInsideRoot(presetsDir, join(presetsDir, name)));
  const out: RunPresetRecord[] = [];
  for (const file of files) {
    try {
      out.push(readRunPresetRecord(file, presetsDir, configsDir));
    } catch {
      // Ignore malformed preset files to keep UI usable.
    }
  }
  return out.sort((a, b) => {
    const timeDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    return timeDiff !== 0 ? timeDiff : a.name.localeCompare(b.name);
  });
}

function createOrUpdateRunPresetFile(
  presetsDir: string,
  configsDir: string,
  body: unknown,
  currentPath?: string
): { path: string; record: RunPresetRecord } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Missing preset object');
  }
  const raw = body as Record<string, unknown>;
  const name = String(raw.name ?? '').trim();
  const configPath = String(raw.config_path ?? '').trim();
  const runsPerScenario = Number(raw.runs_per_scenario ?? 1);
  if (!name) throw new Error('Preset name is required');
  if (!configPath) throw new Error('config_path is required');
  if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
    throw new Error('runs_per_scenario must be a positive number');
  }
  const safeConfigPath = ensureInsideRoot(configsDir, configPath);
  const agents = Array.isArray(raw.agents)
    ? raw.agents.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const scenarioIds = Array.isArray(raw.scenario_ids)
    ? raw.scenario_ids.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const now = new Date().toISOString();

  mkdirSync(presetsDir, { recursive: true });
  let targetPath = currentPath;
  if (!targetPath) {
    const baseName = safeFileName(name);
    targetPath = ensureInsideRoot(presetsDir, join(presetsDir, `${baseName}.yaml`));
    let suffix = 1;
    while (existsSync(targetPath)) {
      targetPath = ensureInsideRoot(presetsDir, join(presetsDir, `${baseName}-${suffix}.yaml`));
      suffix += 1;
    }
  }

  const existing =
    targetPath && existsSync(targetPath)
      ? readYamlFile<Record<string, unknown>>(targetPath, {})
      : {};
  const record: RunPresetRecord = {
    id:
      typeof existing.id === 'string' && existing.id.trim()
        ? existing.id.trim()
        : `run-preset-${Date.now()}`,
    name,
    config_path: safeConfigPath,
    agents,
    scenario_ids: scenarioIds,
    runs_per_scenario: Math.floor(runsPerScenario),
    apply_snapshot_eval: raw.apply_snapshot_eval !== false,
    created_at:
      typeof existing.created_at === 'string' && existing.created_at.trim()
        ? existing.created_at
        : now,
    updated_at: now
  };

  writeFileSync(targetPath!, `${stringifyYaml(record)}\n`, 'utf8');
  return {
    path: targetPath!,
    record: readRunPresetRecord(targetPath!, presetsDir, configsDir)
  };
}

function getRunResults(runId: string, runsDir: string): ResultsJson {
  const runDir = ensureInsideRoot(runsDir, join(runsDir, runId));
  const resultsPath = ensureInsideRoot(runsDir, join(runDir, 'results.json'));
  if (!existsSync(resultsPath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  return JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
}

function selectScenarioIds(config: EvalConfig, requestedScenarioIds?: string[]): EvalConfig {
  if (!requestedScenarioIds || requestedScenarioIds.length === 0) return config;
  const requested = requestedScenarioIds.map((id) => id.trim()).filter(Boolean);
  if (requested.length === 0) return config;
  const requestedSet = new Set(requested);
  const scenarios = config.scenarios.filter((scenario) => requestedSet.has(scenario.id));
  const foundSet = new Set(scenarios.map((scenario) => scenario.id));
  const missing = requested.filter((id) => !foundSet.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Unknown scenarios: ${missing.join(', ')}. Available: ${config.scenarios.map((s) => s.id).join(', ')}`
    );
  }
  return { ...config, scenarios };
}

function getTraceEvents(runId: string, runsDir: string): TraceEvent[] {
  const runDir = ensureInsideRoot(runsDir, join(runsDir, runId));
  const tracePath = ensureInsideRoot(runsDir, join(runDir, 'trace.jsonl'));
  if (!existsSync(tracePath)) return [];
  const lines = readFileSync(tracePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const events: TraceEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as TraceEvent);
    } catch {
      // Ignore malformed lines.
    }
  }
  return events;
}

function toTraceUiEvents(events: TraceEvent[]): TraceUiEvent[] {
  const normalized: TraceUiEvent[] = [];
  let activeScenarioId: string | undefined;
  let pending:
    | { scenario_id?: string; tool: string; args?: unknown; ts_start?: string }
    | undefined;

  for (const event of events) {
    if (event.type === 'scenario_started') {
      activeScenarioId = event.scenario_id;
      normalized.push({
        type: 'scenario_started',
        scenario_id: event.scenario_id,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'llm_request') {
      normalized.push({
        type: 'llm_request',
        messages_summary: event.messages_summary,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'llm_response') {
      normalized.push({
        type: 'llm_response',
        raw_or_summary: event.raw_or_summary,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'scenario_finished') {
      normalized.push({
        type: 'scenario_finished',
        scenario_id: event.scenario_id,
        pass: event.pass,
        ts: event.ts
      });
      activeScenarioId = undefined;
      continue;
    }
    if (event.type === 'tool_call') {
      pending = {
        scenario_id: activeScenarioId,
        tool: event.tool,
        args: event.args,
        ts_start: event.ts_start
      };
      normalized.push({
        type: 'tool_call',
        scenario_id: activeScenarioId,
        tool: event.tool,
        args: event.args,
        ts_start: event.ts_start
      });
      continue;
    }
    if (event.type === 'tool_result' && pending && pending.tool === event.tool) {
      normalized.push({
        type: 'tool_result',
        scenario_id: pending.scenario_id,
        tool: event.tool,
        ok: event.ok,
        result_summary: event.result_summary,
        duration_ms: event.duration_ms,
        ts_end: event.ts_end
      });
      pending = undefined;
      continue;
    }
    if (event.type === 'final_answer') {
      normalized.push({
        type: 'final_answer',
        scenario_id: activeScenarioId,
        text: event.text,
        ts: event.ts
      });
    }
  }
  return normalized;
}

function sendSseEvent(res: ServerResponse, event: JobEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function addJobEvent(job: RunJob, event: JobEvent) {
  job.events.push(event);
  for (const client of job.clients) {
    sendSseEvent(client, event);
  }
}

function expandConfigForAgents(config: EvalConfig, requestedAgents?: string[]): EvalConfig {
  const selectedAgents =
    requestedAgents && requestedAgents.length > 0 ? requestedAgents : Object.keys(config.agents);
  const missing = selectedAgents.filter((agent) => !config.agents[agent]);
  if (missing.length > 0) {
    throw new Error(
      `Unknown agents: ${missing.join(', ')}. Available: ${Object.keys(config.agents).join(', ')}`
    );
  }
  const expandedScenarios = [];
  for (const scenario of config.scenarios) {
    const pinnedAgent = scenario.agent?.trim();
    const targetAgents = pinnedAgent
      ? selectedAgents.includes(pinnedAgent)
        ? [pinnedAgent]
        : []
      : selectedAgents;
    for (const agent of targetAgents) {
      expandedScenarios.push({
        ...scenario,
        id: `${scenario.id}-${agent}`,
        agent
      });
    }
  }
  return {
    ...config,
    scenarios: expandedScenarios
  };
}

function startBrowser(url: string) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

function mapContentType(pathname: string): string {
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

async function proxyToVite(
  req: IncomingMessage,
  res: ServerResponse,
  target: string,
  pathname: string,
  search: string
) {
  const url = `${target}${pathname}${search}`;
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    } else {
      headers.set(key, value);
    }
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : req;
  const response = await fetch(url, { method, headers, body: body as any, duplex: 'half' } as any);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body as any) {
    res.write(chunk);
  }
  res.end();
}

function serveStatic(appDist: string, pathname: string, res: ServerResponse) {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const requested = ensureInsideRoot(appDist, join(appDist, cleanPath));
  const filePath =
    existsSync(requested) && statSync(requested).isFile()
      ? requested
      : ensureInsideRoot(appDist, join(appDist, 'index.html'));
  if (!existsSync(filePath)) {
    asText(
      res,
      500,
      `Missing app build at ${appDist}. Run "npm run build -w @inspectr/mcplab-app".`
    );
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', mapContentType(filePath));
  createReadStream(filePath).pipe(res);
}

export async function startAppServer(options: AppServerOptions) {
  const workspaceRoot = process.cwd();
  const settings: AppSettings = {
    workspaceRoot,
    configsDir: resolve(options.configsDir),
    runsDir: resolve(options.runsDir),
    snapshotsDir: resolve(options.snapshotsDir),
    librariesDir: resolve(options.librariesDir),
    runPresetsDir: resolve(options.runPresetsDir)
  };
  mkdirSync(settings.configsDir, { recursive: true });
  mkdirSync(settings.runsDir, { recursive: true });
  mkdirSync(settings.snapshotsDir, { recursive: true });
  mkdirSync(settings.librariesDir, { recursive: true });
  mkdirSync(join(settings.librariesDir, 'scenarios'), { recursive: true });
  mkdirSync(settings.runPresetsDir, { recursive: true });

  const appDist = resolve(workspaceRoot, 'packages', 'app', 'dist');
  const viteDevTarget = 'http://127.0.0.1:8685';
  const jobs = new Map<string, RunJob>();
  let activeJobId: string | null = null;

  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      if (pathname === '/api/health' && method === 'GET') {
        asJson(res, 200, { ok: true, version: pkg.version });
        return;
      }

      if (pathname === '/api/providers/models' && method === 'GET') {
        const provider = String(url.searchParams.get('provider') ?? '').trim();
        if (!provider) {
          asJson(res, 400, { error: 'provider is required (anthropic|openai|azure)' });
          return;
        }
        try {
          asJson(res, 200, await fetchProviderModels(provider));
        } catch (error: any) {
          asJson(res, 400, { error: error?.message ?? String(error) });
        }
        return;
      }

      if (pathname === '/api/settings' && method === 'GET') {
        asJson(res, 200, settings);
        return;
      }

      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await parseBody(req);
        if (body.configsDir) {
          settings.configsDir = resolve(String(body.configsDir));
          mkdirSync(settings.configsDir, { recursive: true });
        }
        if (body.runsDir) {
          settings.runsDir = resolve(String(body.runsDir));
          mkdirSync(settings.runsDir, { recursive: true });
        }
        if (body.snapshotsDir) {
          settings.snapshotsDir = resolve(String(body.snapshotsDir));
          mkdirSync(settings.snapshotsDir, { recursive: true });
        }
        if (body.librariesDir) {
          settings.librariesDir = resolve(String(body.librariesDir));
          mkdirSync(settings.librariesDir, { recursive: true });
          mkdirSync(join(settings.librariesDir, 'scenarios'), { recursive: true });
        }
        if (body.runPresetsDir) {
          settings.runPresetsDir = resolve(String(body.runPresetsDir));
          mkdirSync(settings.runPresetsDir, { recursive: true });
        }
        asJson(res, 200, settings);
        return;
      }

      if (pathname === '/api/libraries' && method === 'GET') {
        asJson(res, 200, readLibraries(settings.librariesDir));
        return;
      }

      if (pathname === '/api/libraries' && method === 'PUT') {
        const body = await parseBody(req);
        writeLibraries(settings.librariesDir, {
          servers: (body.servers as EvalConfig['servers']) ?? {},
          agents: (body.agents as EvalConfig['agents']) ?? {},
          scenarios: (body.scenarios as EvalConfig['scenarios']) ?? []
        });
        asJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/run-presets' && method === 'GET') {
        asJson(res, 200, listRunPresets(settings.runPresetsDir, settings.configsDir));
        return;
      }

      if (pathname === '/api/run-presets' && method === 'POST') {
        const body = await parseBody(req);
        const { record } = createOrUpdateRunPresetFile(
          settings.runPresetsDir,
          settings.configsDir,
          body.preset ?? body
        );
        asJson(res, 201, record);
        return;
      }

      if (pathname.startsWith('/api/run-presets/') && method === 'GET') {
        const id = pathname.replace('/api/run-presets/', '');
        const filePath = decodeRunPresetId(id, settings.runPresetsDir);
        asJson(
          res,
          200,
          readRunPresetRecord(filePath, settings.runPresetsDir, settings.configsDir)
        );
        return;
      }

      if (pathname.startsWith('/api/run-presets/') && method === 'PUT') {
        const id = pathname.replace('/api/run-presets/', '');
        const filePath = decodeRunPresetId(id, settings.runPresetsDir);
        if (!existsSync(filePath)) {
          asJson(res, 404, { error: 'Run preset not found' });
          return;
        }
        const body = await parseBody(req);
        const { record } = createOrUpdateRunPresetFile(
          settings.runPresetsDir,
          settings.configsDir,
          body.preset ?? body,
          filePath
        );
        asJson(res, 200, record);
        return;
      }

      if (pathname.startsWith('/api/run-presets/') && method === 'DELETE') {
        const id = pathname.replace('/api/run-presets/', '');
        const filePath = decodeRunPresetId(id, settings.runPresetsDir);
        if (!existsSync(filePath)) {
          asJson(res, 404, { error: 'Run preset not found' });
          return;
        }
        unlinkSync(filePath);
        asJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/snapshots' && method === 'GET') {
        asJson(res, 200, listSnapshots(settings.snapshotsDir));
        return;
      }

      if (pathname === '/api/snapshots' && method === 'POST') {
        const body = await parseBody(req);
        const runId = String(body.runId ?? '').trim();
        const name = body.name ? String(body.name) : undefined;
        if (!runId) {
          asJson(res, 400, { error: 'runId is required' });
          return;
        }
        const results = getRunResults(runId, settings.runsDir);
        const snapshot = buildSnapshotFromRun(results, name);
        saveSnapshot(snapshot, settings.snapshotsDir);
        asJson(res, 201, snapshot);
        return;
      }

      if (pathname === '/api/snapshots/generate-eval' && method === 'POST') {
        const body = await parseBody(req);
        const runId = String(body.runId ?? '').trim();
        const configId = String(body.configId ?? '').trim();
        const name = body.name ? String(body.name) : undefined;
        if (!runId) {
          asJson(res, 400, { error: 'runId is required' });
          return;
        }
        if (!configId) {
          asJson(res, 400, { error: 'configId is required' });
          return;
        }
        const results = getRunResults(runId, settings.runsDir);
        const snapshot = buildSnapshotFromRun(results, name);
        saveSnapshot(snapshot, settings.snapshotsDir);

        const configPath = decodeConfigId(configId, settings.configsDir);
        const { sourceConfig } = loadConfig(configPath, { bundleRoot: settings.librariesDir });
        const nextConfig: EvalConfig = {
          ...sourceConfig,
          snapshot_eval: {
            enabled: true,
            mode: sourceConfig.snapshot_eval?.mode ?? 'warn',
            baseline_snapshot_id: snapshot.id,
            baseline_source_run_id: runId,
            last_updated_at: new Date().toISOString()
          }
        };
        writeFileSync(configPath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
        asJson(res, 201, {
          snapshot,
          config: readConfigRecord(configPath, settings.configsDir, settings.librariesDir)
        });
        return;
      }

      if (pathname.startsWith('/api/snapshots/') && method === 'GET') {
        const snapshotId = pathname.replace('/api/snapshots/', '');
        asJson(res, 200, loadSnapshot(snapshotId, settings.snapshotsDir));
        return;
      }

      if (
        pathname.startsWith('/api/snapshots/') &&
        pathname.endsWith('/compare') &&
        method === 'POST'
      ) {
        const snapshotId = pathname.split('/')[3];
        const body = await parseBody(req);
        const runId = String(body.runId ?? '').trim();
        if (!runId) {
          asJson(res, 400, { error: 'runId is required' });
          return;
        }
        const snapshot = loadSnapshot(snapshotId, settings.snapshotsDir);
        const run = getRunResults(runId, settings.runsDir);
        const comparison = compareRunToSnapshot(run, snapshot);
        asJson(res, 200, comparison);
        return;
      }

      if (pathname === '/api/configs' && method === 'GET') {
        asJson(res, 200, listConfigs(settings.configsDir, settings.librariesDir));
        return;
      }

      if (pathname === '/api/configs' && method === 'POST') {
        const body = await parseBody(req);
        const config = body.config as EvalConfig | undefined;
        if (!config || typeof config !== 'object') {
          asJson(res, 400, { error: 'Missing config object' });
          return;
        }
        const baseName = safeFileName(body.fileName ?? `config-${Date.now()}`);
        let filePath = ensureInsideRoot(
          settings.configsDir,
          join(settings.configsDir, `${baseName}.yaml`)
        );
        let suffix = 1;
        while (existsSync(filePath)) {
          filePath = ensureInsideRoot(
            settings.configsDir,
            join(settings.configsDir, `${baseName}-${suffix}.yaml`)
          );
          suffix += 1;
        }
        writeFileSync(filePath, `${stringifyYaml(config)}\n`, 'utf8');
        asJson(res, 201, readConfigRecord(filePath, settings.configsDir, settings.librariesDir));
        return;
      }

      if (pathname.startsWith('/api/configs/') && method === 'GET') {
        const id = pathname.replace('/api/configs/', '');
        const filePath = decodeConfigId(id, settings.configsDir);
        asJson(res, 200, readConfigRecordOrInvalid(filePath, settings.configsDir, settings.librariesDir));
        return;
      }

      if (
        pathname.startsWith('/api/configs/') &&
        pathname.endsWith('/snapshot-policy') &&
        method === 'POST'
      ) {
        const id = pathname.replace('/api/configs/', '').replace('/snapshot-policy', '');
        const filePath = decodeConfigId(id, settings.configsDir);
        if (!existsSync(filePath)) {
          asJson(res, 404, { error: 'Config not found' });
          return;
        }
        const body = await parseBody(req);
        const enabled = Boolean(body.enabled);
        const mode = String(body.mode ?? 'warn');
        if (mode !== 'warn' && mode !== 'fail_on_drift') {
          asJson(res, 400, { error: 'mode must be warn or fail_on_drift' });
          return;
        }
        const { sourceConfig } = loadConfig(filePath, { bundleRoot: settings.librariesDir });
        const nextSnapshotEval: NonNullable<EvalConfig['snapshot_eval']> = {
          enabled,
          mode,
          baseline_snapshot_id:
            body.baselineSnapshotId !== undefined
              ? String(body.baselineSnapshotId || '')
              : sourceConfig.snapshot_eval?.baseline_snapshot_id,
          baseline_source_run_id:
            body.baselineSourceRunId !== undefined
              ? String(body.baselineSourceRunId || '')
              : sourceConfig.snapshot_eval?.baseline_source_run_id,
          last_updated_at: new Date().toISOString()
        };
        if (!nextSnapshotEval.baseline_snapshot_id) {
          delete nextSnapshotEval.baseline_snapshot_id;
        }
        if (!nextSnapshotEval.baseline_source_run_id) {
          delete nextSnapshotEval.baseline_source_run_id;
        }
        const nextConfig: EvalConfig = {
          ...sourceConfig,
          snapshot_eval: nextSnapshotEval
        };
        writeFileSync(filePath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
        asJson(res, 200, readConfigRecord(filePath, settings.configsDir, settings.librariesDir));
        return;
      }

      if (pathname.startsWith('/api/configs/') && method === 'PUT') {
        const id = pathname.replace('/api/configs/', '');
        const currentPath = decodeConfigId(id, settings.configsDir);
        if (!existsSync(currentPath)) {
          asJson(res, 404, { error: 'Config not found' });
          return;
        }
        const body = await parseBody(req);
        const config = body.config as EvalConfig | undefined;
        if (!config || typeof config !== 'object') {
          asJson(res, 400, { error: 'Missing config object' });
          return;
        }
        let targetPath = currentPath;
        const nextFileName = String(body.fileName ?? '').trim();
        if (nextFileName) {
          const baseName = safeFileName(nextFileName);
          const desiredPath = ensureInsideRoot(
            settings.configsDir,
            join(settings.configsDir, `${baseName}.yaml`)
          );
          if (desiredPath !== currentPath) {
            let uniquePath = desiredPath;
            let suffix = 1;
            while (existsSync(uniquePath)) {
              uniquePath = ensureInsideRoot(
                settings.configsDir,
                join(settings.configsDir, `${baseName}-${suffix}.yaml`)
              );
              suffix += 1;
            }
            renameSync(currentPath, uniquePath);
            targetPath = uniquePath;
          }
        }
        writeFileSync(targetPath, `${stringifyYaml(config)}\n`, 'utf8');
        asJson(res, 200, readConfigRecord(targetPath, settings.configsDir, settings.librariesDir));
        return;
      }

      if (pathname.startsWith('/api/configs/') && method === 'DELETE') {
        const id = pathname.replace('/api/configs/', '');
        const filePath = decodeConfigId(id, settings.configsDir);
        if (!existsSync(filePath)) {
          asJson(res, 404, { error: 'Config not found' });
          return;
        }
        unlinkSync(filePath);
        asJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/runs' && method === 'GET') {
        asJson(res, 200, listRuns(settings.runsDir));
        return;
      }

      if (pathname.startsWith('/api/runs/') && pathname.endsWith('/trace') && method === 'GET') {
        const runId = pathname.split('/')[3];
        const normalized = toTraceUiEvents(getTraceEvents(runId, settings.runsDir));
        asJson(res, 200, { runId, events: normalized });
        return;
      }

      if (
        pathname.startsWith('/api/runs/jobs/') &&
        pathname.endsWith('/events') &&
        method === 'GET'
      ) {
        const jobId = pathname.split('/')[4];
        const job = jobs.get(jobId);
        if (!job) {
          asJson(res, 404, { error: 'Job not found' });
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.flushHeaders();
        for (const event of job.events) {
          sendSseEvent(res, event);
        }
        if (job.status !== 'running') {
          res.end();
          return;
        }
        job.clients.add(res);
        req.on('close', () => {
          job.clients.delete(res);
        });
        return;
      }

      if (
        pathname.startsWith('/api/runs/jobs/') &&
        pathname.endsWith('/stop') &&
        method === 'POST'
      ) {
        const jobId = pathname.split('/')[4];
        const job = jobs.get(jobId);
        if (!job) {
          asJson(res, 404, { error: 'Job not found' });
          return;
        }
        if (job.status !== 'running') {
          asJson(res, 200, { ok: true, status: job.status });
          return;
        }
        job.abortController.abort();
        job.status = 'stopped';
        activeJobId = null;
        asJson(res, 200, { ok: true, status: 'stopped' });
        return;
      }

      if (pathname === '/api/runs' && method === 'POST') {
        if (activeJobId) {
          asJson(res, 409, { error: 'Another run is already active', jobId: activeJobId });
          return;
        }
        const body = await parseBody(req);
        const configPathRaw = String(body.configPath ?? '');
        const runsPerScenario = Number(body.runsPerScenario ?? 1);
        const scenarioId = body.scenarioId ? String(body.scenarioId) : undefined;
        const scenarioIds = Array.isArray(body.scenarioIds)
          ? body.scenarioIds.map((id: unknown) => String(id).trim()).filter(Boolean)
          : undefined;
        const requestedAgents = Array.isArray(body.agents)
          ? body.agents.map((agent: unknown) => String(agent).trim()).filter(Boolean)
          : undefined;
        const applySnapshotEval = body.applySnapshotEval !== false;

        if (!configPathRaw) {
          asJson(res, 400, { error: 'configPath is required' });
          return;
        }
        if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
          asJson(res, 400, { error: 'runsPerScenario must be a positive number' });
          return;
        }

        const configPath = isAbsolute(configPathRaw)
          ? ensureInsideRoot(settings.configsDir, configPathRaw)
          : ensureInsideRoot(settings.configsDir, join(settings.configsDir, configPathRaw));
        if (!existsSync(configPath)) {
          asJson(res, 404, { error: `Config not found: ${configPath}` });
          return;
        }

        const jobId = `${Date.now()}`;
        const job: RunJob = {
          id: jobId,
          status: 'running',
          events: [],
          clients: new Set(),
          abortController: new AbortController()
        };
        jobs.set(jobId, job);
        activeJobId = jobId;

        addJobEvent(job, {
          type: 'started',
          ts: new Date().toISOString(),
          payload: {
            configPath,
            runsPerScenario,
            scenarioId: scenarioId ?? null,
            scenarioIds: scenarioIds ?? null,
            agents: requestedAgents ?? null
          }
        });

        void (async () => {
          try {
            const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
            const selectedBaseScenarios = selectScenarioIds(
              loaded.config,
              scenarioIds && scenarioIds.length > 0
                ? scenarioIds
                : scenarioId
                  ? [scenarioId]
                  : undefined
            );
            const expandedConfig = expandConfigForAgents(selectedBaseScenarios, requestedAgents);
            const cwdBefore = process.cwd();
            process.chdir(settings.workspaceRoot);
            try {
              const { runDir, results } = await runAll(expandedConfig, {
                runsPerScenario,
                scenarioId,
                configHash: loaded.hash,
                cliVersion: pkg.version,
                runsDir: settings.runsDir,
                signal: job.abortController.signal
              });
              if (applySnapshotEval && expandedConfig.snapshot_eval?.enabled) {
                const policy = expandedConfig.snapshot_eval;
                if (policy.baseline_snapshot_id) {
                  const snapshot = loadSnapshot(policy.baseline_snapshot_id, settings.snapshotsDir);
                  const comparison = compareRunToSnapshot(results, snapshot);
                  const enabledScenarioIds = new Set(
                    expandedConfig.scenarios
                      .filter((scenario) => scenario.snapshot_eval_enabled !== false)
                      .map((scenario) => scenario.id)
                  );
                  applySnapshotPolicyToRunResult({
                    results,
                    comparison,
                    policy,
                    enabledScenarioIds
                  });
                } else {
                  addJobEvent(job, {
                    type: 'log',
                    ts: new Date().toISOString(),
                    payload: {
                      message: 'Snapshot eval enabled but baseline_snapshot_id is missing.'
                    }
                  });
                }
              }
              writeFileSync(
                join(runDir, 'results.json'),
                `${JSON.stringify(results, null, 2)}\n`,
                'utf8'
              );
              writeFileSync(join(runDir, 'report.html'), renderReport(results), 'utf8');
              addJobEvent(job, {
                type: 'completed',
                ts: new Date().toISOString(),
                payload: {
                  runId: results.metadata.run_id,
                  runDir,
                  summary: results.summary,
                  snapshotEval: results.metadata.snapshot_eval ?? null
                }
              });
              job.status = 'completed';
            } finally {
              process.chdir(cwdBefore);
            }
          } catch (error: any) {
            const aborted = job.abortController.signal.aborted || job.status === 'stopped';
            addJobEvent(job, {
              type: 'error',
              ts: new Date().toISOString(),
              payload: {
                message: aborted ? 'Run aborted by user' : (error?.message ?? String(error))
              }
            });
            job.status = aborted ? 'stopped' : 'error';
          } finally {
            activeJobId = null;
            for (const client of job.clients) {
              client.end();
            }
            job.clients.clear();
          }
        })();

        asJson(res, 202, { jobId });
        return;
      }

      if (pathname.startsWith('/api/runs/') && method === 'GET') {
        const runId = pathname.replace('/api/runs/', '');
        asJson(res, 200, {
          runId,
          results: getRunResults(runId, settings.runsDir)
        });
        return;
      }

      if (pathname.startsWith('/api/')) {
        asJson(res, 404, { error: 'Not found' });
        return;
      }

      if (options.dev) {
        await proxyToVite(req, res, viteDevTarget, pathname, url.search);
        return;
      }

      serveStatic(appDist, pathname, res);
    } catch (error: any) {
      asJson(res, 500, { error: error?.message ?? String(error) });
    }
  });

  await new Promise<void>((resolveReady) => {
    server.listen(options.port, options.host, () => resolveReady());
  });

  const url = `http://${options.host}:${options.port}`;
  // eslint-disable-next-line no-console
  console.log(`mcplab app running at ${url}`);
  // eslint-disable-next-line no-console
  console.log(`  configs: ${settings.configsDir}`);
  // eslint-disable-next-line no-console
  console.log(`  runs:    ${settings.runsDir}`);
  // eslint-disable-next-line no-console
  console.log(`  libs:    ${settings.librariesDir}`);

  if (options.open) {
    startBrowser(url);
  }
}
