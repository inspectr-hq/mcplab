import { join } from 'node:path';
import type { ResultsJson, ServerVariant, EvaluationRunRequest } from '@inspectr/mcplab-core';
import { projectEvaluationResult } from './evaluation-result-projection.js';
import { persistAppRunArtifacts } from './app-run-artifacts.js';
import { readExecutionEvents } from './execution-journal.js';

export function projectEvaluationJournal(params: {
  runsDir: string;
  evaluationRunId: string;
  evaluationName?: string;
  runNote?: string;
  executionStatus?: 'stopped';
}): ResultsJson | null {
  const events = readExecutionEvents(join(params.runsDir, params.evaluationRunId));
  const executions = events
    .filter((event) => event.type === 'execution_completed' && event.results)
    .reduce<ResultsJson[]>((results, event) => {
      const executionId = event.executionId ?? (event.results as ResultsJson).metadata.run_id;
      if (results.some((result) => result.metadata.run_id === executionId)) return results;
      results.push(event.results as ResultsJson);
      return results;
    }, []);
  const start = events.find((event) => event.type === 'evaluation_started');
  const request = start?.evaluationRequest as EvaluationRunRequest | undefined;
  const serverVariants = request?.server_sets
    ? request.server_sets.map(({ servers, ...set }) => ({
        ...set,
        ...(servers === undefined ? {} : { serverIds: servers })
      }))
    : undefined;
  if (
    executions.length === 0 &&
    (!serverVariants?.length ||
      !events.some(
        (event) =>
          event.type === 'execution_failed' ||
          event.type === 'execution_stopped' ||
          event.type === 'evaluation_stopped'
      ))
  )
    return null;
  const failedExecutions = new Set(
    events
      .filter((event) => event.type === 'execution_failed')
      .map((event) => event.executionId ?? event.eventId)
  );
  const stoppedExecutions = new Set(
    events
      .filter((event) => event.type === 'execution_stopped' || event.type === 'evaluation_stopped')
      .map((event) => event.executionId ?? event.eventId)
  );
  const executionTraceRecords = events
    .filter((event) => event.type === 'execution_completed' && Array.isArray(event.traceRecords))
    .flatMap(
      (event) => event.traceRecords as import('@inspectr/mcplab-core').ScenarioRunTraceRecord[]
    );
  const roverTraceEvents = events.filter((event) => event.type === 'rover_event');
  const traceRecords = [...executionTraceRecords, ...roverTraceEvents].sort((a, b) => {
    const timestamp = (record: { ts?: unknown; ts_start?: unknown }) =>
      typeof record.ts === 'string'
        ? Date.parse(record.ts)
        : typeof record.ts_start === 'string'
          ? Date.parse(record.ts_start)
          : 0;
    return timestamp(a) - timestamp(b);
  });
  const results = projectEvaluationResult({
    evaluationRunId: params.evaluationRunId,
    runId: params.evaluationRunId,
    evaluationName: params.evaluationName,
    runNote: params.runNote,
    executions,
    failedExecutions: failedExecutions.size,
    stoppedExecutions: stoppedExecutions.size
  });
  if (params.executionStatus || stoppedExecutions.size > 0)
    results.metadata.execution_status = 'stopped';
  if (serverVariants?.length) {
    if (!results.metadata.config_path && typeof start?.configPath === 'string')
      results.metadata.config_path = start.configPath;
    if (!results.metadata.rerun_scenario_ids && Array.isArray(start?.scenarioIds))
      results.metadata.rerun_scenario_ids = start.scenarioIds as string[];
    if (request?.agents) results.metadata.rerun_agents = request.agents;
    if (request?.scenarioIds) results.metadata.rerun_scenario_ids = request.scenarioIds;
    results.metadata.server_variants = serverVariants;
    results.metadata.rerun_server_variants = serverVariants;
    results.metadata.server_variant_errors = Object.fromEntries(
      events
        .filter(
          (event) =>
            event.type === 'execution_failed' ||
            event.type === 'execution_stopped' ||
            event.type === 'evaluation_stopped'
        )
        .flatMap((event) => {
          const variant = event.serverVariant as ServerVariant | undefined;
          return variant ? [[variant.id, String(event.reason ?? event.type)]] : [];
        })
    );
    delete results.metadata.rerun_server_override_all;
    delete results.metadata.rerun_scenario_server_overrides;
  }
  if (typeof start?.runsPerScenario === 'number')
    results.metadata.rerun_runs_per_scenario = start.runsPerScenario;
  if (typeof start?.newConversationBeforeStart === 'boolean')
    results.metadata.rerun_new_conversation_before_start = start.newConversationBeforeStart;
  if (typeof start?.newConversationBetweenScenarios === 'boolean')
    results.metadata.rerun_new_conversation_between_scenarios =
      start.newConversationBetweenScenarios;
  persistAppRunArtifacts({
    runDir: join(params.runsDir, params.evaluationRunId),
    results,
    resolvedConfig: {
      evaluation_run_id: params.evaluationRunId,
      evaluation_name: params.evaluationName
    },
    ...(traceRecords.length > 0
      ? {
          traceRecords: [
            {
              type: 'trace_meta' as const,
              trace_version: 3 as const,
              run_id: params.evaluationRunId,
              ts: new Date().toISOString()
            },
            ...traceRecords
          ]
        }
      : {})
  });
  return results;
}
