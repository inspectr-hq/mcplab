import { existsSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  persistEvaluationArtifacts,
  type PersistEvaluationArtifactsParams
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { appendExecutionEvent, readLatestResultSnapshot } from './execution-journal.js';

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

export function recoverJournalSnapshots(runsDir: string): number {
  if (!existsSync(runsDir)) return 0;
  let recovered = 0;
  for (const entry of readdirSync(runsDir)) {
    const runDir = join(runsDir, entry);
    if (!statSync(runDir).isDirectory()) continue;
    const snapshot = readLatestResultSnapshot(runDir);
    if (!snapshot || !snapshot.results || typeof snapshot.results !== 'object') continue;
    const requiredProjectionPaths = [
      join(runDir, 'results.json'),
      join(runDir, 'summary.md'),
      join(runDir, 'report.html')
    ];
    if (snapshot.resolvedConfig !== undefined)
      requiredProjectionPaths.push(join(runDir, 'resolved-config.yaml'));
    if (snapshot.traceRecords !== undefined)
      requiredProjectionPaths.push(join(runDir, 'trace.jsonl'));
    if (requiredProjectionPaths.every((path) => existsSync(path))) continue;
    const params: PersistEvaluationArtifactsParams = {
      runDir,
      results: snapshot.results as PersistEvaluationArtifactsParams['results'],
      ...(snapshot.resolvedConfig !== undefined ? { resolvedConfig: snapshot.resolvedConfig } : {}),
      ...(Array.isArray(snapshot.traceRecords)
        ? {
            traceRecords: snapshot.traceRecords as PersistEvaluationArtifactsParams['traceRecords']
          }
        : {})
    };
    persistEvaluationArtifacts(params);
    const reportPath = join(runDir, 'report.html');
    const temporaryPath = `${reportPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporaryPath, renderReport(params.results), 'utf8');
    renameSync(temporaryPath, reportPath);
    recovered += 1;
  }
  return recovered;
}
