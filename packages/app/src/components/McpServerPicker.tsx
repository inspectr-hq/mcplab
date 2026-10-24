import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function McpServerPicker({
  servers,
  selectedIds,
  onChange,
  defaultIds = [],
  className
}: {
  servers: Array<{ id: string; name?: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  defaultIds?: string[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {servers.map((server) => {
        const selected = selectedIds.includes(server.id);
        return (
          <Badge
            key={server.id}
            asChild
            variant={selected ? 'default' : 'outline'}
            className={cn(
              'min-h-7 max-w-full cursor-pointer break-words px-2.5 py-0.5 text-xs leading-4',
              !selected && 'opacity-60 hover:opacity-100',
              !selected && defaultIds.includes(server.id) && 'border-primary'
            )}
          >
            <button
              type="button"
              aria-pressed={selected}
              title={server.id}
              onClick={(event) => {
                event.stopPropagation();
                onChange(
                  selected
                    ? selectedIds.filter((id) => id !== server.id)
                    : [...selectedIds, server.id]
                );
              }}
            >
              <span className="min-w-0 max-w-full break-words text-left">
                {server.name?.trim() || server.id}
              </span>
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
