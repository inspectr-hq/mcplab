import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalConfig, ResultsJson, TraceEvent } from '@inspectr/mcplab-core';
import { ensureInsideRoot } from './store-utils.js';

export interface RunSummary {
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

export type TraceUiEvent =
  | { type: 'trace_meta'; trace_version: number; run_id?: string; ts: string }
  | { type: 'scenario_started'; scenario_id: string; agent?: string; ts: string }
  | {
      type: 'llm_request';
      scenario_id?: string;
      agent?: string;
      provider?: string;
      model?: string;
      message_count?: number;
      summary?: string;
      messages_summary?: string;
      ts: string;
    }
  | {
      type: 'llm_response';
      scenario_id?: string;
      agent?: string;
      provider?: string;
      model?: string;
      tool_calls?: string[];
      has_text?: boolean;
      summary?: string;
      raw_or_summary?: string;
      ts: string;
    }
  | {
      type: 'agent_message';
      scenario_id?: string;
      agent?: string;
      phase: 'intermediate' | 'final';
      text: string;
      provider?: string;
      model?: string;
      ts: string;
    }
  | { type: 'tool_call'; scenario_id?: string; agent?: string; tool: string; args?: unknown; ts_start?: string }
  | {
      type: 'tool_result';
      scenario_id?: string;
      agent?: string;
      tool: string;
      ok: boolean;
      result_summary: string;
      duration_ms?: number;
      ts_end?: string;
    }
  | { type: 'final_answer'; scenario_id?: string; agent?: string; text: string; ts: string }
  | { type: 'scenario_finished'; scenario_id: string; agent?: string; pass: boolean; ts: string };

export function listRuns(runsDir: string): RunSummary[] {
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
      `Unknown scenarios: ${missing.join(', ')}. Available: ${config.scenarios.map((s) => s.id).join(', ')}`
    );
  }
  return { ...config, scenarios };
}

export function getTraceEvents(runId: string, runsDir: string): TraceEvent[] {
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

export function toTraceUiEvents(events: TraceEvent[]): TraceUiEvent[] {
  const normalized: TraceUiEvent[] = [];
  let activeScenarioId: string | undefined;
  let activeAgent: string | undefined;
  let pending:
    | { scenario_id?: string; agent?: string; tool: string; args?: unknown; ts_start?: string }
    | undefined;

  for (const event of events) {
    if (event.type === 'trace_meta') {
      normalized.push({
        type: 'trace_meta',
        trace_version: event.trace_version,
        run_id: event.run_id,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'scenario_started') {
      activeScenarioId = event.scenario_id;
      activeAgent = event.agent;
      normalized.push({
        type: 'scenario_started',
        scenario_id: event.scenario_id,
        agent: event.agent,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'llm_request') {
      normalized.push({
        type: 'llm_request',
        scenario_id: event.scenario_id ?? activeScenarioId,
        agent: event.agent ?? activeAgent,
        provider: event.provider,
        model: event.model,
        message_count: event.message_count,
        summary: event.summary,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'llm_response') {
      normalized.push({
        type: 'llm_response',
        scenario_id: event.scenario_id ?? activeScenarioId,
        agent: event.agent ?? activeAgent,
        provider: event.provider,
        model: event.model,
        tool_calls: event.tool_calls,
        has_text: event.has_text,
        summary: event.summary,
        raw_or_summary: event.raw_or_summary,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'agent_message') {
      normalized.push({
        type: 'agent_message',
        scenario_id: event.scenario_id ?? activeScenarioId,
        agent: event.agent ?? activeAgent,
        phase: event.phase,
        text: event.text,
        provider: event.provider,
        model: event.model,
        ts: event.ts
      });
      continue;
    }
    if (event.type === 'scenario_finished') {
      normalized.push({
        type: 'scenario_finished',
        scenario_id: event.scenario_id,
        agent: event.agent ?? activeAgent,
        pass: event.pass,
        ts: event.ts
      });
      activeScenarioId = undefined;
      activeAgent = undefined;
      continue;
    }
    if (event.type === 'tool_call') {
      pending = {
        scenario_id: event.scenario_id ?? activeScenarioId,
        agent: event.agent ?? activeAgent,
        tool: event.tool,
        args: event.args,
        ts_start: event.ts_start
      };
      normalized.push({
        type: 'tool_call',
        scenario_id: event.scenario_id ?? activeScenarioId,
        agent: event.agent ?? activeAgent,
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
        agent: event.agent ?? pending.agent ?? activeAgent,
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
        scenario_id: event.scenario_id ?? activeScenarioId,
        agent: event.agent ?? activeAgent,
        text: event.text,
        ts: event.ts
      });
    }
  }
  return normalized;
}
