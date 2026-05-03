import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResultsJson } from '@inspectr/mcplab-core';
import type { ResultSource } from './types.js';

export interface ContextOptions {
  runsDir: string;
  runId: string;
  scenarioId: string;
  source?: ResultSource;
  around?: number;
  before: number;
  after: number;
}

export interface ContextResult {
  run_id: string;
  scenario_id: string;
  source: ResultSource | 'mixed';
  excerpt: string;
  line_start?: number;
  line_end?: number;
}

function readResults(runsDir: string, runId: string): ResultsJson {
  const path = join(runsDir, runId, 'results.json');
  return JSON.parse(readFileSync(path, 'utf8')) as ResultsJson;
}

function contextFromTrace(opts: ContextOptions): ContextResult {
  const tracePath = join(opts.runsDir, opts.runId, 'trace.jsonl');
  if (!existsSync(tracePath)) {
    throw new Error(`trace.jsonl not found for run ${opts.runId}`);
  }
  const lines = readFileSync(tracePath, 'utf8').split('\n');
  const center = Math.max(1, opts.around ?? 1);
  const start = Math.max(1, center - opts.before);
  const end = Math.min(lines.length, center + opts.after);
  const excerpt = lines
    .slice(start - 1, end)
    .map((line, idx) => `${start + idx}: ${line}`)
    .join('\n')
    .trim();

  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'trace',
    line_start: start,
    line_end: end,
    excerpt
  };
}

function contextFromScenarioMixed(opts: ContextOptions): ContextResult {
  const results = readResults(opts.runsDir, opts.runId);
  const scenario = results.scenarios.find((entry) => entry.scenario_id === opts.scenarioId);
  if (!scenario) {
    throw new Error(`Scenario not found in run: ${opts.scenarioId}`);
  }

  const failedRuns = scenario.runs.filter((run) => !run.pass);
  const recentFailure = failedRuns[failedRuns.length - 1];
  const excerpt = {
    metadata: {
      run_id: results.metadata.run_id,
      timestamp: results.metadata.timestamp,
      run_note: results.metadata.run_note
    },
    scenario: {
      scenario_id: scenario.scenario_id,
      agent: scenario.agent,
      pass_rate: scenario.pass_rate,
      tool_usage_frequency: scenario.tool_usage_frequency,
      last_final_answer: scenario.last_final_answer
    },
    recent_failure: recentFailure
      ? {
          run_index: recentFailure.run_index,
          error: recentFailure.error,
          failures: recentFailure.failures,
          tool_calls: recentFailure.tool_calls,
          final_text: recentFailure.final_text
        }
      : null
  };

  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'mixed',
    excerpt: JSON.stringify(excerpt, null, 2)
  };
}

function contextFromSummary(opts: ContextOptions): ContextResult {
  const summaryPath = join(opts.runsDir, opts.runId, 'summary.md');
  if (!existsSync(summaryPath)) {
    throw new Error(`summary.md not found for run ${opts.runId}`);
  }
  const lines = readFileSync(summaryPath, 'utf8').split('\n');
  const matched = lines.filter((line) => line.includes(opts.scenarioId));
  const excerpt = matched.slice(0, 20).join('\n') || lines.slice(0, 80).join('\n');
  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'summary',
    excerpt
  };
}

function contextFromResults(opts: ContextOptions): ContextResult {
  const results = readResults(opts.runsDir, opts.runId);
  const matches = results.scenarios.filter((s) => s.scenario_id === opts.scenarioId);
  if (matches.length === 0) {
    throw new Error(`Scenario not found in run: ${opts.scenarioId}`);
  }
  return {
    run_id: opts.runId,
    scenario_id: opts.scenarioId,
    source: 'results',
    excerpt: JSON.stringify(matches, null, 2)
  };
}

export function getContext(opts: ContextOptions): ContextResult {
  if (opts.around !== undefined) {
    return contextFromTrace({ ...opts, source: 'trace' });
  }
  if (!opts.source) {
    return contextFromScenarioMixed(opts);
  }
  if (opts.source === 'trace') return contextFromTrace(opts);
  if (opts.source === 'summary') return contextFromSummary(opts);
  return contextFromResults(opts);
}
