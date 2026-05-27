import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalConfig, ResultsJson, ScenarioRunTraceRecord } from '@inspectr/mcplab-core';
import { ensureInsideRoot } from './store-utils.js';

export interface RunSummary {
  runId: string;
  path: string;
  timestamp: string;
  runNote?: string;
  configHash: string;
  configPath?: string;
  configName?: string;
  toolTokensTotal?: number | null;
  scenarioIds?: string[];
  scenarioNames?: string[];
  rerunAgents?: string[];
  rerunScenarioIds?: string[];
  rerunServerOverrideAll?: string[];
  rerunScenarioServerOverrides?: Record<string, string[]>;
  totalScenarios: number;
  totalRuns: number;
  passRate: number;
  avgToolCalls: number;
  avgLatencyMs: number;
}

export interface ListRunsFilter {
  since?: string;
  until?: string;
  lastDays?: number;
  scenario?: string;
}

export function listRuns(runsDir: string, filter?: ListRunsFilter): RunSummary[] {
  if (!existsSync(runsDir)) return [];
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
  const runDirs = readdirSync(runsDir).map((name) =>
    ensureInsideRoot(runsDir, join(runsDir, name))
  );
  const summaries: RunSummary[] = [];
  for (const dir of runDirs) {
    const resultsPath = join(dir, 'results.json');
    if (!existsSync(resultsPath)) continue;
    try {
      const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
      const timestampMs = new Date(results.metadata.timestamp).getTime();
      if (!Number.isFinite(timestampMs) || timestampMs < sinceMs || timestampMs > untilMs) {
        continue;
      }
      const scenarioItems = Array.isArray(results.scenarios) ? results.scenarios : [];
      if (filter?.scenario?.trim()) {
        const needle = filter.scenario.trim();
        const matchesScenario = scenarioItems.some((scenario) => {
          const scenarioId = String(scenario.scenario_id ?? '').trim();
          const scenarioName = String(scenario.scenario_name ?? '').trim();
          return scenarioId === needle || scenarioName === needle;
        });
        if (!matchesScenario) continue;
      }
      summaries.push({
        runId: results.metadata.run_id,
        path: dir,
        timestamp: results.metadata.timestamp,
        runNote: results.metadata.run_note,
        configHash: results.metadata.config_hash,
        configPath: results.metadata.config_path,
        configName: results.metadata.config_name,
        toolTokensTotal:
          typeof (results.metadata as { tool_tokens_total?: unknown }).tool_tokens_total ===
          'number'
            ? ((results.metadata as { tool_tokens_total?: number }).tool_tokens_total ?? null)
            : null,
        scenarioIds: scenarioItems.map((scenario) => String(scenario.scenario_id ?? '')).filter(Boolean),
        scenarioNames: scenarioItems
          .map((scenario) => String(scenario.scenario_name ?? ''))
          .filter(Boolean),
        rerunAgents: results.metadata.rerun_agents,
        rerunScenarioIds: results.metadata.rerun_scenario_ids,
        rerunServerOverrideAll: results.metadata.rerun_server_override_all,
        rerunScenarioServerOverrides: results.metadata.rerun_scenario_server_overrides,
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

export function getRunResults(runId: string, runsDir: string): ResultsJson {
  const runDir = ensureInsideRoot(runsDir, join(runsDir, runId));
  const resultsPath = ensureInsideRoot(runsDir, join(runDir, 'results.json'));
  if (!existsSync(resultsPath)) throw new Error(`Run not found: ${runId}`);
  return JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
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
  runsDir: string
): ScenarioRunTraceRecord[] {
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
