import {
  isLlmAgent,
  type EvalConfig,
  type LlmAgentConfig,
  type RunAgentSelection,
  type RunAgentSelectionParams
} from './types.js';

export const NO_EVALUATION_AGENTS_MESSAGE =
  'No evaluation agents selected. Configure evaluation agents, select agents for this run, or set a default evaluation agent in workspace settings.';

export function resolveRunAgentSelection(params: RunAgentSelectionParams): RunAgentSelection {
  const invalidDefaults = findUndeclaredDefaultAgents(
    params.declaredAgentNames,
    params.selectedAgentNames
  );
  if (invalidDefaults.length) {
    throw new Error(
      `Evaluation default agents must be declared in the evaluation: ${invalidDefaults.join(', ')}`
    );
  }
  const defaults = selectDefaultAgents(params);
  const selection = params.requestedAgentNames?.length
    ? { agentNames: [...params.requestedAgentNames], source: 'requested' as const }
    : defaults;
  if (selection.source === 'workspace_default' && params.availableAgents) {
    validateWorkspaceDefaultAgent(params.availableAgents, selection.agentNames[0]);
  }
  return { ...selection, agentNames: [...selection.agentNames] };
}

function selectDefaultAgents(params: RunAgentSelectionParams): RunAgentSelection {
  if (params.selectedAgentNames?.length)
    return { agentNames: [...params.selectedAgentNames], source: 'evaluation_default' };
  if (params.declaredAgentNames.length)
    return { agentNames: [...params.declaredAgentNames], source: 'evaluation_agents' };
  return params.defaultEvaluationAgentName
    ? { agentNames: [params.defaultEvaluationAgentName], source: 'workspace_default' }
    : { agentNames: [], source: 'none' };
}

export function findUndeclaredDefaultAgents(
  declaredAgentNames: string[],
  defaults: string[] = []
): string[] {
  return defaults.filter((name) => !declaredAgentNames.includes(name));
}

export function validateWorkspaceDefaultAgent(
  agents: EvalConfig['agents'],
  name: string
): LlmAgentConfig {
  return requireLlmAgent(agents, name, 'Default evaluation agent');
}

export function requireLlmAgent(
  agents: EvalConfig['agents'],
  name: string,
  missingLabel: string,
  invalidLabel = missingLabel
): LlmAgentConfig {
  const agent = agents[name];
  if (!agent) throw new Error(`${missingLabel} not found: ${name}`);
  if (!isLlmAgent(agent)) throw new Error(`${invalidLabel} must be an LLM agent: ${name}`);
  return agent;
}
