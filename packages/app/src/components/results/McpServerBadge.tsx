import { Badge } from '@/components/ui/badge';
import IconMcp from '@/components/ui/IconMcp';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type McpServerBadgeProps = {
  versions?: Record<string, string | null>;
  serverNames?: Record<string, string>;
  showIcon?: boolean;
  className?: string;
  size?: 'default' | 'compact';
};

export function McpServerBadge({
  versions,
  serverNames,
  showIcon = true,
  className,
  size = 'default'
}: McpServerBadgeProps) {
  const entries = Object.entries(versions ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
  const labelFor = (serverId: string) => serverNames?.[serverId]?.trim() || serverId;
  const summary = entries
    .map(([serverId, version]) => `${labelFor(serverId)}@${version ?? 'unknown'}`)
    .join(', ');

  if (!summary) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              'inline-flex max-w-[18rem] min-w-0 flex-wrap items-center gap-1 leading-none',
              className
            )}
          >
            {entries.map(([serverId, version]) => (
              <Badge
                key={serverId}
                variant="outline"
                className={cn(
                  'max-w-full gap-1 break-words font-normal',
                  size === 'compact'
                    ? 'min-h-5 px-1 py-0 text-[9px] leading-3'
                    : 'min-h-7 px-2.5 py-0.5 text-xs leading-4'
                )}
              >
                {showIcon ? (
                  <IconMcp
                    role="img"
                    aria-hidden={false}
                    aria-label="MCP server"
                    className={cn('shrink-0', size === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
                  />
                ) : null}
                <span className="min-w-0 max-w-full break-words text-left font-mono">
                  {labelFor(serverId)}@{version ?? 'unknown'}
                </span>
              </Badge>
            ))}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-md wrap-break-word text-xs">
          <span className="font-mono">{summary}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
