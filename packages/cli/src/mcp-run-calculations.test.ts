import { describe, expect, it } from 'vitest';
import type { ResultsJson, ScenarioAggregate, ScenarioRunResult } from '@inspectr/mcplab-core';
import {
  buildAggregateRunsReport,
  buildCompareRunsReport,
  classifyCompareRow,
  computeMetricSummary,
  type LoadedRunResult
} from '@inspectr/mcplab-mcp-server/mcp-run-calculations';

function makeRunResult(
  index: number,
  pass: boolean,
  toolCallCount: number,
  durations: number[]
): ScenarioRunResult {
  return {
    run_index: index,
    pass,
    failures: pass ? [] : [{ message: 'failed', severity: 'error' }],
    error_failures: pass ? 0 : 1,
    warning_failures: 0,
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

function makeResults(
  runId: string,
  timestamp: string,
  scenarios: ScenarioAggregate[]
): ResultsJson {
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

function makeLoadedRun(
  runId: string,
  timestamp: string,
  scenarios: ScenarioAggregate[]
): LoadedRunResult {
  return {
    run_id: runId,
    path: `/tmp/${runId}`,
    results: makeResults(runId, timestamp, scenarios)
  };
}

describe('mcp run calculation helpers', () => {
  it('computes summary metrics', () => {
    const summary = computeMetricSummary([
      makeScenario('s1', 'a1', [
        makeRunResult(0, true, 1, [10]),
        makeRunResult(1, false, 2, [20, 30])
      ])
    ]);
    expect(summary.total_runs).toBe(2);
    expect(summary.passed_runs).toBe(1);
    expect(summary.failed_runs).toBe(1);
    expect(summary.pass_rate).toBe(0.5);
    expect(summary.avg_tool_calls_per_run).toBe(1.5);
    expect(summary.avg_tool_latency_ms).toBe(20);
  });

  it('aggregates weighted metrics with scenario/agent filters and compact defaults', () => {
    const run1 = makeLoadedRun('run-1', '2026-04-20T10:00:00.000Z', [
      makeScenario('s1', 'a1', [
        makeRunResult(0, true, 2, [100, 200]),
        makeRunResult(1, false, 1, [300])
      ]),
      makeScenario('s2', 'a2', [makeRunResult(0, true, 1, [150])])
    ]);
    const run2 = makeLoadedRun('run-2', '2026-04-21T10:00:00.000Z', [
      makeScenario('s1', 'a1', [makeRunResult(0, true, 3, [100])]),
      makeScenario('s3', 'a3', [makeRunResult(0, false, 2, [400, 200])])
    ]);

    const report = buildAggregateRunsReport({
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
    expect(summary.pass_rate).toBeCloseTo(2 / 3, 3);
    expect(summary.avg_tool_calls_per_run).toBeCloseTo(2, 3);
    expect(report.details).toBeUndefined();
    expect((report.top_worst as unknown[]).length).toBe(1);
    expect((report.top_best as unknown[]).length).toBe(1);
  });

  it('classifies run comparison rows and computes headline deltas', () => {
    const left = makeLoadedRun('left', '2026-04-20T10:00:00.000Z', [
      makeScenario('reg', 'agent', [
        makeRunResult(0, true, 1, [100]),
        makeRunResult(1, true, 1, [100])
      ]),
      makeScenario('imp', 'agent', [
        makeRunResult(0, false, 2, [300]),
        makeRunResult(1, false, 2, [300])
      ]),
      makeScenario('same', 'agent', [makeRunResult(0, true, 1, [100])]),
      makeScenario('gone', 'agent', [makeRunResult(0, true, 1, [100])])
    ]);
    const right = makeLoadedRun('right', '2026-04-21T10:00:00.000Z', [
      makeScenario('reg', 'agent', [
        makeRunResult(0, false, 1, [100]),
        makeRunResult(1, true, 1, [100])
      ]),
      makeScenario('imp', 'agent', [
        makeRunResult(0, true, 1, [120]),
        makeRunResult(1, false, 1, [120])
      ]),
      makeScenario('same', 'agent', [makeRunResult(0, true, 1, [100])]),
      makeScenario('new', 'agent', [makeRunResult(0, true, 1, [90])])
    ]);

    const report = buildCompareRunsReport({
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

  it('classifies compare rows for new/missing/improved/regressed/unchanged', () => {
    const base = {
      total_runs: 1,
      passed_runs: 1,
      failed_runs: 0,
      pass_rate: 1,
      avg_tool_calls_per_run: 1,
      avg_tool_latency_ms: 10
    };
    expect(classifyCompareRow(null, base)).toBe('new');
    expect(classifyCompareRow(base, null)).toBe('missing');
    expect(classifyCompareRow({ ...base, pass_rate: 0.3 }, { ...base, pass_rate: 0.6 })).toBe(
      'improved'
    );
    expect(classifyCompareRow({ ...base, pass_rate: 0.8 }, { ...base, pass_rate: 0.2 })).toBe(
      'regressed'
    );
    expect(classifyCompareRow(base, { ...base })).toBe('unchanged');
  });
});
