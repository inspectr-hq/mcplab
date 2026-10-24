import type { AgentConfig } from '@/types/eval';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const claudeTiers = ['opus', 'sonnet', 'haiku'];

function tierRank(agent: AgentConfig): number {
  const tier = (agent.model || agent.id).match(
    /(?:^|[-_\s])(opus|sonnet|haiku)(?:[-_\s\d]|$)/i
  )?.[1];
  const index = claudeTiers.indexOf(tier?.toLowerCase() ?? '');
  return index < 0 ? claudeTiers.length : index;
}

/** Presentation order only; never reorder the configured execution or selection. */
export function sortAgentsForDisplay(agents: readonly AgentConfig[]): AgentConfig[] {
  return [...agents].sort((a, b) => {
    const providerOrder = collator.compare(a.provider, b.provider);
    if (providerOrder) return providerOrder;
    const tierOrder = tierRank(a) - tierRank(b);
    if (tierOrder) return tierOrder;
    const modelOrder = a.model && b.model ? collator.compare(b.model, a.model) : 0;
    return (
      modelOrder || collator.compare(a.name || a.id, b.name || b.id) || collator.compare(a.id, b.id)
    );
  });
}
