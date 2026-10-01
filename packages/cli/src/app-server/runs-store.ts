import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listRunDirectories,
  snapshotRunDirectory,
  snapshotsEqual,
  tallyCheckCounts,
  type ResultsJson,
  type RunDirectorySnapshot
} from '@inspectr/mcplab-core';
import type {
  EvalConfig,
  ExecutionSource,
  RunOutcome,
  ScenarioRunTraceRecord
} from '@inspectr/mcplab-core';
import { ensureInsideRoot } from './store-utils.js';

export class RunStoreError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'RunStoreError';
  }
}

export class RunNotFoundError extends RunStoreError {
  constructor(runId: string) {
    super(404, `Run not found: ${runId}`);
    this.name = 'RunNotFoundError';
  }
}

export class RunValidationError extends RunStoreError {
  constructor(runId: string, message: string) {
    super(422, `Invalid run ${runId}: ${message}`);
    this.name = 'RunValidationError';
  }
}

export interface RunSummary {
  runId: string;
  /** Parent evaluation identity for queue/grouped runs, when present. */
  evaluationRunId?: string;
  path: string;
  timestamp: string;
  runNote?: string;
  configHash: string;
  configPath?: string;
  configName?: string;
  mcpServerVersions?: Record<string, string | null>;
  langsmithTraceUrls?: Record<string, string>;
  toolTokensTotal?: number | null;
  scenarioIds?: string[];
  scenarioNames?: string[];
  agentIds?: string[];
  rerunAgents?: string[];
  rerunScenarioIds?: string[];
  rerunServerOverrideAll?: string[];
  rerunScenarioServerOverrides?: Record<string, string[]>;
  totalScenarios: number;
  totalRuns: number;
  passRate: number;
  avgToolCalls: number;
  avgLatencyMs: number;
  totalDurationMs?: number;
  totalToolDurationMs?: number;
  outcomes?: Record<RunOutcome, number>;
  executionSource?: ExecutionSource;
  executionClient?: string;
  checkCounts: {
    passed: number;
    failed: number;
    not_evaluated: number;
    not_executed?: number;
    total: number;
  };
}

export interface ListRunsFilter {
  since?: string;
  until?: string;
  lastDays?: number;
  scenario?: string;
}

interface CachedRunSummary {
  snapshot: RunDirectorySnapshot;
  summary: RunSummary;
}

const runSummaryCache = new Map<string, Map<string, CachedRunSummary>>();

function cacheFor(runsDir: string): Map<string, CachedRunSummary> {
  const key = ensureInsideRoot(runsDir, runsDir);
  const existing = runSummaryCache.get(key);
  if (existing) return existing;
  const created = new Map<string, CachedRunSummary>();
  runSummaryCache.set(key, created);
  return created;
}

export function invalidateRunSummaryCache(runsDir: string, runId: string): void {
  cacheFor(runsDir).delete(runId);
}

function validateRunResults(runId: string, results: ResultsJson): void {
  if (!results || typeof results !== 'object' || !results.metadata) {
    throw new RunValidationError(runId, 'metadata is missing');
  }
  if (results.metadata.run_id !== runId) {
    throw new RunValidationError(
      runId,
      `metadata.run_id must match the run directory name (received ${String(results.metadata.run_id)})`
    );
  }
}

function readAndValidateRunResults(runId: string, resultsPath: string): ResultsJson {
  let parsed: ResultsJson;
  try {
    parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunValidationError(runId, `results.json could not be parsed (${message})`);
  }
  validateRunResults(runId, parsed);
  return parsed;
}

function buildRunSummary(runId: string, dir: string, results: ResultsJson): RunSummary {
  const scenarioItems = Array.isArray(results.scenarios) ? results.scenarios : [];
  const checkCounts = tallyCheckCounts(
    scenarioItems.flatMap((scenario) =>
      (scenario.runs ?? []).flatMap((run) => run.check_results ?? [])
    )
  );
  return {
    runId,
    evaluationRunId: results.metadata.evaluation_run_id ?? results.metadata.evaluation_group_id,
    path: dir,
    timestamp: results.metadata.timestamp,
    runNote: results.metadata.run_note,
    configHash: results.metadata.config_hash,
    configPath: results.metadata.config_path,
    configName: results.metadata.config_name,
    mcpServerVersions: results.metadata.mcp_server_versions,
    langsmithTraceUrls: results.metadata.langsmith_trace_urls,
    toolTokensTotal:
      typeof (results.metadata as { tool_tokens_total?: unknown }).tool_tokens_total === 'number'
        ? ((results.metadata as { tool_tokens_total?: number }).tool_tokens_total ?? null)
        : null,
    scenarioIds: scenarioItems
      .map((scenario) => String(scenario.scenario_id ?? ''))
      .filter(Boolean),
    scenarioNames: scenarioItems
      .map((scenario) => String(scenario.scenario_name ?? ''))
      .filter(Boolean),
    agentIds: scenarioItems.map((scenario) => String(scenario.agent ?? '')).filter(Boolean),
    rerunAgents: results.metadata.rerun_agents,
    rerunScenarioIds: results.metadata.rerun_scenario_ids,
    rerunServerOverrideAll: results.metadata.rerun_server_override_all,
    rerunScenarioServerOverrides: results.metadata.rerun_scenario_server_overrides,
    totalScenarios: results.summary.total_scenarios,
    totalRuns: results.summary.total_runs,
    passRate: results.summary.pass_rate,
    avgToolCalls: results.summary.avg_tool_calls_per_run,
    avgLatencyMs: results.summary.avg_tool_latency_ms ?? 0,
    totalToolDurationMs:
      typeof (results.metadata as { total_tool_duration_ms?: unknown }).total_tool_duration_ms ===
      'number'
        ? Math.max(
            0,
            (results.metadata as { total_tool_duration_ms?: number }).total_tool_duration_ms ?? 0
          )
        : undefined,
    totalDurationMs:
      typeof (results.metadata as { total_duration_ms?: unknown }).total_duration_ms === 'number'
        ? Math.max(0, (results.metadata as { total_duration_ms?: number }).total_duration_ms ?? 0)
        : undefined,
    outcomes: results.summary.outcomes,
    executionSource: results.metadata.execution_source,
    executionClient: results.metadata.execution_client,
    checkCounts
  };
}

export function listRuns(runsDir: string, filter?: ListRunsFilter): RunSummary[] {
  const sinceParsedMs = filter?.since ? new Date(filter.since).getTime() : NaN;
  const untilParsedMs = filter?.until ? new Date(filter.until).getTime() : NaN;
  const sinceMsFromIso = Number.isFinite(sinceParsedMs) ? sinceParsedMs : Number.NEGATIVE_INFINITY;
  const untilMsFromIso = Number.isFinite(untilParsedMs) ? untilParsedMs : Number.POSITIVE_INFINITY;
  const lastDays =
    typeof filter?.lastDays === 'number' && Number.isFinite(filter.lastDays) && filter.lastDays > 0
      ? filter.lastDays
      : null;
  const sinceMsFromLastDays =
    lastDays !== null ? Date.now() - lastDays * 24 * 60 * 60 * 1000 : Number.NEGATIVE_INFINITY;
  const sinceMs = Math.max(sinceMsFromIso, sinceMsFromLastDays);
  const untilMs = untilMsFromIso;
  const cache = cacheFor(runsDir);
  const runIds = listRunDirectories(runsDir);
  const currentRunIds = new Set(runIds);
  for (const cachedRunId of cache.keys()) {
    if (!currentRunIds.has(cachedRunId)) cache.delete(cachedRunId);
  }

  const summaries: RunSummary[] = [];
  for (const runId of runIds) {
    const dir = ensureInsideRoot(runsDir, join(runsDir, runId));
    const snapshot = snapshotRunDirectory(runsDir, runId, ['results.json']);
    if (!snapshot?.files['results.json']) {
      cache.delete(runId);
      continue;
    }

    const cached = cache.get(runId);
    let summary = cached?.summary;
    if (!cached || !snapshotsEqual(cached.snapshot, snapshot)) {
      try {
        const results = readAndValidateRunResults(
          runId,
          ensureInsideRoot(runsDir, join(dir, 'results.json'))
        );
        summary = buildRunSummary(runId, dir, results);
        cache.set(runId, { snapshot, summary });
      } catch {
        cache.delete(runId);
        continue;
      }
    }

    if (!summary) continue;

    const timestampMs = new Date(summary.timestamp).getTime();
    if (!Number.isFinite(timestampMs) || timestampMs < sinceMs || timestampMs > untilMs) {
      continue;
    }
    const scenarioItems = summary.scenarioIds ?? [];
    if (filter?.scenario?.trim()) {
      const needle = filter.scenario.trim();
      const matchesScenario =
        scenarioItems.includes(needle) || (summary.scenarioNames ?? []).includes(needle);
      if (!matchesScenario) continue;
    }
    summaries.push(summary);
  }
  return summaries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function getRunResults(runId: string, runsDir: string): ResultsJson {
  if (!runId.trim() || runId.includes('/') || runId.includes('\\')) {
    throw new RunStoreError(400, 'Invalid run id');
  }
  const runDir = ensureInsideRoot(runsDir, join(runsDir, runId));
  const resultsPath = ensureInsideRoot(runsDir, join(runDir, 'results.json'));
  if (!existsSync(runDir) || !existsSync(resultsPath)) throw new RunNotFoundError(runId);
  return readAndValidateRunResults(runId, resultsPath);
}

export function selectScenarioIds(config: EvalConfig, requestedScenarioIds?: string[]): EvalConfig {
  if (!requestedScenarioIds || requestedScenarioIds.length === 0) return config;
  const requested = requestedScenarioIds.map((id) => id.trim()).filter(Boolean);
  if (requested.length === 0) return config;
  const requestedSet = new Set(requested);
  const scenarios = config.scenarios.filter((scenario) => requestedSet.has(scenario.id));
  const foundSet = new Set(scenarios.map((scenario) => scenario.id));
  const missing = requested.filter((id) => !foundSet.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Unknown scenarios: ${missing.join(', ')}. Available: ${config.scenarios
        .map((s) => s.id)
        .join(', ')}`
    );
  }
  return { ...config, scenarios };
}

export function getScenarioRunTraceRecords(
  runId: string,
  runsDir: string,
  options?: { requireResults?: boolean }
): ScenarioRunTraceRecord[] {
  if (options?.requireResults !== false) getRunResults(runId, runsDir);
  else if (!runId.trim() || runId.includes('/') || runId.includes('\\')) {
    throw new RunStoreError(400, 'Invalid run id');
  }
  const runDir = ensureInsideRoot(runsDir, join(runsDir, runId));
  const tracePath = ensureInsideRoot(runsDir, join(runDir, 'trace.jsonl'));
  if (!existsSync(tracePath)) return [];
  const lines = readFileSync(tracePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const records: ScenarioRunTraceRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (
        parsed &&
        parsed.type === 'scenario_run' &&
        parsed.trace_version === 3 &&
        typeof parsed.scenario_id === 'string' &&
        typeof parsed.agent === 'string'
      ) {
        records.push(parsed as unknown as ScenarioRunTraceRecord);
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return records;
}
