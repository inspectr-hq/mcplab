import { mkdirSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(runDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(join(runDir, 'summary.md'), renderSummaryMarkdown(results), 'utf8');
  if (resolvedConfig !== undefined) {
    writeFileSync(join(runDir, 'resolved-config.yaml'), `${stringifyYaml(resolvedConfig)}\n`, 'utf8');
  }
  if (traceRecords !== undefined) {
    writeFileSync(
      join(runDir, 'trace.jsonl'),
      traceRecords.map((record) => JSON.stringify(record)).join('\n') + (traceRecords.length ? '\n' : ''),
      'utf8'
    );
  }
}
