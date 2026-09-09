import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { PersistedTraceRecord, ResultsJson } from './types.js';
import { renderSummaryMarkdown } from './results.js';

export interface PersistEvaluationArtifactsParams {
  runDir: string;
  results: ResultsJson;
  resolvedConfig?: unknown;
  traceRecords?: PersistedTraceRecord[];
}

export function persistEvaluationArtifacts({
  runDir,
  results,
  resolvedConfig,
  traceRecords
}: PersistEvaluationArtifactsParams): void {
  mkdirSync(runDir, { recursive: true });
  writeAtomic(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeAtomic(join(runDir, 'summary.md'), renderSummaryMarkdown(results));
  if (resolvedConfig !== undefined) {
    writeAtomic(join(runDir, 'resolved-config.yaml'), `${stringifyYaml(resolvedConfig)}\n`);
  }
  if (traceRecords !== undefined) {
    writeAtomic(
      join(runDir, 'trace.jsonl'),
      traceRecords.map((record) => JSON.stringify(record)).join('\n') + (traceRecords.length ? '\n' : '')
    );
  }
}

function writeAtomic(path: string, content: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}
