import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  ToolAnalysisDiscoveredTool,
  ToolAnalysisDiscoverResponse
} from '@/lib/data-sources/types';
import { isWriteDeleteClassification } from '@/lib/tool-analysis-utils';
import { ToolDescription } from './ToolDescription';
import { ToolSchemaPreview, type SchemaViewMode } from './ToolSchemaPreview';
import { ToolTokenEstimateBadge } from './ToolTokenEstimateBadge';

const safety = {
  read: {
    label: 'read-only',
    style: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
  },
  write: {
    label: 'write/delete',
    style: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
  },
  unknown: { label: 'unsafe/unknown', style: 'bg-muted text-muted-foreground' }
};

function toolSafety(tool: ToolAnalysisDiscoveredTool) {
  if (tool.safetyClassification === 'read_only') return safety.read;
  return isWriteDeleteClassification(tool.classificationReason) ? safety.write : safety.unknown;
}

export function McpToolList({
  tools,
  selected,
  tokenEstimate,
  schemaMode,
  onSchemaModeChange,
  onToggle
}: {
  tools: ToolAnalysisDiscoveredTool[];
  selected: ReadonlySet<string>;
  tokenEstimate?: ToolAnalysisDiscoverResponse['servers'][number]['tokenEstimate'];
  schemaMode: SchemaViewMode;
  onSchemaModeChange: (mode: SchemaViewMode) => void;
  onToggle: (toolName: string, checked: boolean) => void;
}) {
  const id = useId();
  const tokensByName = new Map(tokenEstimate?.tools.map((tool) => [tool.name, tool.total]));
  return (
    <TooltipProvider delayDuration={0}>
      <ul aria-label="Discovered tools" className="divide-y border-t">
        {tools.map((tool, index) => {
          const checkboxId = `${id}-${index}`;
          const classification = toolSafety(tool);
          const title = tool.title !== tool.name ? tool.title : undefined;
          return (
            <li
              key={tool.name}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-3 sm:px-4"
            >
              <Checkbox
                id={checkboxId}
                className="mt-1"
                checked={selected.has(tool.name)}
                onCheckedChange={(value) => onToggle(tool.name, Boolean(value))}
              />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <label
                    htmlFor={checkboxId}
                    className="cursor-pointer wrap-anywhere font-mono text-sm font-medium"
                  >
                    {tool.name}
                  </label>
                  {title && (
                    <span className="wrap-anywhere text-sm text-muted-foreground">{title}</span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className={classification.style}>
                        {classification.label}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm text-xs">
                      {tool.classificationReason}
                    </TooltipContent>
                  </Tooltip>
                  <ToolTokenEstimateBadge total={tokensByName.get(tool.name)} />
                </div>
                {tool.description && <ToolDescription text={tool.description} />}
                <ToolSchemaPreview
                  compact
                  inputSchema={tool.inputSchema}
                  outputSchema={tool.outputSchema}
                  mode={schemaMode}
                  onModeChange={onSchemaModeChange}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}
