import { useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function ToolNameInput({
  value,
  onChange,
  availableTools,
  loading,
  error,
  canLoadTools,
  onLoadTools
}: {
  value: string;
  onChange: (value: string) => void;
  availableTools: string[] | null;
  loading: boolean;
  error: string | null;
  canLoadTools: boolean;
  onLoadTools: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const loadInFlight = useRef(false);
  const listId = useId();
  const matches = (availableTools ?? []).filter((tool) =>
    tool.toLowerCase().includes(value.trim().toLowerCase())
  );
  const showList = open && availableTools !== null && !error && matches.length > 0;
  const selectedIndex = activeIndex < matches.length ? activeIndex : -1;
  const selectTool = (tool: string) => {
    onChange(tool);
    setOpen(false);
    setActiveIndex(-1);
  };
  const showSuggestions = () => {
    setOpen(true);
    if (availableTools === null && canLoadTools && !loading && !error && !loadInFlight.current) {
      loadInFlight.current = true;
      void onLoadTools()
        .catch(() => undefined)
        .finally(() => {
          loadInFlight.current = false;
        });
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          showSuggestions();
        } else {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative min-w-0 flex-1">
          <Input
            value={value}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={showList ? listId : undefined}
            aria-activedescendant={
              showList && selectedIndex >= 0 ? `${listId}-option-${selectedIndex}` : undefined
            }
            onFocus={showSuggestions}
            onChange={(event) => {
              onChange(event.target.value);
              setActiveIndex(-1);
              showSuggestions();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) showSuggestions();
                if (matches.length > 0) {
                  const direction = event.key === 'ArrowDown' ? 1 : -1;
                  setActiveIndex((current) => {
                    if (current < 0 || current >= matches.length) {
                      return direction > 0 ? 0 : matches.length - 1;
                    }
                    return (current + direction + matches.length) % matches.length;
                  });
                }
              } else if (event.key === 'Enter' && showList && selectedIndex >= 0) {
                event.preventDefault();
                selectTool(matches[selectedIndex]);
              } else if (event.key === 'Escape' && open) {
                event.preventDefault();
                setOpen(false);
                setActiveIndex(-1);
              }
            }}
            placeholder="Tool name"
            className="h-8 pr-9 text-xs font-mono"
          />
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-0.5 h-7 w-7"
              aria-label={open ? 'Hide tool suggestions' : 'Show tool suggestions'}
              title={open ? 'Hide tool suggestions' : 'Show tool suggestions'}
              onMouseDown={(event) => event.preventDefault()}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              )}
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={4} className="w-[min(24rem,calc(100vw-2rem))] p-1">
        {!canLoadTools ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Select a server to browse tool names. You can still type any name.
          </p>
        ) : error && !loading ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <p className="text-xs text-muted-foreground">
              Suggestions unavailable. You can still type any name.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => void onLoadTools()}
            >
              <RotateCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          </div>
        ) : availableTools === null ? null : availableTools.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No tools found. You can still type any name.
          </p>
        ) : matches.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No matching tools. Keep your custom name.
          </p>
        ) : (
          <div
            id={listId}
            role="listbox"
            aria-label="Available tools"
            className="max-h-56 overflow-y-auto"
          >
            {matches.map((tool, index) => (
              <button
                key={tool}
                type="button"
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === selectedIndex}
                className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs font-mono outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent ${index === selectedIndex ? 'bg-accent text-accent-foreground' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  selectTool(tool);
                }}
              >
                {tool}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
