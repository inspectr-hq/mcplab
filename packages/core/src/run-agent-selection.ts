import type { RunAgentSelection, RunAgentSelectionParams } from './types.js';

export const NO_EVALUATION_AGENTS_MESSAGE =
  'No evaluation agents selected. Configure evaluation agents, select agents for this run, or set a default evaluation agent in workspace settings.';

export function resolveRunAgentSelection(params: RunAgentSelectionParams): RunAgentSelection {
  const invalidDefaults =
    params.selectedAgentNames?.filter((name) => !params.declaredAgentNames.includes(name)) ?? [];
  if (invalidDefaults.length) {
    throw new Error(
      `Evaluation default agents must be declared in the evaluation: ${invalidDefaults.join(', ')}`
    );
  }
  if (params.requestedAgentNames?.length)
    return { agentNames: [...params.requestedAgentNames], source: 'requested' };
  if (params.selectedAgentNames?.length)
    return { agentNames: [...params.selectedAgentNames], source: 'evaluation_default' };
  if (params.declaredAgentNames.length)
    return { agentNames: [...params.declaredAgentNames], source: 'evaluation_agents' };
  return params.defaultEvaluationAgentName
    ? { agentNames: [params.defaultEvaluationAgentName], source: 'workspace_default' }
    : { agentNames: [], source: 'none' };
}

export function resolveRunAgentNames(params: RunAgentSelectionParams): string[] {
  return resolveRunAgentSelection(params).agentNames;
}
