import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown } from 'lucide-react';
import { safeJsonStringify } from '@/lib/tool-analysis-utils';

function schemaType(schema: Record<string, unknown>): string {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.properties && typeof schema.properties === 'object') return 'object';
  if (schema.items && typeof schema.items === 'object') return 'array';
  return 'any';
}

function SchemaTree({
  name,
  schema,
  required = false,
  depth = 0
}: {
  name: string;
  schema: unknown;
  required?: boolean;
  depth?: number;
}) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return <div className="text-xs">{name}</div>;
  }

  const record = schema as Record<string, unknown>;
  const properties =
    record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : undefined;
  const requiredProperties = new Set(
    Array.isArray(record.required) ? record.required.filter((value) => typeof value === 'string') : []
  );
  const enumValues = Array.isArray(record.enum) ? record.enum : undefined;
  const items = record.items && typeof record.items === 'object' ? record.items : undefined;

  return (
    <div className="space-y-1" style={{ marginLeft: depth * 12 }}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium">{name}</span>
        <Badge variant="outline" className="text-[10px]">
          {schemaType(record)}
        </Badge>
        {required && <span className="text-[10px] text-rose-600">required</span>}
      </div>
      {typeof record.description === 'string' && (
        <div className="text-[11px] text-muted-foreground">{record.description}</div>
      )}
      {enumValues && (
        <div className="text-[11px] text-muted-foreground">
          Enum: {enumValues.map((value) => String(value)).join(', ')}
        </div>
      )}
      {record.default !== undefined && (
        <div className="text-[11px] text-muted-foreground">
          Default: {safeJsonStringify(record.default)}
        </div>
      )}
      {properties && Object.keys(properties).length > 0 && (
        <div className="space-y-2 border-l pl-2">
          <div className="text-[11px] font-medium text-muted-foreground">Properties</div>
          {Object.entries(properties).map(([propertyName, propertySchema]) => (
            <SchemaTree
              key={propertyName}
              name={propertyName}
              schema={propertySchema}
              required={requiredProperties.has(propertyName)}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
      {items && (
        <div className="border-l pl-2">
          <div className="text-[11px] font-medium text-muted-foreground">Items</div>
          <SchemaTree name="item" schema={items} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

function SchemaUi({ title, schema }: { title: string; schema: unknown }) {
  return (
    <div className="space-y-2 rounded border bg-muted/10 p-2">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <SchemaTree name="root" schema={schema} />
    </div>
  );
}

export function ToolSchemaPreview({
  inputSchema,
  outputSchema
}: {
  inputSchema?: unknown;
  outputSchema?: unknown;
}) {
  const [mode, setMode] = useState<'ui' | 'json'>('json');

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
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open/schema:rotate-180" />
      </summary>
      <div className="mt-2">
        <div className="inline-flex rounded-md border bg-muted p-0.5" role="tablist" aria-label="Schema view mode">
          {(['ui', 'json'] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              role="tab"
              aria-selected={mode === nextMode}
              className="rounded px-2 py-0.5 text-[11px] font-medium capitalize data-[active=true]:bg-background data-[active=true]:shadow-sm"
              data-active={mode === nextMode}
              onClick={(event) => {
                event.stopPropagation();
                setMode(nextMode);
              }}
            >
              {nextMode.toUpperCase()}
            </button>
          ))}
        </div>
        {mode === 'ui' && (
          <div className="mt-2 space-y-2">
          {inputSchema !== undefined && <SchemaUi title="Input schema" schema={inputSchema} />}
          {outputSchema !== undefined && <SchemaUi title="Output schema" schema={outputSchema} />}
          </div>
        )}
        {mode === 'json' && (
          <div className="mt-2 space-y-2">
          {inputSchema !== undefined && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Input schema</div>
              <pre className="max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-2 text-[11px]">
                {safeJsonStringify(inputSchema)}
              </pre>
            </div>
          )}
          {outputSchema !== undefined && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Output schema</div>
              <pre className="max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-2 text-[11px]">
                {safeJsonStringify(outputSchema)}
              </pre>
            </div>
          )}
          </div>
        )}
      </div>
    </details>
  );
}
