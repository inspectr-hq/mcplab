import { join } from 'node:path';
import type { ResultsJson, ScenarioRunTraceRecord } from '@inspectr/mcplab-core';
import { appendExecutionEvent, type ExecutionJournalEvent } from './execution-journal.js';
import { projectEvaluationJournal } from './evaluation-journal-projection.js';

type JournalWriterOptions = {
  runsDir: string;
  evaluationRunId: string;
  evaluationName?: string;
  appendEvent?: typeof appendExecutionEvent;
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
  const event: ExecutionJournalEvent = {
    eventId: options.eventId ?? `${options.executionSource}-result-${options.executionId}`,
    type: 'execution_completed',
    ts: new Date().toISOString(),
    evaluationRunId: options.evaluationRunId,
    executionId: options.executionId,
    executionSource: options.executionSource,
    results: options.results,
    ...(options.traceRecords ? { traceRecords: options.traceRecords } : {})
  };
  (options.appendEvent ?? appendExecutionEvent)(join(options.runsDir, options.evaluationRunId), event);
  return projectEvaluationJournal({
    runsDir: options.runsDir,
    evaluationRunId: options.evaluationRunId,
    evaluationName: options.evaluationName
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
    ts: new Date().toISOString(),
    executionId: options.executionId,
    evaluationRunId: options.evaluationRunId,
    reason: options.reason
  };
  (options.appendEvent ?? appendExecutionEvent)(join(options.runsDir, options.evaluationRunId), event);
  return projectEvaluationJournal({
    runsDir: options.runsDir,
    evaluationRunId: options.evaluationRunId,
    evaluationName: options.evaluationName,
    ...(options.status === 'stopped' ? { executionStatus: 'stopped' as const } : {})
  });
}
