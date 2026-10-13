import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isLlmAgent, type EvalConfig, type EvaluationDecisionConfig, type LlmAgentConfig } from './types.js';

export interface WorkspaceSettingsOverrides {
  scenario_assistant_agent_name?: string;
  evaluation_judge_agent_name?: string;
  default_queue_workers?: unknown;
  evaluation_decision?: EvaluationDecisionConfig;
}

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
}): { name: string; agent: LlmAgentConfig } | undefined {
  const selected = params.evaluationJudgeAgentName?.trim();
  if (!selected) return undefined;
  const agent = params.agents[selected];
  if (!agent) throw new Error(`Evaluation judge agent not found: ${selected}`);
  if (!isLlmAgent(agent)) throw new Error(`Evaluation judge must be an LLM agent: ${selected}`);
  return { name: selected, agent };
}
