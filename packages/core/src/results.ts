import type { EvalRules, ResultsJson, ScenarioAggregate, ScenarioRunResult } from './types.js';

export function aggregateResults(params: {
  runId: string;
  timestamp: string;
  gitCommit?: string;
  configHash: string;
  cliVersion: string;
  scenarioRuns: Array<{
    scenario_id: string;
    scenario_name?: string;
    agent: string;
    eval?: EvalRules;
    runs: ScenarioRunResult[];
  }>;
}): ResultsJson {
  const scenarios: ScenarioAggregate[] = params.scenarioRuns.map((entry) => {
    const distinctSequences: Record<string, number> = {};
    const toolUsageFrequency: Record<string, number> = {};
    const extractedValues: Record<string, Record<string, number>> = {};
    const requiredStats: Record<string, number> = {};
    const forbiddenStats: Record<string, number> = {};
    let lastFinalAnswer = '';

    for (const run of entry.runs) {
      const seqKey = JSON.stringify(run.tool_sequence);
      distinctSequences[seqKey] = (distinctSequences[seqKey] ?? 0) + 1;
      for (const [tool, count] of Object.entries(run.tool_usage)) {
        toolUsageFrequency[tool] = (toolUsageFrequency[tool] ?? 0) + count;
      }
      if (entry.eval?.tool_constraints?.required_tools) {
        for (const tool of entry.eval.tool_constraints.required_tools) {
          if (run.tool_usage[tool]) {
            requiredStats[tool] = (requiredStats[tool] ?? 0) + 1;
          } else {
            requiredStats[tool] ??= 0;
          }
        }
      }
      if (entry.eval?.tool_constraints?.forbidden_tools) {
        for (const tool of entry.eval.tool_constraints.forbidden_tools) {
          if (run.tool_usage[tool]) {
            forbiddenStats[tool] = (forbiddenStats[tool] ?? 0) + 1;
          } else {
            forbiddenStats[tool] ??= 0;
          }
        }
      }
      for (const [name, value] of Object.entries(run.extracted)) {
        extractedValues[name] ??= {};
        const key = String(value);
        extractedValues[name][key] = (extractedValues[name][key] ?? 0) + 1;
      }
      lastFinalAnswer = run.final_text || lastFinalAnswer;
    }

    const passRate =
      entry.runs.length === 0 ? 0 : entry.runs.filter((run) => run.pass).length / entry.runs.length;

    const toolConstraintsStats =
      Object.keys(requiredStats).length > 0 || Object.keys(forbiddenStats).length > 0
        ? { required: requiredStats, forbidden: forbiddenStats }
        : undefined;

    return {
      scenario_id: entry.scenario_id,
      scenario_name: entry.scenario_name,
      agent: entry.agent,
      eval: entry.eval,
      tool_constraints_stats: toolConstraintsStats,
      runs: entry.runs,
      pass_rate: passRate,
      distinct_sequences: distinctSequences,
      tool_usage_frequency: toolUsageFrequency,
      extracted_values: extractedValues,
      last_final_answer: lastFinalAnswer
    };
  });

  const totalRuns = scenarios.reduce((sum, scenario) => sum + scenario.runs.length, 0);
  const totalScenarios = scenarios.length;
  const totalPasses = scenarios.reduce(
    (sum, scenario) => sum + scenario.runs.filter((run) => run.pass).length,
    0
  );
  const totalToolCalls = scenarios.reduce(
    (sum, scenario) => sum + scenario.runs.reduce((acc, run) => acc + run.tool_call_count, 0),
    0
  );
  const allDurations = scenarios.flatMap((scenario) =>
    scenario.runs.flatMap((run) => run.tool_durations_ms)
  );
  const avgLatency =
    allDurations.length === 0
      ? null
      : allDurations.reduce((a, b) => a + b, 0) / allDurations.length;

  return {
    metadata: {
      run_id: params.runId,
      timestamp: params.timestamp,
      git_commit: params.gitCommit,
      config_hash: params.configHash,
      cli_version: params.cliVersion
    },
    summary: {
      total_scenarios: totalScenarios,
      total_runs: totalRuns,
      pass_rate: totalRuns === 0 ? 0 : totalPasses / totalRuns,
      avg_tool_calls_per_run: totalRuns === 0 ? 0 : totalToolCalls / totalRuns,
      avg_tool_latency_ms: avgLatency
    },
    scenarios
  };
}

export function renderSummaryMarkdown(results: ResultsJson): string {
  const lines: string[] = [];
  lines.push(`# MCP Eval Summary`);
  lines.push('');
  lines.push(`Run ID: ${results.metadata.run_id}`);
  lines.push(`Timestamp: ${results.metadata.timestamp}`);
  if (results.metadata.git_commit) {
    lines.push(`Git commit: ${results.metadata.git_commit}`);
  }
  lines.push(`Config hash: ${results.metadata.config_hash}`);
  lines.push(`CLI version: ${results.metadata.cli_version}`);
  lines.push('');
  lines.push(`Total scenarios: ${results.summary.total_scenarios}`);
  lines.push(`Total runs: ${results.summary.total_runs}`);
  lines.push(`Pass rate: ${(results.summary.pass_rate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('| Scenario | Agent | Runs | Pass rate | Distinct sequences | Tool calls |');
  lines.push('|---|---|---|---|---|---|');
  for (const scenario of results.scenarios) {
    const passRate = (scenario.pass_rate * 100).toFixed(1);
    const toolCalls = scenario.runs.reduce((sum, run) => sum + run.tool_call_count, 0);
    lines.push(
      `| ${scenario.scenario_id} | ${scenario.agent} | ${scenario.runs.length} | ${passRate}% | ${
        Object.keys(scenario.distinct_sequences).length
      } | ${toolCalls} |`
    );
  }
  return lines.join('\n');
}
