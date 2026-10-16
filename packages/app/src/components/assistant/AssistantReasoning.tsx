import { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { AssistantReasoning as Reasoning } from '@/lib/data-sources/types';
import { cn } from '@/lib/utils';

/**
 * The model's reasoning summary: open while it streams in, closed once the answer starts,
 * unless the user opened or closed it themselves.
 */
export function AssistantReasoning({ reasoning }: { reasoning: Reasoning }) {
  const thinking = reasoning.durationMs === undefined;
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  const open = userOpen ?? thinking;
  const label = thinking ? 'Thinking…' : `Thought for ${formatSeconds(reasoning.durationMs!)}`;
  const text = reasoning.text.trim();

  if (!text)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Brain className="h-3.5 w-3.5" />
        {label}
      </p>
    );
  return (
    <Collapsible open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Brain className={cn('h-3.5 w-3.5', thinking && 'animate-pulse')} />
        {label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 border-l-2 border-border/70 pl-3 text-muted-foreground">
        <MarkdownContent text={text} variant="assistant" className="text-xs" />
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatSeconds(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
