import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type McpServerBadgeProps = {
  versions?: Record<string, string | null>;
  className?: string;
};

export function McpServerBadge({ versions, className }: McpServerBadgeProps) {
  const summary = Object.entries(versions ?? {})
    .map(([serverId, version]) => `${serverId}: ${version ?? 'unknown'}`)
    .join(', ');

  if (!summary) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              'inline-flex max-w-[18rem] min-w-0 items-center rounded-sm border border-border/60 bg-muted/30 px-1.5 py-1 text-[11px] text-muted-foreground',
              className
            )}
          >
            <span className="font-medium">MCP:</span>
            <span className="ml-1 min-w-0 truncate font-mono">{summary}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-md break-words text-xs">
          <span className="font-mono">{summary}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
