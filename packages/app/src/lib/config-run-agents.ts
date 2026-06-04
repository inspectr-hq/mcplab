import type { AgentEntry, EvalConfig } from '@/types/eval';

export function resolveConfigRunAgents(
  cfg: Pick<EvalConfig, 'agents' | 'agentEntries' | 'runDefaults'>
): string[] {
  const entries: AgentEntry[] =
    cfg.agentEntries && cfg.agentEntries.length > 0
      ? cfg.agentEntries
      : cfg.agents.map((agent) => ({ kind: 'inline' as const, agent }));
  const configuredAgents = entries
    .map((entry) => (entry.kind === 'inline' ? entry.agent.id : entry.ref))
    .map((agentId) => agentId.trim())
    .filter(Boolean);
  const defaultAgents = (cfg.runDefaults?.selectedAgentNames ?? []).filter((agentId) =>
    configuredAgents.includes(agentId)
  );
  return defaultAgents.length > 0 ? defaultAgents : configuredAgents;
}
