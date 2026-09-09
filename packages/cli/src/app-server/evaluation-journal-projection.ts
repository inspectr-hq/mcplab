import { join } from 'node:path';
import type { ResultsJson } from '@inspectr/mcplab-core';
import { aggregateEvaluationGroupResults } from './evaluation-group-results.js';
import { persistAppRunArtifacts } from './app-run-artifacts.js';
import { readExecutionEvents } from './execution-journal.js';

export function projectEvaluationJournal(params: {
  runsDir: string;
  evaluationRunId: string;
  evaluationName?: string;
}): ResultsJson | null {
  const events = readExecutionEvents(join(params.runsDir, params.evaluationRunId));
  const children = events
    .filter((event) => event.type === 'child_result_completed' && event.results)
    .reduce<ResultsJson[]>((results, event) => {
      const executionId = event.executionId ?? (event.results as ResultsJson).metadata.run_id;
      if (results.some((result) => result.metadata.run_id === executionId)) return results;
      results.push(event.results as ResultsJson);
      return results;
    }, []);
  if (children.length === 0) return null;
  const traceRecords = events
    .filter((event) => event.type === 'child_result_completed' && Array.isArray(event.traceRecords))
    .flatMap((event) => event.traceRecords as import('@inspectr/mcplab-core').ScenarioRunTraceRecord[]);
  const results = aggregateEvaluationGroupResults({
    groupId: params.evaluationRunId,
    runId: params.evaluationRunId,
    evaluationName: params.evaluationName,
    children
  });
  persistAppRunArtifacts({
    runDir: join(params.runsDir, params.evaluationRunId),
    results,
    resolvedConfig: {
      evaluation_run_id: params.evaluationRunId,
      evaluation_name: params.evaluationName,
      child_run_ids: results.metadata.child_run_ids ?? []
    },
    ...(traceRecords.length > 0
      ? {
          traceRecords: [
            { type: 'trace_meta' as const, trace_version: 3 as const, run_id: params.evaluationRunId, ts: new Date().toISOString() },
            ...traceRecords
          ]
        }
      : {})
  });
  return results;
}
