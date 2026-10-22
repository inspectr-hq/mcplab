import {
  resolveRunAgentSelection,
  type AgentEntry,
  type EvalConfig,
  type RunAgentSelection
} from '@/types/eval';

export function resolveConfigRunAgentSelection(
  cfg: Pick<EvalConfig, 'agents' | 'agentEntries' | 'runDefaults'>,
  defaultEvaluationAgentName?: string
): RunAgentSelection {
  const entries: AgentEntry[] =
    cfg.agentEntries && cfg.agentEntries.length > 0
      ? cfg.agentEntries
      : cfg.agents.map((agent) => ({ kind: 'inline' as const, agent }));
  const configuredAgents = entries
    .map((entry) => (entry.kind === 'inline' ? entry.agent.id : entry.ref))
    .map((agentId) => agentId.trim())
    .filter(Boolean);
  return resolveRunAgentSelection({
    declaredAgentNames: configuredAgents,
    selectedAgentNames: cfg.runDefaults?.selectedAgentNames,
    defaultEvaluationAgentName
  });
}
