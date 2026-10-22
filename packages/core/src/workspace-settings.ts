import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { requireLlmAgent } from './run-agent-selection.js';
import {
  type EvalConfig,
  type LlmAgentConfig,
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
    const { scenario_assistant_agent_name: legacyAssistantAgentName, ...current } = parsed;
    // Workspaces saved before the rename keep their assistant agent until settings are saved again.
    const assistantAgentName = current.assistant_agent_name ?? legacyAssistantAgentName;
    return {
      ...current,
      default_evaluation_agent_name:
        typeof parsed.default_evaluation_agent_name === 'string'
          ? parsed.default_evaluation_agent_name.trim() || undefined
          : undefined,
      assistant_agent_name:
        typeof assistantAgentName === 'string' ? assistantAgentName.trim() || undefined : undefined,
      evaluation_judge_agent_name:
        typeof parsed.evaluation_judge_agent_name === 'string'
          ? parsed.evaluation_judge_agent_name.trim() || undefined
          : undefined
    };
  } catch {
    return {};
  }
}

export function toWorkspaceEvaluationSettings(
  settings: WorkspaceSettingsOverrides
): WorkspaceEvaluationSettings {
  return {
    defaultEvaluationAgentName: settings.default_evaluation_agent_name,
    evaluationJudgeAgentName: settings.evaluation_judge_agent_name,
    evaluationDecision: settings.evaluation_decision
  };
}

export function resolveEvaluationJudge(params: {
  agents: EvalConfig['agents'];
  evaluationJudgeAgentName?: string;
}): EvaluationJudge | undefined {
  const selected = params.evaluationJudgeAgentName?.trim();
  if (!selected) return undefined;
  const agent = requireLlmAgent(
    params.agents,
    selected,
    'Evaluation judge agent',
    'Evaluation judge'
  );
  return { name: selected, agent };
}

export function resolveDefaultEvaluationAgent(params: {
  agents: EvalConfig['agents'];
  defaultEvaluationAgentName?: string;
}): LlmAgentConfig | undefined {
  const selected = params.defaultEvaluationAgentName?.trim();
  if (!selected) return undefined;
  return requireLlmAgent(params.agents, selected, 'Default evaluation agent');
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
  const settings = params.settings;
  return {
    evaluationJudge: resolveEvaluationJudge({
      agents: params.agents,
      evaluationJudgeAgentName: settings.evaluationJudgeAgentName
    }),
    evaluationDecision: settings.evaluationDecision
  };
}
