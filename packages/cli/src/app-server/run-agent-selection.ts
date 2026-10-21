import {
  resolveLoadedRunAgents,
  type EvalConfig,
  type RunAgentSelection
} from '@inspectr/mcplab-core';

export function resolveRunSelectedAgents(
  config: EvalConfig,
  requestedAgents: string[] | undefined,
  options: {
    declaredAgentNames: string[];
    defaultEvaluationAgentName?: string;
  }
): RunAgentSelection {
  return resolveLoadedRunAgents(
    { declaredAgentNames: options.declaredAgentNames },
    config,
    requestedAgents,
    options.defaultEvaluationAgentName
  );
}
