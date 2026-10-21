import type { RunAgentSelection, RunAgentSelectionParams } from './types.js';

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
  let selection: RunAgentSelection =
    params.resolvedSelection ??
    (params.requestedAgentNames?.length
      ? { agentNames: [...params.requestedAgentNames], source: 'requested' }
      : defaults);
  if (
    !params.resolvedSelection &&
    params.requestedAgentSource &&
    params.requestedAgentSource !== 'requested'
  ) {
    const names = params.requestedAgentNames ?? [];
    if (
      params.requestedAgentSource !== defaults.source ||
      names.length !== defaults.agentNames.length ||
      new Set(names).size !== new Set(defaults.agentNames).size ||
      !names.every((name) => defaults.agentNames.includes(name))
    ) {
      throw new Error('Agent defaults changed. Refresh the run selection and try again.');
    }
    selection = defaults;
  }
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
  agents: Record<string, { type?: 'llm' | 'browser' }>,
  name: string
): void {
  const agent = agents[name];
  if (!agent) throw new Error(`Default evaluation agent not found: ${name}`);
  if (agent.type === 'browser')
    throw new Error(`Default evaluation agent must be an LLM agent: ${name}`);
}
