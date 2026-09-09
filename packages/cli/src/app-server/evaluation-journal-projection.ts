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
    .map((event) => event.results as ResultsJson);
  if (children.length === 0) return null;
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
    }
  });
  return results;
}
