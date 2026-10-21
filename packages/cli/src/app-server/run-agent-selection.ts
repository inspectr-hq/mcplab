import {
  resolveRunAgentSelection,
  type EvalConfig,
  type RunAgentSelection
} from '@inspectr/mcplab-core';

export function resolveRunSelectedAgents(
  config: EvalConfig,
  requestedAgents: string[] | undefined,
  options: { declaredAgentNames: string[]; defaultEvaluationAgentName?: string }
): RunAgentSelection {
  return resolveRunAgentSelection({
    declaredAgentNames: options.declaredAgentNames,
    selectedAgentNames: config.run_defaults?.selected_agents,
    requestedAgentNames: requestedAgents,
    defaultEvaluationAgentName: options.defaultEvaluationAgentName
  });
}
