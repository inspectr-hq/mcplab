import {
  resolveRunAgentSelection,
  type EvalConfig,
  type RunAgentSelection,
  type RunAgentSelectionSource
} from '@inspectr/mcplab-core';

export function resolveRunSelectedAgents(
  config: EvalConfig,
  requestedAgents: string[] | undefined,
  options: {
    declaredAgentNames: string[];
    defaultEvaluationAgentName?: string;
    requestedAgentSource?: RunAgentSelectionSource;
    resolvedSelection?: RunAgentSelection;
  }
): RunAgentSelection {
  return resolveRunAgentSelection({
    declaredAgentNames: options.declaredAgentNames,
    selectedAgentNames: config.run_defaults?.selected_agents,
    requestedAgentNames: requestedAgents,
    requestedAgentSource: options.requestedAgentSource,
    resolvedSelection: options.resolvedSelection,
    availableAgents: config.agents,
    defaultEvaluationAgentName: options.defaultEvaluationAgentName
  });
}
