import { useId } from 'react';
import { Copy, Download, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatToolAnalysisTokenCount } from '@/lib/tool-analysis-token-estimates';
import { ToolTokenEstimateBadge } from './ToolTokenEstimateBadge';

const itemNames = { tool: 'Tool', resource: 'Resource', prompt: 'Prompt' } as const;

export function McpCatalogToolbar({
  item,
  query,
  onQueryChange,
  selectedCount,
  count,
  selectedTokens,
  totalTokens,
  allVisibleSelected,
  hasVisibleItems,
  busy,
  onSelectVisible,
  onClear,
  onCopy,
  onDownload
}: {
  item: keyof typeof itemNames;
  query: string;
  onQueryChange: (query: string) => void;
  selectedCount: number;
  count: number;
  selectedTokens?: number;
  totalTokens?: number;
  allVisibleSelected: boolean;
  hasVisibleItems: boolean;
  busy: boolean;
  onSelectVisible: () => void;
  onClear: () => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const id = useId();
  const filterLabel = `Filter ${item}s`;
  const filtered = Boolean(query.trim());
  const tokenLabel =
    item === 'tool'
      ? 'Estimated tokens for tool definitions and their schemas'
      : `Estimated tokens for ${item} metadata`;
  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72">
          <Label htmlFor={id} className="sr-only">
            {filterLabel}
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={id}
            type="search"
            className="h-11 bg-transparent ps-9 sm:h-9"
            placeholder={`${filterLabel}…`}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 px-2 sm:h-8 sm:px-3"
            onClick={onSelectVisible}
            disabled={allVisibleSelected}
          >
            {filtered ? 'Select visible' : 'Select all'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 px-2 sm:h-8 sm:px-3"
            aria-label="Clear selection"
            onClick={onClear}
            disabled={selectedCount === 0}
          >
            Clear
          </Button>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 bg-transparent px-2 hover:bg-muted hover:text-foreground sm:h-8 sm:px-3"
              aria-label={`Copy ${filtered ? 'visible ' : ''}${item} list`}
              onClick={onCopy}
              disabled={busy || !hasVisibleItems}
            >
              <Copy aria-hidden="true" className="hidden sm:block" />
              Copy
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 bg-transparent px-2 hover:bg-muted hover:text-foreground sm:h-8 sm:px-3"
              aria-label={`Download ${itemNames[item]} Info`}
              onClick={onDownload}
              disabled={busy}
            >
              <Download aria-hidden="true" className="hidden sm:block" />
              Download
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span role="status">
          {selectedCount} of {count} selected
        </span>
        {selectedTokens !== undefined && (
          <span title={tokenLabel}>
            ~{formatToolAnalysisTokenCount(selectedTokens)} tokens selected
          </span>
        )}
        {totalTokens !== selectedTokens && (
          <ToolTokenEstimateBadge total={totalTokens} title={tokenLabel} />
        )}
      </div>
    </div>
  );
}
