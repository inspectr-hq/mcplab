import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  persistEvaluationArtifacts,
  type PersistEvaluationArtifactsParams
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';

export function persistAppRunArtifacts(params: PersistEvaluationArtifactsParams): void {
  persistEvaluationArtifacts(params);
  writeFileSync(join(params.runDir, 'report.html'), renderReport(params.results), 'utf8');
}
