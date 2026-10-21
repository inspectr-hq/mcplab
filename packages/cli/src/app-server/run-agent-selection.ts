import { resolveRunAgentNames, type EvalConfig } from '@inspectr/mcplab-core';

export function resolveRunSelectedAgents(
  config: EvalConfig,
  requestedAgents?: string[],
  options: { configuredAgentNames?: string[]; defaultEvaluationAgentName?: string } = {}
): string[] {
  return resolveRunAgentNames({
    configuredAgentNames: options.configuredAgentNames ?? Object.keys(config.agents),
    selectedAgentNames: config.run_defaults?.selected_agents,
    requestedAgentNames: requestedAgents,
    defaultEvaluationAgentName: options.defaultEvaluationAgentName
  });
}
