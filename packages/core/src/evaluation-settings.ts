import type { WorkspaceEvaluationSettings } from './types.js';

/** Legacy workspaces omit this flag, which means semantic evaluation remains enabled. */
export function isSemanticEvaluationEnabled(
  settings?: Pick<WorkspaceEvaluationSettings, 'evaluationJudgeEnabled'> | null
): boolean {
  return settings?.evaluationJudgeEnabled !== false;
}
