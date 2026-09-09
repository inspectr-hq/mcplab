import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  persistEvaluationArtifacts,
  type PersistEvaluationArtifactsParams
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';

export function persistAppRunArtifacts(params: PersistEvaluationArtifactsParams): void {
  persistEvaluationArtifacts(params);
  const reportPath = join(params.runDir, 'report.html');
  const temporaryPath = `${reportPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, renderReport(params.results), 'utf8');
  renameSync(temporaryPath, reportPath);
}
