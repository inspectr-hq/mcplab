import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { ResultsJson, ScenarioAggregate, ScenarioRunResult } from '@inspectr/mcplab-core';
import { __testExports } from '../../mcp-server/src/runtime.js';

function makeRunResult(
  index: number,
  pass: boolean,
  toolCallCount: number,
  durations: number[]
): ScenarioRunResult {
  return {
    run_index: index,
    pass,
    failures: pass ? [] : ['failed'],
    tool_calls: [],
    tool_call_count: toolCallCount,
    tool_sequence: [],
    tool_usage: {},
    tool_durations_ms: durations,
    final_text: '',
    extracted: {}
  };
}

function makeScenario(
  scenarioId: string,
  agent: string,
  runs: ScenarioRunResult[]
): ScenarioAggregate {
  const passRate = runs.length === 0 ? 0 : runs.filter((run) => run.pass).length / runs.length;
  return {
    scenario_id: scenarioId,
    agent,
    runs,
    pass_rate: passRate,
    distinct_sequences: {},
    tool_usage_frequency: {},
    extracted_values: {},
    last_final_answer: ''
  };
}

function makeResults(runId: string, timestamp: string, scenarios: ScenarioAggregate[]): ResultsJson {
  const allRuns = scenarios.flatMap((scenario) => scenario.runs);
  const totalRuns = allRuns.length;
  const passed = allRuns.filter((run) => run.pass).length;
  const allDurations = allRuns.flatMap((run) => run.tool_durations_ms);
  const toolCalls = allRuns.reduce((sum, run) => sum + run.tool_call_count, 0);
  return {
    metadata: {
      run_id: runId,
      timestamp,
      config_hash: `hash-${runId}`,
      cli_version: 'test',
      mcp_server_versions: {}
    },
    summary: {
      total_scenarios: scenarios.length,
      total_runs: totalRuns,
      pass_rate: totalRuns === 0 ? 0 : passed / totalRuns,
      avg_tool_calls_per_run: totalRuns === 0 ? 0 : toolCalls / totalRuns,
      avg_tool_latency_ms:
        allDurations.length === 0
          ? null
          : allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length
    },
    scenarios
  };
}

function makeLoadedRun(runId: string, timestamp: string, scenarios: ScenarioAggregate[]) {
  return {
    run_id: runId,
    path: `/tmp/${runId}`,
    results: makeResults(runId, timestamp, scenarios)
  };
}

describe('mcp run calculation helpers', () => {
  it('run_ids take precedence over latest_n', () => {
    const ids = __testExports.selectRunIdsForAnalysis('/unused', ['run-b', 'run-b', 'run-a'], 1);
    expect(ids).toEqual(['run-b', 'run-a']);
  });

  it('resolves LATEST run id and errors when no runs exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-latest-'));
    try {
      mkdirSync(join(root, '20260420-100000'));
      mkdirSync(join(root, '20260419-100000'));
      expect(__testExports.resolveRunIdToken(root, 'LATEST')).toBe('20260420-100000');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const empty = mkdtempSync(join(tmpdir(), 'mcplab-empty-'));
    try {
      expect(() => __testExports.resolveRunIdToken(empty, 'LATEST')).toThrow();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('aggregates weighted metrics with scenario/agent filters and compact defaults', () => {
    const run1 = makeLoadedRun('run-1', '2026-04-20T10:00:00.000Z', [
      makeScenario('s1', 'a1', [makeRunResult(0, true, 2, [100, 200]), makeRunResult(1, false, 1, [300])]),
      makeScenario('s2', 'a2', [makeRunResult(0, true, 1, [150])])
    ]);
    const run2 = makeLoadedRun('run-2', '2026-04-21T10:00:00.000Z', [
      makeScenario('s1', 'a1', [makeRunResult(0, true, 3, [100])]),
      makeScenario('s3', 'a3', [makeRunResult(0, false, 2, [400, 200])])
    ]);

    const report = __testExports.buildAggregateRunsReport({
      runs: [run1, run2],
      scenarioIds: ['s1'],
      agents: ['a1'],
      groupBy: 'scenario',
      topN: 1,
      includeDetails: false
    }) as Record<string, unknown>;

    const summary = report.summary as Record<string, unknown>;
    expect(summary.total_runs).toBe(3);
    expect(summary.passed_runs).toBe(2);
    expect(summary.pass_rate).toBeCloseTo(2 / 3, 6);
    expect(summary.avg_tool_calls_per_run).toBeCloseTo(2, 6);
    expect(report.details).toBeUndefined();
    expect((report.top_worst as unknown[]).length).toBe(1);
    expect((report.top_best as unknown[]).length).toBe(1);
  });

  it('classifies run comparison rows and computes headline deltas', () => {
    const left = makeLoadedRun('left', '2026-04-20T10:00:00.000Z', [
      makeScenario('reg', 'agent', [makeRunResult(0, true, 1, [100]), makeRunResult(1, true, 1, [100])]),
      makeScenario('imp', 'agent', [makeRunResult(0, false, 2, [300]), makeRunResult(1, false, 2, [300])]),
      makeScenario('same', 'agent', [makeRunResult(0, true, 1, [100])]),
      makeScenario('gone', 'agent', [makeRunResult(0, true, 1, [100])])
    ]);
    const right = makeLoadedRun('right', '2026-04-21T10:00:00.000Z', [
      makeScenario('reg', 'agent', [makeRunResult(0, false, 1, [100]), makeRunResult(1, true, 1, [100])]),
      makeScenario('imp', 'agent', [makeRunResult(0, true, 1, [120]), makeRunResult(1, false, 1, [120])]),
      makeScenario('same', 'agent', [makeRunResult(0, true, 1, [100])]),
      makeScenario('new', 'agent', [makeRunResult(0, true, 1, [90])])
    ]);

    const report = __testExports.buildCompareRunsReport({
      left,
      right,
      topN: 10,
      includeDetails: true
    }) as Record<string, unknown>;

    const summary = report.summary as Record<string, unknown>;
    const counts = summary.classification_counts as Record<string, number>;
    expect(counts.regressed).toBe(1);
    expect(counts.improved).toBe(1);
    expect(counts.unchanged).toBe(1);
    expect(counts.new).toBe(1);
    expect(counts.missing).toBe(1);

    expect((report.regressions as unknown[]).length).toBe(1);
    expect((report.improvements as unknown[]).length).toBe(1);
    expect((report.new_items as unknown[]).length).toBe(1);
    expect((report.missing_items as unknown[]).length).toBe(1);
    expect((report.details as unknown[]).length).toBe(5);
  });
});
