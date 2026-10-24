import { annotateServerVariant } from '@inspectr/mcplab-core';
import { join } from 'node:path';
import type { ResultsJson, ScenarioRunTraceRecord, ServerVariant } from '@inspectr/mcplab-core';
import { appendExecutionEvent, type ExecutionJournalEvent } from './execution-journal.js';
import { projectEvaluationJournal } from './evaluation-journal-projection.js';

type JournalWriterOptions = {
  runsDir: string;
  evaluationRunId: string;
  evaluationName?: string;
  runNote?: string;
  appendEvent?: typeof appendExecutionEvent;
  serverVariant?: ServerVariant;
};

export function recordEvaluationExecution(
  options: JournalWriterOptions & {
    executionId: string;
    results: ResultsJson;
    traceRecords?: ScenarioRunTraceRecord[];
    executionSource: 'mcplab' | 'rover';
    eventId?: string;
  }
): ResultsJson | null {
  const annotated = options.serverVariant
    ? annotateServerVariant(options.results, options.traceRecords ?? [], options.serverVariant)
    : { results: options.results, traceRecords: options.traceRecords };
  const event: ExecutionJournalEvent = {
    eventId: options.eventId ?? `${options.executionSource}-result-${options.executionId}`,
    type: 'execution_completed',
    ts: new Date().toISOString(),
    evaluationRunId: options.evaluationRunId,
    executionId: options.executionId,
    executionSource: options.executionSource,
    results: annotated.results,
    ...(annotated.traceRecords ? { traceRecords: annotated.traceRecords } : {})
  };
  (options.appendEvent ?? appendExecutionEvent)(
    join(options.runsDir, options.evaluationRunId),
    event
  );
  return projectEvaluationJournal({
    runsDir: options.runsDir,
    evaluationRunId: options.evaluationRunId,
    evaluationName: options.evaluationName,
    runNote: options.runNote
  });
}

export function recordEvaluationTerminalExecution(
  options: JournalWriterOptions & {
    executionId: string;
    status: 'error' | 'stopped';
    reason: string;
  }
): ResultsJson | null {
  const event: ExecutionJournalEvent = {
    eventId: `execution-${options.status}-${options.executionId}`,
    type: options.status === 'error' ? 'execution_failed' : 'execution_stopped',
    serverVariant: options.serverVariant,
    ts: new Date().toISOString(),
    executionId: options.executionId,
    evaluationRunId: options.evaluationRunId,
    reason: options.reason
  };
  (options.appendEvent ?? appendExecutionEvent)(
    join(options.runsDir, options.evaluationRunId),
    event
  );
  return projectEvaluationJournal({
    runsDir: options.runsDir,
    evaluationRunId: options.evaluationRunId,
    evaluationName: options.evaluationName,
    runNote: options.runNote,
    ...(options.status === 'stopped' ? { executionStatus: 'stopped' as const } : {})
  });
}
