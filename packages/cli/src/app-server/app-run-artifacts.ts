import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  persistEvaluationArtifacts,
  type PersistEvaluationArtifactsParams
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { appendExecutionEvent } from './execution-journal.js';

export function persistAppRunArtifacts(params: PersistEvaluationArtifactsParams): void {
  appendExecutionEvent(params.runDir, {
    eventId: `snapshot-${params.results.metadata.run_id}-${Date.now()}`,
    type: 'result_snapshot',
    ts: new Date().toISOString(),
    executionId: params.results.metadata.run_id,
    results: params.results,
    ...(params.resolvedConfig !== undefined ? { resolvedConfig: params.resolvedConfig } : {}),
    ...(params.traceRecords !== undefined ? { traceRecords: params.traceRecords } : {})
  });
  persistEvaluationArtifacts(params);
  const reportPath = join(params.runDir, 'report.html');
  const temporaryPath = `${reportPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, renderReport(params.results), 'utf8');
  renameSync(temporaryPath, reportPath);
}
