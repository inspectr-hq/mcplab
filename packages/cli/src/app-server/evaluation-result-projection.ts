import type { ResultsJson, RunOutcome } from '@inspectr/mcplab-core';

/** Project completed execution snapshots into the single canonical evaluation result. */
export function projectEvaluationResult(params: {
  evaluationRunId: string;
  runId: string;
  children: ResultsJson[];
  evaluationName?: string;
  failedExecutions?: number;
  stoppedExecutions?: number;
}): ResultsJson {
  const children = params.children;
  const totalRuns = children.reduce((sum, result) => sum + result.summary.total_runs, 0);
  const totalScenarios = children.reduce((sum, result) => sum + result.summary.total_scenarios, 0);
  const weighted = (field: 'avg_tool_calls_per_run' | 'avg_tool_latency_ms'): number | null => {
    if (totalRuns === 0) return null;
    const values = children.map((result) => result.summary[field]);
    if (field === 'avg_tool_latency_ms' && values.some((value) => value === null)) return null;
    return children.reduce((sum, result) => sum + (result.summary[field] ?? 0) * result.summary.total_runs, 0) / totalRuns;
  };
  const outcomes: Record<RunOutcome, number> = {
    passed: 0,
    failed: params.failedExecutions ?? 0,
    incomplete: 0,
    error: params.stoppedExecutions ?? 0
  };
  for (const result of children) {
    for (const outcome of Object.keys(outcomes) as RunOutcome[]) {
      outcomes[outcome] += result.summary.outcomes?.[outcome] ?? 0;
    }
  }
  return {
    metadata: {
      run_id: params.runId,
      timestamp: new Date().toISOString(),
      config_hash: children[0]?.metadata.config_hash ?? params.evaluationRunId,
      cli_version: children[0]?.metadata.cli_version ?? 'unknown',
      mcp_server_versions: {},
      execution_client: 'mixed',
      config_name: params.evaluationName || `Evaluation ${params.evaluationRunId}`,
      run_note: params.evaluationName ? `Evaluation: ${params.evaluationName}` : `Evaluation ${params.evaluationRunId}`,
      rerun_agents: children.flatMap((result) => result.metadata.rerun_agents ?? []),
      evaluation_run_id: params.runId
    },
    summary: {
      total_scenarios: totalScenarios,
      total_runs: totalRuns,
      pass_rate: totalRuns === 0 ? 0 : outcomes.passed / totalRuns,
      avg_tool_calls_per_run: weighted('avg_tool_calls_per_run') ?? 0,
      avg_tool_latency_ms: weighted('avg_tool_latency_ms'),
      outcomes
    },
    scenarios: children.flatMap((result) => result.scenarios)
  };
}
