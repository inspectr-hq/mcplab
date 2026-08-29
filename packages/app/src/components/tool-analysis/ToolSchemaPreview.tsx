import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { safeJsonStringify } from '@/lib/tool-analysis-utils';
import { toast } from '@/hooks/use-toast';

export type SchemaViewMode = 'json' | 'explorer';

function schemaType(schema: Record<string, unknown>): string {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.properties && typeof schema.properties === 'object') return 'object';
  if (schema.items && typeof schema.items === 'object') return 'array';
  return 'any';
}

function countSchemaProperties(schema: unknown, seen = new Set<object>()): number {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 0;
  const record = schema as Record<string, unknown>;
  if (seen.has(record)) return 0;

  const nextSeen = new Set(seen);
  nextSeen.add(record);
  const properties =
    record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : undefined;
  const nestedPropertyCount = properties
    ? Object.values(properties).reduce(
        (total, propertySchema) => total + countSchemaProperties(propertySchema, nextSeen),
        0
      )
    : 0;
  const itemCount = countSchemaProperties(record.items, nextSeen);
  const variantCount = [
    ...(Array.isArray(record.oneOf) ? record.oneOf : []),
    ...(Array.isArray(record.anyOf) ? record.anyOf : [])
  ].reduce((total, variant) => total + countSchemaProperties(variant, nextSeen), 0);
  return (
    (properties ? Object.keys(properties).length : 0) +
    nestedPropertyCount +
    itemCount +
    variantCount
  );
}

function ExplorerNode({
  name,
  schema,
  required = false,
  depth = 0,
  seen = new Set<object>(),
  expandAll = null
}: {
  name: string;
  schema: unknown;
  required?: boolean;
  depth?: number;
  seen?: Set<object>;
  expandAll?: boolean | null;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  useEffect(() => {
    if (expandAll !== null) setExpanded(expandAll);
  }, [expandAll]);

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return <div className="text-xs">{name}</div>;
  }

  const record = schema as Record<string, unknown>;
  if (seen.has(record)) {
    return <div className="text-xs text-muted-foreground">{name} (circular)</div>;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(record);
  const properties =
    record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : undefined;
  const requiredProperties = new Set(
    Array.isArray(record.required)
      ? record.required.filter((value) => typeof value === 'string')
      : []
  );
  const items = record.items && typeof record.items === 'object' ? record.items : undefined;
  const variants = [
    ...(Array.isArray(record.oneOf) ? record.oneOf : []),
    ...(Array.isArray(record.anyOf) ? record.anyOf : [])
  ];
  const hasChildren =
    (properties && Object.keys(properties).length > 0) || Boolean(items) || variants.length > 0;

  return (
    <div className="min-w-0 space-y-1" style={{ marginLeft: depth * 12 }}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
        {hasChildren ? (
          <button
            type="button"
            className="inline-flex min-w-0 max-w-full items-center gap-1 text-left font-medium hover:underline"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            <span className="break-words">{name}</span>
          </button>
        ) : (
          <span className="break-words font-medium">{name}</span>
        )}
        <Badge variant="outline" className="text-[10px]">
          {schemaType(record)}
        </Badge>
        {required && <span className="text-[10px] text-rose-600">required</span>}
      </div>
      {typeof record.description === 'string' && (
        <div className="max-w-full break-words text-[11px] text-muted-foreground">
          {record.description}
        </div>
      )}
      {Array.isArray(record.enum) && (
        <div className="max-w-full break-words text-[11px] text-muted-foreground">
          Enum: {record.enum.map((value) => String(value)).join(', ')}
        </div>
      )}
      {record.default !== undefined && (
        <div className="max-w-full break-words text-[11px] text-muted-foreground">
          Default: {safeJsonStringify(record.default)}
        </div>
      )}
      {expanded && hasChildren && (
        <div className="min-w-0 space-y-2 border-l pl-2">
          {properties && Object.keys(properties).length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Properties</div>
              {Object.entries(properties).map(([propertyName, propertySchema]) => (
                <ExplorerNode
                  key={propertyName}
                  name={propertyName}
                  schema={propertySchema}
                  required={requiredProperties.has(propertyName)}
                  depth={depth + 1}
                  seen={nextSeen}
                  expandAll={expandAll}
                />
              ))}
            </div>
          )}
          {items && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Items</div>
              <ExplorerNode
                name="item"
                schema={items}
                depth={depth + 1}
                seen={nextSeen}
                expandAll={expandAll}
              />
            </div>
          )}
          {variants.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Variants</div>
              {variants.map((variant, index) => (
                <ExplorerNode
                  key={index}
                  name={`variant ${index + 1}`}
                  schema={variant}
                  depth={depth + 1}
                  seen={nextSeen}
                  expandAll={expandAll}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExplorerControls({
  propertyCount,
  onExpandAll,
  onCollapseAll
}: {
  propertyCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{propertyCount} Properties</span>
      <button
        type="button"
        className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onExpandAll}
      >
        Expand All
      </button>
      <button
        type="button"
        className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onCollapseAll}
      >
        Collapse All
      </button>
    </span>
  );
}

function SchemaHeading({
  title,
  schema,
  explorerControls
}: {
  title: string;
  schema: unknown;
  explorerControls?: ReactNode;
}) {
  const copyLabel = title.toLowerCase();
  const copySchema = async () => {
    try {
      await navigator.clipboard.writeText(safeJsonStringify(schema));
      toast({ title: `${title} copied` });
    } catch (error: unknown) {
      toast({
        title: `Could not copy ${title.toLowerCase()}`,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {explorerControls}
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Copy ${copyLabel} JSON`}
          title={`Copy ${copyLabel} JSON`}
          onClick={() => void copySchema()}
        >
          <Copy className="h-3 w-3" />
          Copy JSON
        </button>
      </div>
    </div>
  );
}

export function ToolSchemaPreview({
  inputSchema,
  outputSchema,
  mode: controlledMode,
  onModeChange
}: {
  inputSchema?: unknown;
  outputSchema?: unknown;
  mode?: SchemaViewMode;
  onModeChange?: (mode: SchemaViewMode) => void;
}) {
  const [uncontrolledMode, setUncontrolledMode] = useState<SchemaViewMode>('explorer');
  const [inputExplorerExpanded, setInputExplorerExpanded] = useState<boolean | null>(null);
  const [outputExplorerExpanded, setOutputExplorerExpanded] = useState<boolean | null>(null);
  const mode = controlledMode ?? uncontrolledMode;
  const setMode = (nextMode: SchemaViewMode) => {
    onModeChange?.(nextMode);
    if (!controlledMode) setUncontrolledMode(nextMode);
  };

  if (inputSchema === undefined && outputSchema === undefined) return null;

  return (
    <details
      className="group/schema min-w-0 max-w-full overflow-hidden rounded border bg-muted/10 p-2"
      onClick={(event) => event.stopPropagation()}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium">
        <span className="flex items-center gap-1.5">
          Schemas
          {inputSchema !== undefined && (
            <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
              input
            </Badge>
          )}
          {outputSchema !== undefined && (
            <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
              output
            </Badge>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="inline-flex rounded-md border bg-muted p-0.5"
            role="tablist"
            aria-label="Schema view mode"
          >
            {(['json', 'explorer'] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                role="tab"
                aria-selected={mode === nextMode}
                className="rounded px-2 py-0.5 text-[11px] font-medium capitalize data-[active=true]:bg-background data-[active=true]:shadow-sm"
                data-active={mode === nextMode}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMode(nextMode);
                }}
              >
                {nextMode.toUpperCase()}
              </button>
            ))}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open/schema:rotate-180" />
        </span>
      </summary>
      <div className="mt-2">
        {mode === 'json' && (
          <div className="mt-2 space-y-2">
            {inputSchema !== undefined && (
              <div className="space-y-1">
                <SchemaHeading title="Input schema" schema={inputSchema} />
                <pre className="max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-2 text-[11px]">
                  {safeJsonStringify(inputSchema)}
                </pre>
              </div>
            )}
            {outputSchema !== undefined && (
              <div className="space-y-1">
                <SchemaHeading title="Output schema" schema={outputSchema} />
                <pre className="max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-2 text-[11px]">
                  {safeJsonStringify(outputSchema)}
                </pre>
              </div>
            )}
          </div>
        )}
        {mode === 'explorer' && (
          <div className="mt-2 min-w-0 space-y-2">
            {inputSchema !== undefined && (
              <div className="min-w-0 space-y-2 rounded border bg-muted/10 p-2">
                <SchemaHeading
                  title="Input schema"
                  schema={inputSchema}
                  explorerControls={
                    <ExplorerControls
                      propertyCount={countSchemaProperties(inputSchema)}
                      onExpandAll={() => setInputExplorerExpanded(true)}
                      onCollapseAll={() => setInputExplorerExpanded(false)}
                    />
                  }
                />
                <ExplorerNode name="root" schema={inputSchema} expandAll={inputExplorerExpanded} />
              </div>
            )}
            {outputSchema !== undefined && (
              <div className="min-w-0 space-y-2 rounded border bg-muted/10 p-2">
                <SchemaHeading
                  title="Output schema"
                  schema={outputSchema}
                  explorerControls={
                    <ExplorerControls
                      propertyCount={countSchemaProperties(outputSchema)}
                      onExpandAll={() => setOutputExplorerExpanded(true)}
                      onCollapseAll={() => setOutputExplorerExpanded(false)}
                    />
                  }
                />
                <ExplorerNode
                  name="root"
                  schema={outputSchema}
                  expandAll={outputExplorerExpanded}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
