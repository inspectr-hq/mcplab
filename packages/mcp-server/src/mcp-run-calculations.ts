import type { ResultsJson } from '@inspectr/mcplab-core';

type AggregateGroupBy = 'run' | 'scenario' | 'agent';

type MetricSummary = {
  total_runs: number;
  passed_runs: number;
  failed_runs: number;
  pass_rate: number;
  avg_tool_calls_per_run: number;
  avg_tool_latency_ms: number | null;
};

type AggregateGroupRow = MetricSummary & {
  key: string;
  run_id?: string;
  scenario_id?: string;
  agent?: string;
  run_count: number;
  timestamp_range?: {
    min: string;
    max: string;
  };
};

type CompareClass = 'regressed' | 'improved' | 'unchanged' | 'new' | 'missing';

type CompareRow = {
  key: string;
  scenario_id: string;
  agent: string;
  classification: CompareClass;
  left: MetricSummary | null;
  right: MetricSummary | null;
  deltas: {
    pass_rate: number | null;
    failed_runs: number | null;
    avg_tool_calls_per_run: number | null;
    avg_tool_latency_ms: number | null;
  };
};

export type LoadedRunResult = {
  run_id: string;
  path: string;
  results: ResultsJson;
};

export function buildAggregateRunsReport(params: {
  runs: LoadedRunResult[];
  scenarioIds?: string[];
  agents?: string[];
  groupBy: AggregateGroupBy;
  topN: number;
  includeDetails: boolean;
}): Record<string, unknown> {
  const scenarioFilter = normalizeOptionalFilterSet(params.scenarioIds);
  const agentFilter = normalizeOptionalFilterSet(params.agents);
  const selectedRuns = params.runs.map((run) => ({
    run_id: run.run_id,
    timestamp: run.results.metadata.timestamp,
    config_hash: run.results.metadata.config_hash
  }));
  const overallMetrics = computeMetricSummary(
    params.runs.flatMap((run) =>
      filterScenarios(run.results.scenarios, scenarioFilter, agentFilter)
    )
  );
  const rows = buildAggregateRows(params.runs, params.groupBy, scenarioFilter, agentFilter);
  const worstRows = [...rows]
    .sort(compareRowsWorstFirst)
    .slice(0, params.topN)
    .map(toSerializableAggregateRow);
  const bestRows = [...rows]
    .sort(compareRowsBestFirst)
    .slice(0, params.topN)
    .map(toSerializableAggregateRow);

  return removeUndefined({
    runs: selectedRuns,
    group_by: params.groupBy,
    filters: removeUndefined({
      scenario_ids: params.scenarioIds?.length ? params.scenarioIds : undefined,
      agents: params.agents?.length ? params.agents : undefined
    }),
    summary: removeUndefined({
      ...overallMetrics,
      selected_run_count: params.runs.length
    }),
    top_worst: worstRows,
    top_best: bestRows,
    details: params.includeDetails
      ? rows.sort(compareRowsWorstFirst).map(toSerializableAggregateRow)
      : undefined
  });
}

export function buildCompareRunsReport(params: {
  left: LoadedRunResult;
  right: LoadedRunResult;
  scenarioIds?: string[];
  agents?: string[];
  topN: number;
  includeDetails: boolean;
}): Record<string, unknown> {
  const scenarioFilter = normalizeOptionalFilterSet(params.scenarioIds);
  const agentFilter = normalizeOptionalFilterSet(params.agents);
  const leftScenarios = filterScenarios(params.left.results.scenarios, scenarioFilter, agentFilter);
  const rightScenarios = filterScenarios(
    params.right.results.scenarios,
    scenarioFilter,
    agentFilter
  );
  const leftSummary = computeMetricSummary(leftScenarios);
  const rightSummary = computeMetricSummary(rightScenarios);

  const leftMap = buildScenarioAgentMetricMap(leftScenarios);
  const rightMap = buildScenarioAgentMetricMap(rightScenarios);
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const rows: CompareRow[] = [];
  for (const key of keys) {
    const leftEntry = leftMap.get(key) ?? null;
    const rightEntry = rightMap.get(key) ?? null;
    const classification = classifyCompareRow(
      leftEntry?.summary ?? null,
      rightEntry?.summary ?? null
    );
    rows.push({
      key,
      scenario_id: leftEntry?.scenario_id ?? rightEntry?.scenario_id ?? '',
      agent: leftEntry?.agent ?? rightEntry?.agent ?? '',
      classification,
      left: leftEntry?.summary ?? null,
      right: rightEntry?.summary ?? null,
      deltas: {
        pass_rate:
          leftEntry && rightEntry
            ? roundedDelta(rightEntry.summary.pass_rate - leftEntry.summary.pass_rate)
            : null,
        failed_runs:
          leftEntry && rightEntry
            ? rightEntry.summary.failed_runs - leftEntry.summary.failed_runs
            : null,
        avg_tool_calls_per_run:
          leftEntry && rightEntry
            ? roundedDelta(
                rightEntry.summary.avg_tool_calls_per_run - leftEntry.summary.avg_tool_calls_per_run
              )
            : null,
        avg_tool_latency_ms:
          leftEntry && rightEntry
            ? nullableRoundedDelta(
                rightEntry.summary.avg_tool_latency_ms,
                leftEntry.summary.avg_tool_latency_ms
              )
            : null
      }
    });
  }

  const regressions = rows
    .filter((row) => row.classification === 'regressed')
    .sort(compareRegressionRows)
    .slice(0, params.topN);
  const improvements = rows
    .filter((row) => row.classification === 'improved')
    .sort(compareImprovementRows)
    .slice(0, params.topN);
  const newItems = rows
    .filter((row) => row.classification === 'new')
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, params.topN);
  const missingItems = rows
    .filter((row) => row.classification === 'missing')
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, params.topN);

  const classificationCounts = rows.reduce<Record<CompareClass, number>>(
    (acc, row) => {
      acc[row.classification] += 1;
      return acc;
    },
    { regressed: 0, improved: 0, unchanged: 0, new: 0, missing: 0 }
  );

  return removeUndefined({
    left_run: {
      run_id: params.left.run_id,
      timestamp: params.left.results.metadata.timestamp,
      config_hash: params.left.results.metadata.config_hash
    },
    right_run: {
      run_id: params.right.run_id,
      timestamp: params.right.results.metadata.timestamp,
      config_hash: params.right.results.metadata.config_hash
    },
    filters: removeUndefined({
      scenario_ids: params.scenarioIds?.length ? params.scenarioIds : undefined,
      agents: params.agents?.length ? params.agents : undefined
    }),
    summary: {
      left: leftSummary,
      right: rightSummary,
      deltas: {
        pass_rate: roundedDelta(rightSummary.pass_rate - leftSummary.pass_rate),
        failed_runs: rightSummary.failed_runs - leftSummary.failed_runs,
        avg_tool_calls_per_run: roundedDelta(
          rightSummary.avg_tool_calls_per_run - leftSummary.avg_tool_calls_per_run
        ),
        avg_tool_latency_ms: nullableRoundedDelta(
          rightSummary.avg_tool_latency_ms,
          leftSummary.avg_tool_latency_ms
        )
      },
      classification_counts: classificationCounts
    },
    regressions: regressions.map(toSerializableCompareRow),
    improvements: improvements.map(toSerializableCompareRow),
    new_items: newItems.map(toSerializableCompareRow),
    missing_items: missingItems.map(toSerializableCompareRow),
    details: params.includeDetails
      ? rows
          .sort(
            (a, b) =>
              compareClassPriority(a.classification) - compareClassPriority(b.classification) ||
              a.key.localeCompare(b.key)
          )
          .map(toSerializableCompareRow)
      : undefined
  });
}

export function computeMetricSummary(scenarios: ResultsJson['scenarios']): MetricSummary {
  const runs = scenarios.flatMap((s) => s.runs);
  const totalRuns = runs.length;
  const passedRuns = runs.filter((r) => r.pass).length;
  const failedRuns = totalRuns - passedRuns;
  const totalToolCalls = runs.reduce((sum, r) => sum + r.tool_call_count, 0);
  const allDurations = runs.flatMap((r) => r.tool_durations_ms ?? []);
  return {
    total_runs: totalRuns,
    passed_runs: passedRuns,
    failed_runs: failedRuns,
    pass_rate: totalRuns === 0 ? 0 : roundedDelta(passedRuns / totalRuns),
    avg_tool_calls_per_run: totalRuns === 0 ? 0 : roundedDelta(totalToolCalls / totalRuns),
    avg_tool_latency_ms:
      allDurations.length === 0
        ? null
        : roundedDelta(allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length)
  };
}

export function buildAggregateRows(
  runs: LoadedRunResult[],
  groupBy: AggregateGroupBy,
  scenarioFilter: Set<string> | null,
  agentFilter: Set<string> | null
): AggregateGroupRow[] {
  const grouped = new Map<
    string,
    { scenarios: ResultsJson['scenarios']; run_ids: string[]; timestamps: string[] }
  >();
  for (const run of runs) {
    const selected = filterScenarios(run.results.scenarios, scenarioFilter, agentFilter);
    if (groupBy === 'run') {
      grouped.set(run.run_id, {
        scenarios: selected,
        run_ids: [run.run_id],
        timestamps: [run.results.metadata.timestamp]
      });
      continue;
    }
    for (const scenario of selected) {
      const key = groupBy === 'scenario' ? scenario.scenario_id : scenario.agent;
      const existing = grouped.get(key) ?? { scenarios: [], run_ids: [], timestamps: [] };
      existing.scenarios.push({ ...scenario, runs: [...scenario.runs] });
      existing.run_ids.push(run.run_id);
      existing.timestamps.push(run.results.metadata.timestamp);
      grouped.set(key, existing);
    }
  }

  return Array.from(grouped.entries()).map(([key, value]) => {
    const summary = computeMetricSummary(value.scenarios);
    const out: AggregateGroupRow = {
      key,
      ...summary,
      run_count: value.run_ids.length
    };
    if (groupBy === 'run') {
      out.run_id = key;
    } else if (groupBy === 'scenario') {
      out.scenario_id = key;
    } else {
      out.agent = key;
    }
    if (value.timestamps.length > 0) {
      const sorted = [...value.timestamps].sort();
      out.timestamp_range = { min: sorted[0]!, max: sorted[sorted.length - 1]! };
    }
    return out;
  });
}

export function classifyCompareRow(
  left: MetricSummary | null,
  right: MetricSummary | null
): CompareClass {
  if (!left && right) return 'new';
  if (left && !right) return 'missing';
  if (!left || !right) return 'unchanged';
  const delta = roundedDelta(right.pass_rate - left.pass_rate);
  if (delta > 0.001) return 'improved';
  if (delta < -0.001) return 'regressed';
  return 'unchanged';
}

function filterScenarios(
  scenarios: ResultsJson['scenarios'],
  scenarioFilter: Set<string> | null,
  agentFilter: Set<string> | null
): ResultsJson['scenarios'] {
  return scenarios.filter((scenario) => {
    const scenarioOk = !scenarioFilter || scenarioFilter.has(scenario.scenario_id);
    const agentOk = !agentFilter || agentFilter.has(scenario.agent);
    return scenarioOk && agentOk;
  });
}

function normalizeOptionalFilterSet(values?: string[]): Set<string> | null {
  if (!values || values.length === 0) return null;
  return new Set(values.map((value) => value.trim()).filter(Boolean));
}

function buildScenarioAgentMetricMap(
  scenarios: ResultsJson['scenarios']
): Map<string, { scenario_id: string; agent: string; summary: MetricSummary }> {
  const map = new Map<string, { scenario_id: string; agent: string; summary: MetricSummary }>();
  for (const scenario of scenarios) {
    const key = `${scenario.scenario_id}::${scenario.agent}`;
    map.set(key, {
      scenario_id: scenario.scenario_id,
      agent: scenario.agent,
      summary: computeMetricSummary([{ ...scenario, runs: [...scenario.runs] }])
    });
  }
  return map;
}

function compareRowsWorstFirst(a: AggregateGroupRow, b: AggregateGroupRow): number {
  return (
    a.pass_rate - b.pass_rate ||
    b.failed_runs - a.failed_runs ||
    b.avg_tool_calls_per_run - a.avg_tool_calls_per_run ||
    compareNullableNumbersDesc(a.avg_tool_latency_ms, b.avg_tool_latency_ms) ||
    a.key.localeCompare(b.key)
  );
}

function compareRowsBestFirst(a: AggregateGroupRow, b: AggregateGroupRow): number {
  return (
    b.pass_rate - a.pass_rate ||
    a.failed_runs - b.failed_runs ||
    a.avg_tool_calls_per_run - b.avg_tool_calls_per_run ||
    compareNullableNumbersAsc(a.avg_tool_latency_ms, b.avg_tool_latency_ms) ||
    a.key.localeCompare(b.key)
  );
}

function compareRegressionRows(a: CompareRow, b: CompareRow): number {
  const aDelta = a.deltas.pass_rate ?? 0;
  const bDelta = b.deltas.pass_rate ?? 0;
  return (
    aDelta - bDelta ||
    (b.deltas.failed_runs ?? 0) - (a.deltas.failed_runs ?? 0) ||
    a.key.localeCompare(b.key)
  );
}

function compareImprovementRows(a: CompareRow, b: CompareRow): number {
  const aDelta = a.deltas.pass_rate ?? 0;
  const bDelta = b.deltas.pass_rate ?? 0;
  return (
    bDelta - aDelta ||
    (a.deltas.failed_runs ?? 0) - (b.deltas.failed_runs ?? 0) ||
    a.key.localeCompare(b.key)
  );
}

function compareClassPriority(classification: CompareClass): number {
  if (classification === 'regressed') return 0;
  if (classification === 'improved') return 1;
  if (classification === 'new') return 2;
  if (classification === 'missing') return 3;
  return 4;
}

function toSerializableAggregateRow(row: AggregateGroupRow): Record<string, unknown> {
  return removeUndefined({
    key: row.key,
    run_id: row.run_id,
    scenario_id: row.scenario_id,
    agent: row.agent,
    run_count: row.run_count,
    timestamp_range: row.timestamp_range,
    summary: {
      total_runs: row.total_runs,
      passed_runs: row.passed_runs,
      failed_runs: row.failed_runs,
      pass_rate: row.pass_rate,
      avg_tool_calls_per_run: row.avg_tool_calls_per_run,
      avg_tool_latency_ms: row.avg_tool_latency_ms
    }
  });
}

function toSerializableCompareRow(row: CompareRow): Record<string, unknown> {
  return removeUndefined({
    key: row.key,
    scenario_id: row.scenario_id,
    agent: row.agent,
    classification: row.classification,
    left: row.left,
    right: row.right,
    deltas: row.deltas
  });
}

function compareNullableNumbersDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compareNullableNumbersAsc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function roundedDelta(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function nullableRoundedDelta(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return roundedDelta(left - right);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
