import { calculatePassRate } from '@inspectr/mcplab-core';
import type { ResultsJson, RunOutcome } from '@inspectr/mcplab-core';

/** Project completed execution snapshots into the single canonical evaluation result. */
export function projectEvaluationResult(params: {
  evaluationRunId: string;
  runId: string;
  executions: ResultsJson[];
  evaluationName?: string;
  runNote?: string;
  failedExecutions?: number;
  stoppedExecutions?: number;
}): ResultsJson {
  const executions = params.executions;
  const failedExecutions = params.failedExecutions ?? 0;
  const stoppedExecutions = params.stoppedExecutions ?? 0;
  const totalRuns =
    executions.reduce((sum, result) => sum + result.summary.total_runs, 0) +
    failedExecutions +
    stoppedExecutions;
  const totalScenarios = executions.reduce(
    (sum, result) => sum + result.summary.total_scenarios,
    0
  );
  const weighted = (field: 'avg_tool_calls_per_run' | 'avg_tool_latency_ms'): number | null => {
    if (totalRuns === 0) return null;
    const values = executions.map((result) => result.summary[field]);
    if (field === 'avg_tool_latency_ms' && values.some((value) => value === null)) return null;
    return (
      executions.reduce(
        (sum, result) => sum + (result.summary[field] ?? 0) * result.summary.total_runs,
        0
      ) / totalRuns
    );
  };
  const outcomes: Partial<Record<RunOutcome, number>> = {
    passed: 0,
    failed: failedExecutions,
    incomplete: 0,
    error: 0,
    stopped: stoppedExecutions
  };
  for (const result of executions) {
    for (const outcome of Object.keys(outcomes) as RunOutcome[]) {
      outcomes[outcome] = (outcomes[outcome] ?? 0) + (result.summary.outcomes?.[outcome] ?? 0);
    }
  }
  if (outcomes.stopped === 0) delete outcomes.stopped;
  const sourceMetadata = executions[0]?.metadata;
  const configPaths = Array.from(
    new Set(executions.map((result) => result.metadata.config_path).filter(Boolean))
  );
  const rerunAgents = Array.from(
    new Set(executions.flatMap((result) => result.metadata.rerun_agents ?? []))
  );
  const rerunScenarioIds = Array.from(
    new Set(executions.flatMap((result) => result.metadata.rerun_scenario_ids ?? []))
  );
  // Children share evaluation overrides, but Rover snapshots may omit them and
  // MCP snapshots contain only the overrides for their selected scenarios.
  const serverOverrideAll = executions.find(
    (result) => (result.metadata.rerun_server_override_all?.length ?? 0) > 0
  )?.metadata.rerun_server_override_all;
  // Trace URLs are keyed by per-run request IDs, so merging child executions cannot collide.
  const langsmithTraceUrls = Object.fromEntries(
    executions.flatMap((result) => Object.entries(result.metadata.langsmith_trace_urls ?? {}))
  );
  const scenarioServerOverrides = Object.fromEntries(
    executions.flatMap((result) =>
      Object.entries(result.metadata.rerun_scenario_server_overrides ?? {})
    )
  );
  const executionSources = new Set(
    executions.map((result) => result.metadata.execution_source).filter(Boolean)
  );
  const executionClients = new Set(
    executions.map((result) => result.metadata.execution_client).filter(Boolean)
  );
  const aggregateNumericMetadata = (
    key: 'tool_tokens_total' | 'total_duration_ms' | 'total_tool_duration_ms'
  ): number | undefined => {
    const values = executions.map((result) => result.metadata[key]);
    const numericValues = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (values.length === 0 || numericValues.length !== values.length) {
      return undefined;
    }
    return numericValues.reduce((sum, value) => sum + value, 0);
  };
  const mcpServerVersions = new Map<string, string | null>();
  for (const execution of executions) {
    for (const [serverId, version] of Object.entries(
      execution.metadata.mcp_server_versions ?? {}
    )) {
      const previous = mcpServerVersions.get(serverId);
      if (!mcpServerVersions.has(serverId)) mcpServerVersions.set(serverId, version);
      else if (previous !== version) mcpServerVersions.set(serverId, null);
    }
  }
  const toolTokensTotal = aggregateNumericMetadata('tool_tokens_total');
  const totalDurationMs = aggregateNumericMetadata('total_duration_ms');
  const totalToolDurationMs = aggregateNumericMetadata('total_tool_duration_ms');
  const executionClient =
    executionClients.size === 1
      ? Array.from(executionClients)[0]
      : executionClients.size > 1
        ? 'mixed'
        : undefined;
  return {
    metadata: {
      run_id: params.runId,
      timestamp: new Date().toISOString(),
      config_hash: sourceMetadata?.config_hash ?? params.evaluationRunId,
      config_path: configPaths.length === 1 ? configPaths[0] : undefined,
      cli_version: sourceMetadata?.cli_version ?? 'unknown',
      mcp_server_versions: Object.fromEntries(mcpServerVersions),
      ...(toolTokensTotal !== undefined ? { tool_tokens_total: toolTokensTotal } : {}),
      ...(totalDurationMs !== undefined ? { total_duration_ms: totalDurationMs } : {}),
      ...(totalToolDurationMs !== undefined ? { total_tool_duration_ms: totalToolDurationMs } : {}),
      ...(executionClient ? { execution_client: executionClient } : {}),
      ...(executionSources.size === 1
        ? { execution_source: executions[0]?.metadata.execution_source }
        : {}),
      config_name:
        params.evaluationName ||
        sourceMetadata?.config_name ||
        `Evaluation ${params.evaluationRunId}`,
      ...(params.runNote?.trim() ? { run_note: params.runNote.trim() } : {}),
      ...(Object.keys(langsmithTraceUrls).length > 0
        ? { langsmith_trace_urls: langsmithTraceUrls }
        : {}),
      ...(rerunAgents.length > 0 ? { rerun_agents: rerunAgents } : {}),
      ...(rerunScenarioIds.length > 0 ? { rerun_scenario_ids: rerunScenarioIds } : {}),
      ...(serverOverrideAll ? { rerun_server_override_all: [...serverOverrideAll] } : {}),
      ...(Object.keys(scenarioServerOverrides).length > 0
        ? { rerun_scenario_server_overrides: scenarioServerOverrides }
        : {}),
      evaluation_run_id: params.runId
    },
    summary: {
      total_scenarios: totalScenarios,
      total_runs: totalRuns,
      pass_rate: calculatePassRate(outcomes.passed ?? 0, totalRuns, outcomes.stopped),
      avg_tool_calls_per_run: weighted('avg_tool_calls_per_run') ?? 0,
      avg_tool_latency_ms: weighted('avg_tool_latency_ms'),
      outcomes
    },
    scenarios: executions.flatMap((result) => result.scenarios)
  };
}
