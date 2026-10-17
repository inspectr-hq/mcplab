import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

export interface RunTraceItem {
  key: string;
  label: string;
  open: () => void;
}

/** One trace link per scenario-agent: a button for a single run, a run menu for several. */
export function RunTraceButton({
  name,
  title,
  items,
  busy = false,
  disabled = false
}: {
  name: string;
  title: string;
  items: RunTraceItem[];
  busy?: boolean;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  const buttonProps = {
    type: 'button' as const,
    variant: 'ghost' as const,
    size: 'sm' as const,
    className: 'h-7 gap-1 px-2 text-xs text-muted-foreground',
    disabled,
    title
  };
  const icon = busy ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <ExternalLink className="h-3.5 w-3.5" />
  );
  if (items.length === 1) {
    return (
      <Button {...buttonProps} onClick={items[0].open}>
        {icon}
        {name}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button {...buttonProps}>
          {icon}
          {name}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={item.open}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
