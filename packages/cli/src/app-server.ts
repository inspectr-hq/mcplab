import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  AgentConfig,
  EvalConfig,
  ExecutableEvalConfig,
  LlmMessage,
  ResultsJson,
  ToolDef,
  TraceEvent
} from '@inspectr/mcplab-core';
import { chatWithAgent, loadConfig, McpClientManager, runAll } from '@inspectr/mcplab-core';
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
  dev: boolean;
  open: boolean;
}

interface AppSettings {
  workspaceRoot: string;
  configsDir: string;
  runsDir: string;
  snapshotsDir: string;
  librariesDir: string;
  scenarioAssistantAgentName?: string;
}

interface ConfigRecord {
  id: string;
  name: string;
  path: string;
  mtime: string;
  hash: string;
  config: EvalConfig;
  error?: string;
  warnings?: string[];
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

interface ToolAnalysisFinding {
  id: string;
  scope:
    | 'tool_name'
    | 'description'
    | 'schema'
    | 'ergonomics'
    | 'safety'
    | 'eval_readiness'
    | 'execution';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  suggestion?: string;
}

interface ToolAnalysisSuggestedSchemaChange {
  type: 'description' | 'parameter' | 'required' | 'enum' | 'constraints' | 'examples' | 'naming';
  summary: string;
  before?: string;
  after?: string;
}

interface ToolAnalysisToolReport {
  serverName: string;
  toolName: string;
  publicToolName: string;
  description?: string;
  inputSchema?: unknown;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
  metadataReview?: {
    strengths: string[];
    issues: ToolAnalysisFinding[];
    suggestedDescription?: string;
    suggestedSchemaChanges: ToolAnalysisSuggestedSchemaChange[];
    evalReadinessNotes: string[];
  };
  deeperAnalysis?: {
    attempted: boolean;
    skippedReason?: string;
    sampleCalls: Array<{
      callIndex: number;
      arguments: unknown;
      ok: boolean;
      durationMs?: number;
      resultPreview?: string;
      error?: string;
      observations: string[];
      issues: ToolAnalysisFinding[];
    }>;
    overallObservations: string[];
  };
  overallRecommendations: string[];
}

type ToolAnalysisSampleCall = NonNullable<
  ToolAnalysisToolReport['deeperAnalysis']
>['sampleCalls'][number];

interface ToolAnalysisServerReport {
  serverName: string;
  toolCountDiscovered: number;
  toolCountAnalyzed: number;
  toolCountSkipped: number;
  warnings: string[];
  tools: ToolAnalysisToolReport[];
}

interface ToolAnalysisReport {
  schemaVersion: 1;
  createdAt: string;
  assistantAgentName: string;
  assistantAgentModel: string;
  modes: {
    metadataReview: boolean;
    deeperAnalysis: boolean;
  };
  settings: {
    autoRunPolicy?: 'read_only_allowlist';
    sampleCallsPerTool?: number;
    toolCallTimeoutMs?: number;
  };
  summary: {
    serversAnalyzed: number;
    toolsAnalyzed: number;
    toolsSkipped: number;
    issueCounts: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
    };
  };
  servers: ToolAnalysisServerReport[];
  findings: ToolAnalysisFinding[];
}

interface ToolAnalysisDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
}

interface ToolAnalysisJob {
  id: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  events: JobEvent[];
  clients: Set<ServerResponse>;
  abortController: AbortController;
  result?: ToolAnalysisReport;
}

interface DevMcpServerRuntime {
  host: string;
  port: number;
  path: string;
  targetBaseUrl: string;
  stop: () => void;
}

interface ToolAnalysisToolContext {
  serverName: string;
  tool: ToolDef;
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
}

interface ScenarioAssistantContextInput {
  configSnapshotPolicy?: {
    enabled?: boolean;
    mode?: 'warn' | 'fail_on_drift';
    baselineSnapshotId?: string;
  };
  scenario: {
    id: string;
    name?: string;
    prompt: string;
    serverNames: string[];
    evalRules: Array<{ type: string; value: string }>;
    extractRules: Array<{ name: string; pattern: string }>;
    snapshotEval?: {
      enabled?: boolean;
      baselineSnapshotId?: string;
    };
  };
  availableServers?: Array<{ name: string; url?: string }>;
  availableAgents?: Array<{ name: string; provider: string; model: string }>;
}

interface ScenarioAssistantSuggestionBundle {
  prompt?: { replacement: string; rationale?: string };
  evalRules?: {
    replacement: Array<{ type: string; value: string }>;
    rationale?: string;
  };
  extractRules?: {
    replacement: Array<{ name: string; pattern: string }>;
    rationale?: string;
  };
  snapshotEval?: {
    patch: {
      enabled?: boolean;
      baselineSnapshotId?: string;
    };
    rationale?: string;
  };
  notes?: string[];
}

interface AssistantPendingToolCall {
  id: string;
  server: string;
  tool: string;
  publicToolName: string;
  arguments: unknown;
  status: 'pending' | 'approved' | 'denied' | 'error';
  createdAt: string;
  resultPreview?: string;
  error?: string;
}

interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  pendingToolCallId?: string;
}

interface ScenarioAssistantSession {
  id: string;
  createdAt: number;
  lastTouchedAt: number;
  configPath?: string;
  selectedAssistantAgentName: string;
  context: ScenarioAssistantContextInput;
  agentConfig: AgentConfig;
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  pendingToolCalls: AssistantPendingToolCall[];
  chatMessages: AssistantChatMessage[];
  llmMessages: LlmMessage[];
  warnings: string[];
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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maybeStartDevMcpServer(
  workspaceRoot: string,
  enabled: boolean
): DevMcpServerRuntime | null {
  if (!enabled) return null;
  if (String(process.env.MCPLAB_APP_DEV_START_MCP ?? '1') === '0') return null;

  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = parsePositiveInt(process.env.MCP_PORT, 3011);
  const path = process.env.MCP_PATH || '/mcp';
  const sourceEntry = resolve(workspaceRoot, 'packages', 'mcp-server', 'src', 'index.ts');
  const distEntry = resolve(workspaceRoot, 'packages', 'mcp-server', 'dist', 'index.js');
  const useTsx = existsSync(sourceEntry);
  const command = useTsx ? 'tsx' : process.execPath;
  const args = useTsx ? [sourceEntry] : [distEntry];

  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      MCP_HOST: host,
      MCP_PORT: String(port),
      MCP_PATH: path
    },
    stdio: 'inherit'
  });

  child.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error(`[mcplab app] failed to start MCP server child: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    // eslint-disable-next-line no-console
    console.log(
      `[mcplab app] MCP server child exited (${signal ? `signal ${signal}` : `code ${code ?? 0}`})`
    );
  });

  return {
    host,
    port,
    path,
    targetBaseUrl: `http://${host}:${port}`,
    stop: () => {
      if (child.killed || child.exitCode !== null) return;
      child.kill('SIGTERM');
    }
  };
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

interface AppSettingsOverrides {
  scenario_assistant_agent_name?: string;
}

function settingsOverridesFilePath(settings: AppSettings): string {
  return join(settings.librariesDir, '.mcplab-app-settings.yaml');
}

function loadSettingsOverrides(settings: AppSettings): AppSettingsOverrides {
  const filePath = settingsOverridesFilePath(settings);
  if (!existsSync(filePath)) return {};
  try {
    const parsed = parseYaml(readFileSync(filePath, 'utf8')) as AppSettingsOverrides | undefined;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function applySettingsOverrides(settings: AppSettings): void {
  const overrides = loadSettingsOverrides(settings);
  settings.scenarioAssistantAgentName =
    overrides.scenario_assistant_agent_name?.trim() || undefined;
}

function persistSettingsOverrides(settings: AppSettings): void {
  const payload: AppSettingsOverrides = {
    ...(settings.scenarioAssistantAgentName
      ? { scenario_assistant_agent_name: settings.scenarioAssistantAgentName }
      : {})
  };
  writeFileSync(settingsOverridesFilePath(settings), `${stringifyYaml(payload)}\n`, 'utf8');
}

const SCENARIO_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const SCENARIO_ASSISTANT_MAX_TOOL_CALLS_PER_TURN = 3;
const SCENARIO_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS = 4000;

function cleanupAssistantSessions(
  sessions: Map<string, ScenarioAssistantSession>,
  now = Date.now()
): void {
  for (const [id, session] of sessions) {
    if (now - session.lastTouchedAt > SCENARIO_ASSISTANT_SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

function touchAssistantSession(session: ScenarioAssistantSession): void {
  session.lastTouchedAt = Date.now();
}

function assistantSessionView(session: ScenarioAssistantSession) {
  return {
    id: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.agentConfig.model,
    provider: session.agentConfig.provider,
    warnings: session.warnings,
    toolsLoaded: session.tools.length,
    toolServers: Array.from(new Set(session.tools.map((tool) => tool.name.split('__')[0]))),
    messages: session.chatMessages,
    pendingToolCalls: session.pendingToolCalls.filter((call) => call.status === 'pending')
  };
}

function assistantSystemPrompt(session: ScenarioAssistantSession): string {
  const { scenario, configSnapshotPolicy } = session.context;
  const toolLines = session.tools.map((tool) => {
    const mapping = session.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${mapping?.tool ?? tool.name}) schema=${schemaText}`;
  });
  return [
    'You are a Scenario Authoring Assistant for MCP evaluation scenarios.',
    'Goal: help the user author deterministic scenario prompt, eval rules, extract rules, and snapshot settings.',
    'Use the available MCP tools and schemas to ground suggestions.',
    'If you need live MCP information, call a tool and wait for approval.',
    'Respond ONLY as JSON with one of these envelopes:',
    `{"type":"assistant_message","text":"...","suggestions":{...optional...}}`,
    `{"type":"tool_call_request","text":"...","toolCall":{"name":"PUBLIC_TOOL_NAME","arguments":{}},"suggestions":{...optional...}}`,
    'For suggestions, use keys: prompt, evalRules, extractRules, snapshotEval, notes.',
    'prompt: { replacement: string, rationale?: string }',
    'evalRules: { replacement: [{ type, value }...], rationale?: string }',
    'extractRules: { replacement: [{ name, pattern }...], rationale?: string }',
    'snapshotEval: { patch: { enabled?: boolean, baselineSnapshotId?: string }, rationale?: string }',
    'Keep rule types limited to: required_tool, forbidden_tool, response_contains, response_not_contains.',
    'Ask clarifying questions if the scenario intent is unclear.',
    `Scenario context: ${JSON.stringify({
      id: scenario.id,
      name: scenario.name ?? '',
      prompt: scenario.prompt,
      serverNames: scenario.serverNames,
      evalRules: scenario.evalRules,
      extractRules: scenario.extractRules,
      snapshotEval: scenario.snapshotEval ?? null,
      configSnapshotPolicy: configSnapshotPolicy ?? null
    })}`,
    toolLines.length > 0
      ? `Available MCP tools:\n${toolLines.join('\n')}`
      : 'No MCP tools available.'
  ].join('\n');
}

function truncateJson(value: unknown, maxChars: number): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  } catch {
    return String(value);
  }
}

function normalizeAssistantToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || `tool_${Date.now()}`;
}

function makeAssistantToolPublicName(
  serverName: string,
  toolName: string,
  used: Set<string>
): string {
  const base = `${normalizeAssistantToolName(serverName)}__${normalizeAssistantToolName(toolName)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

async function preloadAssistantTools(
  session: ScenarioAssistantSession,
  serversByName: Record<string, EvalConfig['servers'][string]>,
  selectedServerNames: string[]
): Promise<void> {
  const usedNames = new Set<string>();
  for (const serverName of selectedServerNames) {
    const server = serversByName[serverName];
    if (!server) {
      session.warnings.push(`Scenario Assistant: server '${serverName}' not found in config.`);
      continue;
    }
    try {
      await session.mcp.connectAll({ [serverName]: server });
      const tools = await session.mcp.listTools(serverName);
      for (const tool of tools) {
        const publicName = makeAssistantToolPublicName(serverName, tool.name, usedNames);
        session.toolPublicMap.set(publicName, { server: serverName, tool: tool.name });
        session.tools.push({
          ...tool,
          name: publicName,
          description: `${tool.description ?? ''}\n[server=${serverName} tool=${tool.name}]`.trim()
        });
      }
    } catch (error: any) {
      session.warnings.push(
        `Scenario Assistant MCP preload failed for server '${serverName}': ${error?.message ?? String(error)}`
      );
    }
  }
}

function parseAssistantModelOutput(text: string): {
  type: 'assistant_message' | 'tool_call_request';
  text: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  toolCall?: { name: string; arguments: unknown };
} {
  const cleaned = text.trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (fenced) {
      parsed = JSON.parse(fenced[1]);
    } else {
      throw new Error('Assistant returned invalid JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Assistant response must be a JSON object');
  }
  if (parsed.type !== 'assistant_message' && parsed.type !== 'tool_call_request') {
    throw new Error("Assistant response type must be 'assistant_message' or 'tool_call_request'");
  }
  if (typeof parsed.text !== 'string') {
    throw new Error('Assistant response missing text');
  }
  if (parsed.type === 'tool_call_request') {
    if (!parsed.toolCall || typeof parsed.toolCall !== 'object') {
      throw new Error('Assistant tool_call_request missing toolCall');
    }
    if (typeof parsed.toolCall.name !== 'string' || !parsed.toolCall.name.trim()) {
      throw new Error('Assistant toolCall.name must be a non-empty string');
    }
  }
  return parsed;
}

function safeAssistantTextFromResponse(rawText: string): string {
  try {
    return parseAssistantModelOutput(rawText).text;
  } catch {
    return rawText.trim();
  }
}

async function assistantChatModel(
  session: ScenarioAssistantSession
): Promise<ReturnType<typeof parseAssistantModelOutput>> {
  let response = await chatWithAgent({
    agent: session.agentConfig,
    messages: session.llmMessages,
    tools: session.tools,
    system: assistantSystemPrompt(session)
  });
  if (response.tool_calls && response.tool_calls.length > 0) {
    const first = response.tool_calls[0];
    return {
      type: 'tool_call_request',
      text: response.content?.trim() || `I need to call '${first.name}' to help answer.`,
      toolCall: {
        name: first.name,
        arguments: first.arguments ?? {}
      }
    };
  }
  const rawText = response.content?.trim() ?? '';
  try {
    return parseAssistantModelOutput(rawText);
  } catch (error) {
    session.llmMessages.push({
      role: 'assistant',
      content: rawText
    });
    session.llmMessages.push({
      role: 'user',
      content:
        'Your previous response was not valid JSON. Reply ONLY with a valid JSON envelope matching the specified schema.'
    });
    response = await chatWithAgent({
      agent: session.agentConfig,
      messages: session.llmMessages,
      tools: session.tools,
      system: assistantSystemPrompt(session)
    });
    if (response.tool_calls && response.tool_calls.length > 0) {
      const first = response.tool_calls[0];
      return {
        type: 'tool_call_request',
        text: response.content?.trim() || `I need to call '${first.name}' to help answer.`,
        toolCall: { name: first.name, arguments: first.arguments ?? {} }
      };
    }
    return parseAssistantModelOutput(response.content?.trim() ?? '');
  }
}

async function continueAssistantTurn(session: ScenarioAssistantSession): Promise<{
  session: ReturnType<typeof assistantSessionView>;
  response: {
    type: 'assistant_message' | 'tool_call_request';
    text: string;
    suggestions?: ScenarioAssistantSuggestionBundle;
    pendingToolCall?: AssistantPendingToolCall;
  };
}> {
  const pendingCountForTurn = session.pendingToolCalls.filter((c) => c.status === 'pending').length;
  if (pendingCountForTurn > SCENARIO_ASSISTANT_MAX_TOOL_CALLS_PER_TURN) {
    throw new Error('Scenario Assistant exceeded maximum pending tool calls for this turn');
  }
  const modelOutput = await assistantChatModel(session);
  if (modelOutput.type === 'tool_call_request') {
    const requested = modelOutput.toolCall!;
    const mapping = session.toolPublicMap.get(requested.name);
    if (!mapping) {
      throw new Error(
        `Scenario Assistant requested unknown tool '${requested.name}'. Available tools: ${session.tools.map((t) => t.name).join(', ')}`
      );
    }
    const pending: AssistantPendingToolCall = {
      id: `satc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      server: mapping.server,
      tool: mapping.tool,
      publicToolName: requested.name,
      arguments: requested.arguments ?? {},
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    session.pendingToolCalls.push(pending);
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      text: modelOutput.text,
      createdAt: new Date().toISOString(),
      suggestions: modelOutput.suggestions,
      pendingToolCallId: pending.id
    });
    session.llmMessages.push({
      role: 'assistant',
      content: modelOutput.text,
      tool_calls: [
        {
          id: pending.id,
          name: pending.publicToolName,
          arguments: pending.arguments as any
        }
      ]
    });
    touchAssistantSession(session);
    return {
      session: assistantSessionView(session),
      response: {
        type: 'tool_call_request',
        text: modelOutput.text,
        suggestions: modelOutput.suggestions,
        pendingToolCall: pending
      }
    };
  }

  session.chatMessages.push({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    text: modelOutput.text,
    createdAt: new Date().toISOString(),
    suggestions: modelOutput.suggestions
  });
  session.llmMessages.push({
    role: 'assistant',
    content: JSON.stringify(modelOutput)
  });
  touchAssistantSession(session);
  return {
    session: assistantSessionView(session),
    response: {
      type: 'assistant_message',
      text: modelOutput.text,
      suggestions: modelOutput.suggestions
    }
  };
}

async function executeAssistantToolCall(
  session: ScenarioAssistantSession,
  pending: AssistantPendingToolCall
): Promise<unknown> {
  const timeoutMs = 10_000;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tool call timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([
    session.mcp.callTool(pending.server, pending.tool, pending.arguments),
    timeout
  ]);
}

function summarizeToolResultForAssistant(result: unknown): string {
  const text = truncateJson(result, SCENARIO_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS);
  return text;
}

function resolveAssistantAgentFromConfig(
  config: EvalConfig,
  selectedAssistantAgentName: string
): AgentConfig {
  const agent = config.agents[selectedAssistantAgentName];
  if (!agent) {
    throw new Error(
      `Scenario Assistant agent '${selectedAssistantAgentName}' not found in resolved config agents.`
    );
  }
  return agent;
}

function resolveAssistantAgentFromLibraries(
  libraries: ReturnType<typeof readLibraries>,
  selectedAssistantAgentName: string
): AgentConfig {
  const agent = libraries.agents[selectedAssistantAgentName];
  if (!agent) {
    throw new Error(
      `Scenario Assistant agent '${selectedAssistantAgentName}' not found in library agents. Configure the central Scenario Assistant Agent in Libraries > Scenarios.`
    );
  }
  return agent;
}

function pickDefaultAssistantAgentName(params: {
  requested?: string;
  settingsDefault?: string;
  agentNames: string[];
}): string {
  const requested = params.requested?.trim();
  if (requested) return requested;
  const settingsDefault = params.settingsDefault?.trim();
  if (settingsDefault) return settingsDefault;
  return params.agentNames[0] ?? '';
}

const TOOL_ANALYSIS_READ_PREFIXES = [
  'get',
  'list',
  'search',
  'find',
  'describe',
  'read',
  'fetch',
  'lookup',
  'query',
  'inspect'
];

const TOOL_ANALYSIS_UNSAFE_PREFIXES = [
  'create',
  'update',
  'delete',
  'remove',
  'write',
  'set',
  'patch',
  'post',
  'put',
  'execute',
  'run',
  'trigger'
];

function classifyToolSafety(
  toolName: string,
  inputSchema?: unknown
): {
  safetyClassification: 'read_like' | 'unsafe_or_unknown';
  classificationReason: string;
} {
  const lower = toolName.toLowerCase();
  const read = TOOL_ANALYSIS_READ_PREFIXES.find((p) => lower.startsWith(p));
  const unsafe = TOOL_ANALYSIS_UNSAFE_PREFIXES.find((p) => lower.startsWith(p));
  if (unsafe) {
    return {
      safetyClassification: 'unsafe_or_unknown',
      classificationReason: `Name starts with potentially side-effectful prefix '${unsafe}'.`
    };
  }
  let schemaHint = '';
  try {
    const schemaText = JSON.stringify(inputSchema ?? '').toLowerCase();
    if (/(confirm|force|commit|delete|write|update)/.test(schemaText)) {
      schemaHint = ' Schema contains possibly mutating parameter names.';
    }
  } catch {
    // ignore schema stringify errors
  }
  if (read) {
    return {
      safetyClassification: 'read_like',
      classificationReason: `Name starts with read-like prefix '${read}'.${schemaHint}`.trim()
    };
  }
  return {
    safetyClassification: 'unsafe_or_unknown',
    classificationReason:
      `Tool name does not match read-only allowlist prefixes.${schemaHint}`.trim()
  };
}

function normalizeToolAnalysisFinding(
  raw: any,
  fallbackPrefix: string,
  idx: number
): ToolAnalysisFinding {
  const severity =
    raw?.severity === 'critical' ||
    raw?.severity === 'high' ||
    raw?.severity === 'medium' ||
    raw?.severity === 'low' ||
    raw?.severity === 'info'
      ? raw.severity
      : 'info';
  const scopeValues: ToolAnalysisFinding['scope'][] = [
    'tool_name',
    'description',
    'schema',
    'ergonomics',
    'safety',
    'eval_readiness',
    'execution'
  ];
  const scope = scopeValues.includes(raw?.scope) ? raw.scope : 'eval_readiness';
  return {
    id:
      (typeof raw?.id === 'string' && raw.id.trim()) ||
      `${fallbackPrefix}-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
    scope,
    severity,
    title: String(raw?.title ?? 'Observation'),
    detail: String(raw?.detail ?? raw?.suggestion ?? 'No details provided'),
    suggestion: raw?.suggestion ? String(raw.suggestion) : undefined
  };
}

function clampStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : fallback;
}

function parseJsonFromAssistantText<T = any>(text: string): T {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (fenced) return JSON.parse(fenced[1]) as T;
    throw new Error('Assistant returned invalid JSON');
  }
}

async function chatJsonWithAgent(
  agent: AgentConfig,
  system: string,
  userPrompt: string
): Promise<any> {
  const first = await chatWithAgent({
    agent,
    system,
    messages: [{ role: 'user', content: userPrompt }]
  });
  try {
    return parseJsonFromAssistantText(first.content ?? '');
  } catch {
    const retry = await chatWithAgent({
      agent,
      system,
      messages: [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: first.content ?? '' },
        {
          role: 'user',
          content: 'Reply again with valid JSON only. No prose, no markdown fences.'
        }
      ]
    });
    return parseJsonFromAssistantText(retry.content ?? '');
  }
}

function toolAnalysisMetadataSystemPrompt(): string {
  return [
    'You are an MCP Tool Analysis Assistant.',
    'Review MCP tools for agent/workflow usability, determinism, safety signaling, and eval readiness.',
    'Return JSON only with keys:',
    'strengths: string[]',
    'issues: ToolAnalysisFinding[] (id, scope, severity, title, detail, suggestion?)',
    'suggestedDescription?: string',
    'suggestedSchemaChanges: [{type, summary, before?, after?}]',
    'evalReadinessNotes: string[]',
    'overallRecommendations: string[]',
    'Use severities: critical|high|medium|low|info.'
  ].join('\n');
}

function toolAnalysisSampleArgsSystemPrompt(sampleCallsPerTool: number): string {
  return [
    'You generate safe sample MCP tool call arguments for read-only analysis.',
    'Return JSON only: {"sampleCalls":[{"arguments":{...},"rationale":"..."}]}',
    `Limit to at most ${sampleCallsPerTool} sampleCalls.`,
    'Prefer minimal valid arguments based on the schema.',
    'Do not include destructive or side-effect toggles.'
  ].join('\n');
}

function toolAnalysisExecutionReviewSystemPrompt(): string {
  return [
    'You review MCP tool execution output for agent/workflow usability and eval readiness.',
    'Return JSON only with keys: observations (string[]), issues (ToolAnalysisFinding[]), recommendations (string[]).',
    'Focus on output shape consistency, error quality, schema-doc mismatches, and determinism risks.'
  ].join('\n');
}

async function discoverMcpToolsForServers(
  serversByName: EvalConfig['servers'],
  serverNames: string[]
): Promise<{
  mcp: McpClientManager;
  servers: Array<{
    serverName: string;
    warnings: string[];
    tools: ToolAnalysisToolContext[];
  }>;
}> {
  const mcp = new McpClientManager();
  const discovered: Array<{
    serverName: string;
    warnings: string[];
    tools: ToolAnalysisToolContext[];
  }> = [];
  for (const serverName of serverNames) {
    const server = serversByName[serverName];
    const entry = { serverName, warnings: [] as string[], tools: [] as ToolAnalysisToolContext[] };
    if (!server) {
      entry.warnings.push(`Server '${serverName}' not found.`);
      discovered.push(entry);
      continue;
    }
    try {
      await mcp.connectAll({ [serverName]: server });
      const tools = await mcp.listTools(serverName);
      entry.tools = tools.map((tool) => {
        const safety = classifyToolSafety(tool.name, tool.inputSchema);
        return {
          serverName,
          tool,
          safetyClassification: safety.safetyClassification,
          classificationReason: safety.classificationReason
        };
      });
    } catch (error: any) {
      entry.warnings.push(`Failed to load tools: ${error?.message ?? String(error)}`);
    }
    discovered.push(entry);
  }
  return { mcp, servers: discovered };
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function summarizeToolResultForReport(result: unknown, maxChars = 8000): string {
  return truncateJson(result, maxChars);
}

async function runToolAnalysisJob(params: {
  job: ToolAnalysisJob;
  settings: AppSettings;
  requestedAssistantAgentName?: string;
  serverNames: string[];
  selectedToolsByServer?: Record<string, string[]>;
  modes: { metadataReview: boolean; deeperAnalysis: boolean };
  deeper: {
    autoRunPolicy: 'read_only_allowlist';
    sampleCallsPerTool: number;
    toolCallTimeoutMs: number;
  };
}): Promise<void> {
  const { job, settings, serverNames, selectedToolsByServer, modes, deeper } = params;
  const libraries = readLibraries(settings.librariesDir);
  const selectedAssistantAgentName = pickDefaultAssistantAgentName({
    requested: params.requestedAssistantAgentName,
    settingsDefault: settings.scenarioAssistantAgentName,
    agentNames: Object.keys(libraries.agents)
  });
  if (!selectedAssistantAgentName) {
    throw new Error(
      'No assistant agent available. Configure one in Settings or add a library agent.'
    );
  }
  const agentConfig = resolveAssistantAgentFromLibraries(libraries, selectedAssistantAgentName);
  addJobEvent(job, {
    type: 'log',
    ts: new Date().toISOString(),
    payload: {
      message: `Using assistant agent ${selectedAssistantAgentName} (${agentConfig.provider}/${agentConfig.model})`
    }
  });

  const { mcp, servers: discoveredServers } = await discoverMcpToolsForServers(
    libraries.servers,
    serverNames
  );
  try {
    const serverReports: ToolAnalysisServerReport[] = [];
    const allFindings: ToolAnalysisFinding[] = [];
    const issueCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let toolsSkipped = 0;

    for (const discovered of discoveredServers) {
      if (job.abortController.signal.aborted) throw new Error('Tool analysis aborted by user');
      addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: {
          message: `Analyzing server ${discovered.serverName} (${discovered.tools.length} tools)`
        }
      });
      const requestedToolNames = selectedToolsByServer?.[discovered.serverName];
      const requestedSet = requestedToolNames ? new Set(requestedToolNames) : null;
      const selectedTools = requestedSet
        ? discovered.tools.filter((t) => requestedSet.has(t.tool.name))
        : discovered.tools;
      const missingRequested = requestedSet
        ? requestedToolNames!.filter((name) => !discovered.tools.some((t) => t.tool.name === name))
        : [];

      const toolReports: ToolAnalysisToolReport[] = [];
      for (const toolCtx of selectedTools) {
        if (job.abortController.signal.aborted) throw new Error('Tool analysis aborted by user');
        const baseReport: ToolAnalysisToolReport = {
          serverName: discovered.serverName,
          toolName: toolCtx.tool.name,
          publicToolName: `${discovered.serverName}::${toolCtx.tool.name}`,
          description: toolCtx.tool.description,
          inputSchema: toolCtx.tool.inputSchema,
          safetyClassification: toolCtx.safetyClassification,
          classificationReason: toolCtx.classificationReason,
          overallRecommendations: []
        };

        if (modes.metadataReview) {
          addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: { message: `Metadata review: ${discovered.serverName}::${toolCtx.tool.name}` }
          });
          try {
            const metaJson = await chatJsonWithAgent(
              agentConfig,
              toolAnalysisMetadataSystemPrompt(),
              JSON.stringify({
                serverName: discovered.serverName,
                toolName: toolCtx.tool.name,
                description: toolCtx.tool.description ?? '',
                inputSchema: toolCtx.tool.inputSchema ?? null,
                projectGoal: 'MCP agent/workflow evaluation friendliness'
              })
            );
            const issues = Array.isArray(metaJson?.issues)
              ? metaJson.issues.map((item: any, idx: number) =>
                  normalizeToolAnalysisFinding(
                    item,
                    `meta-${discovered.serverName}-${toolCtx.tool.name}`,
                    idx
                  )
                )
              : [];
            baseReport.metadataReview = {
              strengths: clampStringArray(metaJson?.strengths),
              issues,
              suggestedDescription:
                typeof metaJson?.suggestedDescription === 'string'
                  ? metaJson.suggestedDescription
                  : undefined,
              suggestedSchemaChanges: Array.isArray(metaJson?.suggestedSchemaChanges)
                ? metaJson.suggestedSchemaChanges.map((c: any) => ({
                    type: (
                      [
                        'description',
                        'parameter',
                        'required',
                        'enum',
                        'constraints',
                        'examples',
                        'naming'
                      ] as const
                    ).includes(c?.type)
                      ? c.type
                      : 'parameter',
                    summary: String(c?.summary ?? 'Suggested change'),
                    before: c?.before ? String(c.before) : undefined,
                    after: c?.after ? String(c.after) : undefined
                  }))
                : [],
              evalReadinessNotes: clampStringArray(metaJson?.evalReadinessNotes)
            };
            baseReport.overallRecommendations.push(
              ...clampStringArray(metaJson?.overallRecommendations)
            );
          } catch (error: any) {
            baseReport.metadataReview = {
              strengths: [],
              issues: [
                normalizeToolAnalysisFinding(
                  {
                    scope: 'schema',
                    severity: 'medium',
                    title: 'Metadata review failed',
                    detail: error?.message ?? String(error),
                    suggestion:
                      'Retry with a different assistant agent or simplify the tool schema.'
                  },
                  `meta-fail-${toolCtx.tool.name}`,
                  0
                )
              ],
              suggestedSchemaChanges: [],
              evalReadinessNotes: []
            };
          }
        }

        if (modes.deeperAnalysis) {
          const canAutoRun =
            deeper.autoRunPolicy !== 'read_only_allowlist' ||
            toolCtx.safetyClassification === 'read_like';
          if (!canAutoRun) {
            baseReport.deeperAnalysis = {
              attempted: false,
              skippedReason: `Skipped by safety policy (${deeper.autoRunPolicy}): ${toolCtx.classificationReason}`,
              sampleCalls: [],
              overallObservations: []
            };
            toolsSkipped += 1;
          } else {
            addJobEvent(job, {
              type: 'log',
              ts: new Date().toISOString(),
              payload: {
                message: `Deeper analysis: ${discovered.serverName}::${toolCtx.tool.name}`
              }
            });
            const sampleCalls: ToolAnalysisSampleCall[] = [];
            let overallObservations: string[] = [];
            try {
              const samplePlan = await chatJsonWithAgent(
                agentConfig,
                toolAnalysisSampleArgsSystemPrompt(deeper.sampleCallsPerTool),
                JSON.stringify({
                  serverName: discovered.serverName,
                  toolName: toolCtx.tool.name,
                  description: toolCtx.tool.description ?? '',
                  inputSchema: toolCtx.tool.inputSchema ?? null,
                  maxCalls: deeper.sampleCallsPerTool
                })
              );
              const suggestedSamples = Array.isArray(samplePlan?.sampleCalls)
                ? samplePlan.sampleCalls.slice(0, deeper.sampleCallsPerTool)
                : [{ arguments: {} }];
              for (let idx = 0; idx < suggestedSamples.length; idx += 1) {
                const suggestedArgs = suggestedSamples[idx]?.arguments ?? {};
                const started = Date.now();
                try {
                  const result = await timeoutPromise(
                    mcp.callTool(discovered.serverName, toolCtx.tool.name, suggestedArgs),
                    deeper.toolCallTimeoutMs,
                    `${discovered.serverName}::${toolCtx.tool.name}`
                  );
                  const durationMs = Date.now() - started;
                  const resultPreview = summarizeToolResultForReport(result, 8000);
                  let execReview: any = {};
                  try {
                    execReview = await chatJsonWithAgent(
                      agentConfig,
                      toolAnalysisExecutionReviewSystemPrompt(),
                      JSON.stringify({
                        serverName: discovered.serverName,
                        toolName: toolCtx.tool.name,
                        arguments: suggestedArgs,
                        resultPreview: truncateJson(result, 4000),
                        description: toolCtx.tool.description ?? '',
                        inputSchema: toolCtx.tool.inputSchema ?? null
                      })
                    );
                  } catch (error: any) {
                    execReview = {
                      observations: [`Execution review failed: ${error?.message ?? String(error)}`],
                      issues: [],
                      recommendations: []
                    };
                  }
                  const issues = Array.isArray(execReview?.issues)
                    ? execReview.issues.map((it: any, j: number) =>
                        normalizeToolAnalysisFinding(
                          { ...it, scope: it?.scope ?? 'execution' },
                          `exec-${discovered.serverName}-${toolCtx.tool.name}-${idx}`,
                          j
                        )
                      )
                    : [];
                  sampleCalls.push({
                    callIndex: idx + 1,
                    arguments: suggestedArgs,
                    ok: true,
                    durationMs,
                    resultPreview,
                    observations: clampStringArray(execReview?.observations),
                    issues
                  });
                  baseReport.overallRecommendations.push(
                    ...clampStringArray(execReview?.recommendations)
                  );
                } catch (error: any) {
                  sampleCalls.push({
                    callIndex: idx + 1,
                    arguments: suggestedArgs,
                    ok: false,
                    durationMs: Date.now() - started,
                    error: error?.message ?? String(error),
                    observations: [],
                    issues: [
                      normalizeToolAnalysisFinding(
                        {
                          scope: 'execution',
                          severity: 'medium',
                          title: 'Sample call failed',
                          detail: error?.message ?? String(error)
                        },
                        `exec-fail-${discovered.serverName}-${toolCtx.tool.name}`,
                        idx
                      )
                    ]
                  });
                }
              }
              overallObservations = sampleCalls
                .flatMap((call: ToolAnalysisSampleCall) => call.observations)
                .slice(0, 20);
              baseReport.deeperAnalysis = {
                attempted: true,
                sampleCalls,
                overallObservations
              };
            } catch (error: any) {
              baseReport.deeperAnalysis = {
                attempted: true,
                sampleCalls: [
                  {
                    callIndex: 1,
                    arguments: {},
                    ok: false,
                    error: error?.message ?? String(error),
                    observations: [],
                    issues: [
                      normalizeToolAnalysisFinding(
                        {
                          scope: 'execution',
                          severity: 'medium',
                          title: 'Deeper analysis failed',
                          detail: error?.message ?? String(error)
                        },
                        `deeper-fail-${toolCtx.tool.name}`,
                        0
                      )
                    ]
                  }
                ],
                overallObservations
              };
            }
          }
        }

        const toolFindings = [
          ...(baseReport.metadataReview?.issues ?? []),
          ...(baseReport.deeperAnalysis?.sampleCalls.flatMap((c) => c.issues) ?? [])
        ];
        for (const finding of toolFindings) {
          allFindings.push(finding);
          issueCounts[finding.severity] += 1;
        }
        toolReports.push(baseReport);
      }

      serverReports.push({
        serverName: discovered.serverName,
        toolCountDiscovered: discovered.tools.length,
        toolCountAnalyzed: toolReports.length,
        toolCountSkipped: toolReports.filter(
          (tool) => tool.deeperAnalysis && tool.deeperAnalysis.attempted === false
        ).length,
        warnings: [
          ...discovered.warnings,
          ...missingRequested.map((name) => `Requested tool not found: ${name}`)
        ],
        tools: toolReports
      });
    }

    job.result = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      assistantAgentName: selectedAssistantAgentName,
      assistantAgentModel: agentConfig.model,
      modes,
      settings: {
        autoRunPolicy: modes.deeperAnalysis ? deeper.autoRunPolicy : undefined,
        sampleCallsPerTool: modes.deeperAnalysis ? deeper.sampleCallsPerTool : undefined,
        toolCallTimeoutMs: modes.deeperAnalysis ? deeper.toolCallTimeoutMs : undefined
      },
      summary: {
        serversAnalyzed: serverReports.length,
        toolsAnalyzed: serverReports.reduce((sum, s) => sum + s.toolCountAnalyzed, 0),
        toolsSkipped,
        issueCounts
      },
      servers: serverReports,
      findings: allFindings
    };
  } finally {
    // McpClientManager currently has no explicit close lifecycle API.
  }
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
  const {
    config: _resolvedConfig,
    sourceConfig,
    hash,
    warnings
  } = loadConfig(absPath, { bundleRoot });
  const stat = statSync(absPath);
  const name = basename(absPath, extname(absPath));
  return {
    id: encodeConfigId(absPath, configsDir),
    name,
    path: absPath,
    mtime: stat.mtime.toISOString(),
    hash,
    config: sourceConfig,
    warnings: warnings.length > 0 ? warnings : undefined
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
      server_refs: Array.isArray(obj.server_refs) ? obj.server_refs.map((v) => String(v)) : [],
      agents:
        obj.agents && typeof obj.agents === 'object' && !Array.isArray(obj.agents)
          ? (obj.agents as EvalConfig['agents'])
          : {},
      agent_refs: Array.isArray(obj.agent_refs) ? obj.agent_refs.map((v) => String(v)) : [],
      scenarios: Array.isArray(obj.scenarios) ? (obj.scenarios as EvalConfig['scenarios']) : [],
      scenario_refs: Array.isArray(obj.scenario_refs)
        ? obj.scenario_refs.map((v) => String(v))
        : [],
      run_defaults:
        obj.run_defaults && typeof obj.run_defaults === 'object' && !Array.isArray(obj.run_defaults)
          ? (obj.run_defaults as EvalConfig['run_defaults'])
          : undefined,
      snapshot_eval:
        obj.snapshot_eval &&
        typeof obj.snapshot_eval === 'object' &&
        !Array.isArray(obj.snapshot_eval)
          ? (obj.snapshot_eval as EvalConfig['snapshot_eval'])
          : undefined
    };
  } catch {
    return emptySourceConfig();
  }
}

function readConfigRecordOrInvalid(
  absPath: string,
  configsDir: string,
  bundleRoot?: string
): ConfigRecord {
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

function addJobEvent(job: { events: JobEvent[]; clients: Set<ServerResponse> }, event: JobEvent) {
  job.events.push(event);
  for (const client of job.clients) {
    sendSseEvent(client, event);
  }
}

function expandConfigForAgents(
  config: EvalConfig,
  requestedAgents?: string[]
): ExecutableEvalConfig {
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
    for (const agent of selectedAgents) {
      expandedScenarios.push({
        ...scenario,
        agent,
        scenario_exec_id: `${scenario.id}-${agent}`
      });
    }
  }
  return {
    ...config,
    scenarios: expandedScenarios
  };
}

function resolveRunSelectedAgents(
  config: EvalConfig,
  requestedAgents?: string[]
): string[] | undefined {
  if (requestedAgents && requestedAgents.length > 0) return requestedAgents;
  return config.run_defaults?.selected_agents;
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
    librariesDir: resolve(options.librariesDir)
  };
  mkdirSync(settings.configsDir, { recursive: true });
  mkdirSync(settings.runsDir, { recursive: true });
  mkdirSync(settings.snapshotsDir, { recursive: true });
  mkdirSync(settings.librariesDir, { recursive: true });
  mkdirSync(join(settings.librariesDir, 'scenarios'), { recursive: true });
  applySettingsOverrides(settings);

  const appDist = resolve(workspaceRoot, 'packages', 'app', 'dist');
  const viteDevTarget = 'http://127.0.0.1:8685';
  const devMcp = maybeStartDevMcpServer(workspaceRoot, options.dev);
  const jobs = new Map<string, RunJob>();
  const toolAnalysisJobs = new Map<string, ToolAnalysisJob>();
  const assistantSessions = new Map<string, ScenarioAssistantSession>();
  let activeJobId: string | null = null;

  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, MCP-Session-Id, Last-Event-ID, Accept'
      );
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      if (
        devMcp &&
        pathname === devMcp.path &&
        (method === 'GET' || method === 'POST' || method === 'DELETE')
      ) {
        await proxyToVite(req, res, devMcp.targetBaseUrl, pathname, url.search);
        return;
      }

      if (pathname === '/api/health' && method === 'GET') {
        asJson(res, 200, {
          ok: true,
          version: pkg.version,
          mcp: devMcp
            ? {
                enabled: true,
                transport: 'streamable-http',
                endpoint: `http://${options.host}:${options.port}${devMcp.path}`,
                upstream: `${devMcp.targetBaseUrl}${devMcp.path}`
              }
            : { enabled: false }
        });
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
          applySettingsOverrides(settings);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'scenarioAssistantAgentName')) {
          const next = String(body.scenarioAssistantAgentName ?? '').trim();
          settings.scenarioAssistantAgentName = next || undefined;
          persistSettingsOverrides(settings);
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

      if (pathname === '/api/tool-analysis/discover-tools' && method === 'POST') {
        const body = await parseBody(req);
        const serverNames = Array.isArray(body.serverNames)
          ? body.serverNames.map((v: unknown) => String(v).trim()).filter(Boolean)
          : [];
        if (serverNames.length === 0) {
          asJson(res, 400, { error: 'serverNames is required' });
          return;
        }
        const libraries = readLibraries(settings.librariesDir);
        const { servers } = await discoverMcpToolsForServers(libraries.servers, serverNames);
        asJson(res, 200, {
          servers: servers.map((entry) => ({
            serverName: entry.serverName,
            warnings: entry.warnings,
            tools: entry.tools.map((tool) => ({
              name: tool.tool.name,
              description: tool.tool.description,
              inputSchema: tool.tool.inputSchema,
              safetyClassification: tool.safetyClassification,
              classificationReason: tool.classificationReason
            }))
          }))
        });
        return;
      }

      if (pathname === '/api/tool-analysis/jobs' && method === 'POST') {
        const body = await parseBody(req);
        const serverNames = Array.isArray(body.serverNames)
          ? body.serverNames.map((v: unknown) => String(v).trim()).filter(Boolean)
          : [];
        const modes = {
          metadataReview: Boolean(body?.modes?.metadataReview),
          deeperAnalysis: Boolean(body?.modes?.deeperAnalysis)
        };
        if (serverNames.length === 0) {
          asJson(res, 400, { error: 'At least one server must be selected' });
          return;
        }
        if (!modes.metadataReview && !modes.deeperAnalysis) {
          asJson(res, 400, { error: 'Select at least one analysis mode' });
          return;
        }
        const selectedToolsByServer =
          body.selectedToolsByServer && typeof body.selectedToolsByServer === 'object'
            ? (body.selectedToolsByServer as Record<string, string[]>)
            : undefined;
        const deeperOptions = body.deeperAnalysisOptions ?? {};
        const jobId = `ta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const job: ToolAnalysisJob = {
          id: jobId,
          status: 'running',
          events: [],
          clients: new Set(),
          abortController: new AbortController()
        };
        toolAnalysisJobs.set(jobId, job);
        addJobEvent(job, {
          type: 'started',
          ts: new Date().toISOString(),
          payload: {
            serverNames,
            modes,
            assistantAgentName: body.assistantAgentName ? String(body.assistantAgentName) : null
          }
        });
        void (async () => {
          try {
            await runToolAnalysisJob({
              job,
              settings,
              requestedAssistantAgentName: body.assistantAgentName
                ? String(body.assistantAgentName)
                : undefined,
              serverNames,
              selectedToolsByServer,
              modes,
              deeper: {
                autoRunPolicy: 'read_only_allowlist',
                sampleCallsPerTool: Math.max(
                  1,
                  Math.min(5, Number(deeperOptions.sampleCallsPerTool ?? 1) || 1)
                ),
                toolCallTimeoutMs: Math.max(
                  1000,
                  Math.min(60_000, Number(deeperOptions.toolCallTimeoutMs ?? 10_000) || 10_000)
                )
              }
            });
            job.status = 'completed';
            addJobEvent(job, {
              type: 'completed',
              ts: new Date().toISOString(),
              payload: {
                summary: job.result?.summary ?? null
              }
            });
          } catch (error: any) {
            const aborted = job.abortController.signal.aborted || job.status === 'stopped';
            job.status = aborted ? 'stopped' : 'error';
            addJobEvent(job, {
              type: 'error',
              ts: new Date().toISOString(),
              payload: {
                message: aborted
                  ? 'Tool analysis aborted by user'
                  : (error?.message ?? String(error))
              }
            });
          } finally {
            for (const client of job.clients) client.end();
            job.clients.clear();
            setTimeout(() => {
              toolAnalysisJobs.delete(job.id);
            }, 30 * 60_000).unref?.();
          }
        })();
        asJson(res, 202, { jobId });
        return;
      }

      if (
        pathname.startsWith('/api/tool-analysis/jobs/') &&
        pathname.endsWith('/events') &&
        method === 'GET'
      ) {
        const jobId = pathname.split('/')[4];
        const job = toolAnalysisJobs.get(jobId);
        if (!job) {
          asJson(res, 404, { error: 'Job not found' });
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.flushHeaders();
        for (const event of job.events) sendSseEvent(res, event);
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
        pathname.startsWith('/api/tool-analysis/jobs/') &&
        pathname.endsWith('/result') &&
        method === 'GET'
      ) {
        const jobId = pathname.split('/')[4];
        const job = toolAnalysisJobs.get(jobId);
        if (!job) {
          asJson(res, 404, { error: 'Job not found' });
          return;
        }
        if (!job.result) {
          asJson(res, 409, { error: `Job not completed (status=${job.status})` });
          return;
        }
        asJson(res, 200, { jobId, report: job.result });
        return;
      }

      if (
        pathname.startsWith('/api/tool-analysis/jobs/') &&
        pathname.endsWith('/stop') &&
        method === 'POST'
      ) {
        const jobId = pathname.split('/')[4];
        const job = toolAnalysisJobs.get(jobId);
        if (!job) {
          asJson(res, 404, { error: 'Job not found' });
          return;
        }
        if (job.status !== 'running') {
          asJson(res, 200, { ok: true, status: job.status });
          return;
        }
        job.status = 'stopped';
        job.abortController.abort();
        asJson(res, 200, { ok: true, status: 'stopped' });
        return;
      }

      if (pathname === '/api/scenario-assistant/sessions' && method === 'POST') {
        cleanupAssistantSessions(assistantSessions);
        const body = await parseBody(req);
        const configPathRaw = body.configPath ? String(body.configPath).trim() : '';
        const scenarioId = String(body.scenarioId ?? '').trim();
        const requestedAssistantAgentName = String(body.selectedAssistantAgentName ?? '').trim();
        const context = (body.context ?? {}) as ScenarioAssistantContextInput;
        if (!scenarioId) {
          asJson(res, 400, { error: 'scenarioId is required' });
          return;
        }
        if (!context?.scenario || typeof context.scenario !== 'object') {
          asJson(res, 400, { error: 'context.scenario is required' });
          return;
        }
        let configPath: string | undefined;
        let agentConfig: AgentConfig;
        let serversByName: EvalConfig['servers'];
        let warnings: string[] = [];
        let selectedAssistantAgentName = '';
        if (configPathRaw) {
          configPath = isAbsolute(configPathRaw)
            ? ensureInsideRoot(settings.configsDir, configPathRaw)
            : ensureInsideRoot(settings.configsDir, join(settings.configsDir, configPathRaw));
          if (!existsSync(configPath)) {
            asJson(res, 404, { error: `Config not found: ${configPath}` });
            return;
          }
          const loaded = loadConfig(configPath, { bundleRoot: settings.librariesDir });
          warnings = [...(loaded.warnings ?? [])];
          selectedAssistantAgentName = pickDefaultAssistantAgentName({
            requested: requestedAssistantAgentName,
            agentNames: Object.keys(loaded.config.agents)
          });
          if (!selectedAssistantAgentName) {
            asJson(res, 400, {
              error: 'No agents available for Scenario Assistant in this MCP Evaluation.'
            });
            return;
          }
          agentConfig = resolveAssistantAgentFromConfig(loaded.config, selectedAssistantAgentName);
          serversByName = loaded.config.servers;
        } else {
          const libraries = readLibraries(settings.librariesDir);
          selectedAssistantAgentName = pickDefaultAssistantAgentName({
            requested: requestedAssistantAgentName,
            settingsDefault: settings.scenarioAssistantAgentName,
            agentNames: Object.keys(libraries.agents)
          });
          if (!selectedAssistantAgentName) {
            asJson(res, 400, {
              error: 'No library agents available for Scenario Assistant. Add an agent first.'
            });
            return;
          }
          agentConfig = resolveAssistantAgentFromLibraries(libraries, selectedAssistantAgentName);
          serversByName = libraries.servers;
        }
        const session: ScenarioAssistantSession = {
          id: `sas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          configPath,
          selectedAssistantAgentName,
          context,
          agentConfig,
          mcp: new McpClientManager(),
          tools: [],
          toolPublicMap: new Map(),
          pendingToolCalls: [],
          chatMessages: [],
          llmMessages: [],
          warnings
        };
        session.chatMessages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          text: 'Scenario Assistant session created.',
          createdAt: new Date().toISOString()
        });
        const selectedServerNames = Array.from(new Set(context.scenario.serverNames ?? []));
        await preloadAssistantTools(session, serversByName, selectedServerNames);
        assistantSessions.set(session.id, session);
        asJson(res, 201, { sessionId: session.id, session: assistantSessionView(session) });
        return;
      }

      if (pathname.startsWith('/api/scenario-assistant/sessions/') && method === 'GET') {
        cleanupAssistantSessions(assistantSessions);
        const sessionId = pathname.replace('/api/scenario-assistant/sessions/', '');
        const session = assistantSessions.get(sessionId);
        if (!session) {
          asJson(res, 404, { error: 'Scenario Assistant session not found' });
          return;
        }
        touchAssistantSession(session);
        asJson(res, 200, { session: assistantSessionView(session) });
        return;
      }

      if (pathname.startsWith('/api/scenario-assistant/sessions/') && method === 'DELETE') {
        cleanupAssistantSessions(assistantSessions);
        const sessionId = pathname.replace('/api/scenario-assistant/sessions/', '');
        assistantSessions.delete(sessionId);
        asJson(res, 200, { ok: true });
        return;
      }

      if (
        pathname.startsWith('/api/scenario-assistant/sessions/') &&
        pathname.endsWith('/messages') &&
        method === 'POST'
      ) {
        cleanupAssistantSessions(assistantSessions);
        const parts = pathname.split('/');
        const sessionId = parts[4];
        const session = assistantSessions.get(sessionId);
        if (!session) {
          asJson(res, 404, { error: 'Scenario Assistant session not found' });
          return;
        }
        const body = await parseBody(req);
        const message = String(body.message ?? '').trim();
        if (!message) {
          asJson(res, 400, { error: 'message is required' });
          return;
        }
        session.chatMessages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          text: message,
          createdAt: new Date().toISOString()
        });
        session.llmMessages.push({ role: 'user', content: message });
        const output = await continueAssistantTurn(session);
        asJson(res, 200, output);
        return;
      }

      if (
        pathname.startsWith('/api/scenario-assistant/sessions/') &&
        pathname.includes('/tool-calls/') &&
        pathname.endsWith('/approve') &&
        method === 'POST'
      ) {
        cleanupAssistantSessions(assistantSessions);
        const parts = pathname.split('/');
        const sessionId = parts[4];
        const callId = parts[6];
        const session = assistantSessions.get(sessionId);
        if (!session) {
          asJson(res, 404, { error: 'Scenario Assistant session not found' });
          return;
        }
        const pending = session.pendingToolCalls.find((call) => call.id === callId);
        if (!pending) {
          asJson(res, 404, { error: 'Scenario Assistant tool call not found' });
          return;
        }
        if (pending.status !== 'pending') {
          asJson(res, 409, { error: `Tool call is already ${pending.status}` });
          return;
        }
        const body = await parseBody(req);
        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'argumentsOverride')) {
          pending.arguments = body.argumentsOverride;
        }
        pending.status = 'approved';
        session.chatMessages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'tool',
          text: `Approved tool call ${pending.server}::${pending.tool}`,
          createdAt: new Date().toISOString()
        });
        let toolResult: unknown;
        try {
          toolResult = await executeAssistantToolCall(session, pending);
          pending.resultPreview = summarizeToolResultForAssistant(toolResult);
          session.llmMessages.push({
            role: 'tool',
            content: pending.resultPreview,
            tool_call_id: pending.id,
            name: pending.publicToolName
          });
        } catch (error: any) {
          pending.status = 'error';
          pending.error = error?.message ?? String(error);
          session.llmMessages.push({
            role: 'tool',
            content: JSON.stringify({ error: pending.error }),
            tool_call_id: pending.id,
            name: pending.publicToolName
          });
          session.chatMessages.push({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'tool',
            text: `Tool error (${pending.server}::${pending.tool}): ${pending.error}`,
            createdAt: new Date().toISOString()
          });
        }
        const output = await continueAssistantTurn(session);
        asJson(res, 200, output);
        return;
      }

      if (
        pathname.startsWith('/api/scenario-assistant/sessions/') &&
        pathname.includes('/tool-calls/') &&
        pathname.endsWith('/deny') &&
        method === 'POST'
      ) {
        cleanupAssistantSessions(assistantSessions);
        const parts = pathname.split('/');
        const sessionId = parts[4];
        const callId = parts[6];
        const session = assistantSessions.get(sessionId);
        if (!session) {
          asJson(res, 404, { error: 'Scenario Assistant session not found' });
          return;
        }
        const pending = session.pendingToolCalls.find((call) => call.id === callId);
        if (!pending) {
          asJson(res, 404, { error: 'Scenario Assistant tool call not found' });
          return;
        }
        if (pending.status !== 'pending') {
          asJson(res, 409, { error: `Tool call is already ${pending.status}` });
          return;
        }
        pending.status = 'denied';
        session.chatMessages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'tool',
          text: `Denied tool call ${pending.server}::${pending.tool}`,
          createdAt: new Date().toISOString()
        });
        session.llmMessages.push({
          role: 'tool',
          content: JSON.stringify({
            denied: true,
            reason: 'User denied tool call',
            server: pending.server,
            tool: pending.tool
          }),
          tool_call_id: pending.id,
          name: pending.publicToolName
        });
        const output = await continueAssistantTurn(session);
        asJson(res, 200, output);
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
        asJson(
          res,
          200,
          readConfigRecordOrInvalid(filePath, settings.configsDir, settings.librariesDir)
        );
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
            for (const warning of loaded.warnings ?? []) {
              addJobEvent(job, {
                type: 'log',
                ts: new Date().toISOString(),
                payload: { message: warning }
              });
            }
            const selectedBaseScenarios = selectScenarioIds(
              loaded.config,
              scenarioIds && scenarioIds.length > 0
                ? scenarioIds
                : scenarioId
                  ? [scenarioId]
                  : undefined
            );
            const expandedConfig = expandConfigForAgents(
              selectedBaseScenarios,
              resolveRunSelectedAgents(selectedBaseScenarios, requestedAgents)
            );
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
                const enabledScenarioIds = new Set(
                  selectedBaseScenarios.scenarios
                    .filter((scenario) => scenario.snapshot_eval?.enabled !== false)
                    .map((scenario) => scenario.id)
                );
                const scenarioBaselineMap = new Map<string, string>();
                for (const scenario of selectedBaseScenarios.scenarios) {
                  if (scenario.snapshot_eval?.enabled === false) continue;
                  const baselineId =
                    scenario.snapshot_eval?.baseline_snapshot_id ?? policy.baseline_snapshot_id;
                  if (baselineId) scenarioBaselineMap.set(scenario.id, baselineId);
                }
                const scenariosWithoutBaseline = selectedBaseScenarios.scenarios
                  .filter((scenario) => scenario.snapshot_eval?.enabled !== false)
                  .filter(
                    (scenario) =>
                      !(scenario.snapshot_eval?.baseline_snapshot_id ?? policy.baseline_snapshot_id)
                  )
                  .map((scenario) => scenario.id);
                if (scenariosWithoutBaseline.length > 0) {
                  addJobEvent(job, {
                    type: 'log',
                    ts: new Date().toISOString(),
                    payload: {
                      message: `Snapshot eval enabled but no baseline configured for scenarios: ${scenariosWithoutBaseline.join(', ')}`
                    }
                  });
                }
                const comparisons = [];
                const scenarioIdsByBaseline = new Map<string, string[]>();
                for (const [scenarioId, baselineId] of scenarioBaselineMap) {
                  const list = scenarioIdsByBaseline.get(baselineId) ?? [];
                  list.push(scenarioId);
                  scenarioIdsByBaseline.set(baselineId, list);
                }
                for (const [baselineId, scenarioIdsForBaseline] of scenarioIdsByBaseline) {
                  const snapshot = loadSnapshot(baselineId, settings.snapshotsDir);
                  const fullComparison = compareRunToSnapshot(results, snapshot);
                  comparisons.push({
                    ...fullComparison,
                    scenario_results: fullComparison.scenario_results.filter((row) =>
                      scenarioIdsForBaseline.includes(row.scenario_id)
                    )
                  });
                }
                if (comparisons.length > 0) {
                  applySnapshotPolicyToRunResult({
                    results,
                    comparisons,
                    policy,
                    enabledScenarioIds
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

      if (pathname.startsWith('/api/runs/') && method === 'DELETE') {
        const runId = pathname.replace('/api/runs/', '');
        if (!runId || runId.includes('/')) {
          asJson(res, 400, { error: 'Invalid run id' });
          return;
        }
        const runDir = ensureInsideRoot(settings.runsDir, join(settings.runsDir, runId));
        if (!existsSync(runDir)) {
          asJson(res, 404, { error: 'Run not found' });
          return;
        }
        rmSync(runDir, { recursive: true, force: true });
        asJson(res, 200, { ok: true });
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

  server.on('close', () => {
    devMcp?.stop();
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
  if (devMcp) {
    // eslint-disable-next-line no-console
    console.log(`  mcp:     ${url}${devMcp.path} -> ${devMcp.targetBaseUrl}${devMcp.path}`);
  }

  if (options.open) {
    startBrowser(url);
  }
}
