import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  isLlmAgent,
  type EvalConfig,
  type EvaluationJudge,
  type ResolveWorkspaceEvaluationParams,
  type WorkspaceEvaluation,
  type WorkspaceEvaluationSettings,
  type WorkspaceSettingsOverrides
} from './types.js';

/** Preserve malformed decision configuration so evaluation can fall back to the judge. */
export function loadWorkspaceSettingsOverrides(librariesDir: string): WorkspaceSettingsOverrides {
  const filePath = join(librariesDir, '.mcplab-app-settings.yaml');
  if (!existsSync(filePath)) return {};
  try {
    const parsed = parseYaml(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      ...parsed,
      scenario_assistant_agent_name:
        typeof parsed.scenario_assistant_agent_name === 'string'
          ? parsed.scenario_assistant_agent_name.trim() || undefined
          : undefined,
      evaluation_judge_agent_name:
        typeof parsed.evaluation_judge_agent_name === 'string'
          ? parsed.evaluation_judge_agent_name.trim() || undefined
          : undefined
    };
  } catch {
    return {};
  }
}

export function resolveEvaluationJudge(params: {
  agents: EvalConfig['agents'];
  evaluationJudgeAgentName?: string;
}): EvaluationJudge | undefined {
  const selected = params.evaluationJudgeAgentName?.trim();
  if (!selected) return undefined;
  const agent = params.agents[selected];
  if (!agent) throw new Error(`Evaluation judge agent not found: ${selected}`);
  if (!isLlmAgent(agent)) throw new Error(`Evaluation judge must be an LLM agent: ${selected}`);
  return { name: selected, agent };
}

/** Resolve evaluation services only when selected scenarios need semantic checks. */
export function resolveWorkspaceEvaluation(
  params: ResolveWorkspaceEvaluationParams
): WorkspaceEvaluation {
  const needsJudge = params.scenarios.some(
    (scenario) =>
      (!params.scenarioId || scenario.id === params.scenarioId) &&
      (scenario.eval?.agent_assertions?.length ?? 0) > 0
  );
  if (!needsJudge) return {};
  const settings = params.settings as WorkspaceEvaluationSettings & WorkspaceSettingsOverrides;
  return {
    evaluationJudge: resolveEvaluationJudge({
      agents: params.agents,
      evaluationJudgeAgentName:
        settings.evaluationJudgeAgentName ?? settings.evaluation_judge_agent_name
    }),
    evaluationDecision: settings.evaluationDecision ?? settings.evaluation_decision
  };
}
