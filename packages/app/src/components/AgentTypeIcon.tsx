import { Bot, Globe2 } from 'lucide-react';
import type { AgentConfig } from '@/types/eval';

export function AgentTypeIcon({ agent }: { agent?: Pick<AgentConfig, 'type'> }) {
  const isBrowserAgent = agent?.type === 'browser';
  const Icon = isBrowserAgent ? Globe2 : Bot;

  return (
    <span
      className="inline-flex shrink-0"
      title={isBrowserAgent ? 'Browser agent' : 'LLM agent'}
    >
      <Icon
        className={`h-4 w-4 ${isBrowserAgent ? 'text-sky-600' : 'text-muted-foreground'}`}
        aria-hidden="true"
      />
    </span>
  );
}
