import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { GlobalCopilotThread } from '@/lib/global-copilot-thread-store';

export function GlobalCopilotThreadList({
  threads,
  activeThreadId,
  onSelect,
  onRename,
  onDelete
}: {
  threads: GlobalCopilotThread[];
  activeThreadId?: string;
  onSelect: (thread: GlobalCopilotThread) => void;
  onRename: (thread: GlobalCopilotThread) => void;
  onDelete: (thread: GlobalCopilotThread) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const visible = threads
    .filter((thread) => !showAll || thread.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, showAll ? 100 : 6);

  return (
    <div className="border-b p-2">
      <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? 'Recent conversations ▾' : 'Recent conversations ▸'}
        </button>
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => {
            setShowAll((value) => !value);
            setExpanded(true);
          }}
        >
          {showAll ? 'Recent only' : `All conversations (${threads.length})`}
        </button>
      </div>
      {expanded && (
        <>
          {showAll && (
            <input
              className="mb-1 h-8 w-full rounded border bg-background px-2 text-xs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
            />
          )}
          <ScrollArea className={showAll ? 'max-h-48' : 'max-h-52'}>
            <div className="p-1">
              {visible.map((thread) => (
                <div key={thread.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelect(thread)}
                    className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-xs ${
                      activeThreadId === thread.id ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                    }`}
                  >
                    {thread.title}
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Rename ${thread.title}`}
                    onClick={() => onRename(thread)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Delete ${thread.title}`}
                    onClick={() => onDelete(thread)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
