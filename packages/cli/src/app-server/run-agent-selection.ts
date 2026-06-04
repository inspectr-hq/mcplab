import type { EvalConfig } from '@inspectr/mcplab-core';

export function resolveRunSelectedAgents(config: EvalConfig, requestedAgents?: string[]): string[] {
  if (requestedAgents && requestedAgents.length > 0) return requestedAgents;
  if (config.run_defaults?.selected_agents && config.run_defaults.selected_agents.length > 0) {
    return config.run_defaults.selected_agents;
  }
  return Object.keys(config.agents);
}
