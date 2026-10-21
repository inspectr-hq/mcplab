import type { AgentEntry, EvalConfig } from '@/types/eval';
import { resolveRunAgentNames } from '@inspectr/mcplab-core';

export function resolveConfigRunAgents(
  cfg: Pick<EvalConfig, 'agents' | 'agentEntries' | 'runDefaults'>,
  defaultEvaluationAgentName?: string
): string[] {
  const entries: AgentEntry[] =
    cfg.agentEntries && cfg.agentEntries.length > 0
      ? cfg.agentEntries
      : cfg.agents.map((agent) => ({ kind: 'inline' as const, agent }));
  const configuredAgents = entries
    .map((entry) => (entry.kind === 'inline' ? entry.agent.id : entry.ref))
    .map((agentId) => agentId.trim())
    .filter(Boolean);
  return resolveRunAgentNames({
    configuredAgentNames: configuredAgents,
    selectedAgentNames: cfg.runDefaults?.selectedAgentNames,
    defaultEvaluationAgentName
  });
}
