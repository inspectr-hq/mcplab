import type { ResultsJson, RunOutcome } from '@inspectr/mcplab-core';

/** Project completed execution snapshots into the single canonical evaluation result. */
export function projectEvaluationResult(params: {
  evaluationRunId: string;
  runId: string;
  executions: ResultsJson[];
  evaluationName?: string;
  failedExecutions?: number;
  stoppedExecutions?: number;
}): ResultsJson {
  const executions = params.executions;
  const failedExecutions = params.failedExecutions ?? 0;
  const stoppedExecutions = params.stoppedExecutions ?? 0;
  const totalRuns = executions.reduce((sum, result) => sum + result.summary.total_runs, 0) + failedExecutions + stoppedExecutions;
  const totalScenarios = executions.reduce((sum, result) => sum + result.summary.total_scenarios, 0);
  const weighted = (field: 'avg_tool_calls_per_run' | 'avg_tool_latency_ms'): number | null => {
    if (totalRuns === 0) return null;
    const values = executions.map((result) => result.summary[field]);
    if (field === 'avg_tool_latency_ms' && values.some((value) => value === null)) return null;
    return executions.reduce((sum, result) => sum + (result.summary[field] ?? 0) * result.summary.total_runs, 0) / totalRuns;
  };
  const outcomes: Record<RunOutcome, number> = {
    passed: 0,
    failed: failedExecutions,
    incomplete: 0,
    error: stoppedExecutions
  };
  for (const result of executions) {
    for (const outcome of Object.keys(outcomes) as RunOutcome[]) {
      outcomes[outcome] += result.summary.outcomes?.[outcome] ?? 0;
    }
  }
  return {
    metadata: {
      run_id: params.runId,
      timestamp: new Date().toISOString(),
      config_hash: executions[0]?.metadata.config_hash ?? params.evaluationRunId,
      cli_version: executions[0]?.metadata.cli_version ?? 'unknown',
      mcp_server_versions: {},
      execution_client: 'mixed',
      config_name: params.evaluationName || `Evaluation ${params.evaluationRunId}`,
      run_note: params.evaluationName ? `Evaluation: ${params.evaluationName}` : `Evaluation ${params.evaluationRunId}`,
      rerun_agents: executions.flatMap((result) => result.metadata.rerun_agents ?? []),
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
    scenarios: executions.flatMap((result) => result.scenarios)
  };
}
