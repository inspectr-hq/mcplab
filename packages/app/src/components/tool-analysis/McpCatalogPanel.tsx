import { useId, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { buildCatalogInfoFilename } from '@/lib/tool-analysis-export';
import { McpCatalogToolbar } from './McpCatalogToolbar';
import { McpPreview, type LoadMcpPreview } from './McpPreview';
import { ToolTokenEstimateBadge } from './ToolTokenEstimateBadge';
import type {
  McpCatalogDefinition,
  McpCatalogList,
  McpPromptInfo,
  McpResourceInfo,
  McpResourceTemplateInfo,
  McpServerCatalog
} from '@/lib/data-sources/types';

type Definition = McpCatalogDefinition<McpResourceInfo | McpResourceTemplateInfo | McpPromptInfo>;
type CatalogRow = { id: string; definition: Definition; via?: 'tool' };

export interface McpCatalogView {
  query: string;
  excluded: ReadonlySet<string>;
}

export const defaultMcpCatalogView: McpCatalogView = { query: '', excluded: new Set() };

function catalogRow(definition: Definition, via?: 'tool'): CatalogRow {
  const source = via ?? 'native';
  if ('uri' in definition) return { id: `${source}:resource:${definition.uri}`, definition, via };
  if ('uriTemplate' in definition)
    return { id: `${source}:template:${definition.uriTemplate}`, definition, via };
  return { id: `prompt:${definition.name}`, definition };
}

function listed<T>(section: McpCatalogList<T>): T[] {
  return section.status === 'ready' ? section.items : [];
}

function exportCatalog(
  item: 'prompt' | 'resource',
  serverName: string,
  rows: CatalogRow[]
): string {
  const entries = rows.map(({ definition, via }) => {
    const { estimatedTokens, ...metadata } = definition;
    return via ? { ...metadata, via } : metadata;
  });
  const catalog =
    item === 'prompt'
      ? { prompts: entries }
      : {
          resources: entries.filter((entry) => 'uri' in entry),
          resourceTemplates: entries.filter((entry) => 'uriTemplate' in entry)
        };
  return `${JSON.stringify({ serverName, ...catalog }, null, 2)}\n`;
}

function CatalogSection<T>({
  section,
  label,
  render,
  visible
}: {
  section: McpCatalogList<T>;
  label: string;
  render: (item: T) => ReactNode;
  visible: (item: T) => boolean;
}) {
  if (section.status === 'unsupported') {
    return <p className="text-sm text-muted-foreground">This server does not advertise {label}.</p>;
  }
  if (section.status === 'error') {
    return (
      <p role="alert" className="wrap-anywhere text-sm text-destructive">
        {section.message}
      </p>
    );
  }
  if (section.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No {label} listed.</p>;
  }
  const rows = section.items.filter((item) => visible(item));
  return rows.length ? <ul className="divide-y">{rows.map((item) => render(item))}</ul> : null;
}

function CatalogEntry({
  title,
  description,
  action,
  inlinePreview,
  children,
  estimatedTokens,
  checked,
  onToggle
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  inlinePreview?: ReactNode;
  children?: ReactNode;
  estimatedTokens?: number;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 sm:gap-4">
      <Checkbox
        id={id}
        className="mt-1"
        checked={checked}
        onCheckedChange={(value) => onToggle(Boolean(value))}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <label htmlFor={id} className="cursor-pointer wrap-anywhere text-sm font-medium">
            {title}
          </label>
          <ToolTokenEstimateBadge
            total={estimatedTokens}
            title="Estimated tokens for this entry’s metadata"
          />
        </div>
        {description && (
          <p className="whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {children}
        {inlinePreview}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

export function McpCatalogPanel({
  kind,
  catalog,
  serverName,
  serverVersion,
  loadPreview,
  listViaTool,
  discovering,
  view,
  updateView,
  copyText,
  downloadFile
}: {
  kind: 'resources' | 'prompts';
  catalog: McpServerCatalog;
  serverName: string;
  serverVersion?: string | null;
  loadPreview: LoadMcpPreview;
  listViaTool: () => void;
  discovering: boolean;
  view: McpCatalogView;
  updateView: (update: (previous: McpCatalogView) => McpCatalogView) => void;
  copyText: (label: string, text: string) => Promise<void>;
  downloadFile: (filename: string, text: string, mimeType: string) => void;
}) {
  const item = kind === 'resources' ? 'resource' : 'prompt';
  const toolResources = catalog.toolResources;
  const readyToolResources = toolResources?.status === 'ready' ? toolResources : undefined;
  const rows =
    kind === 'prompts'
      ? listed(catalog.prompts).map((entry) => catalogRow(entry))
      : [
          ...listed(catalog.resources).map((entry) => catalogRow(entry)),
          ...listed(catalog.resourceTemplates).map((entry) => catalogRow(entry)),
          ...(readyToolResources?.resources ?? []).map((entry) => catalogRow(entry, 'tool')),
          ...(readyToolResources?.resourceTemplates ?? []).map((entry) => catalogRow(entry, 'tool'))
        ];
  const query = view.query.trim().toLowerCase();
  const visible = rows.filter(({ definition }) => {
    const { name, title, description } = definition;
    const fields = [name, title, description];
    if ('uri' in definition) fields.push(definition.uri);
    if ('uriTemplate' in definition) fields.push(definition.uriTemplate);
    if ('arguments' in definition) {
      for (const argument of definition.arguments ?? [])
        fields.push(argument.name, argument.description);
    }
    return !query || fields.some((value) => value?.toLowerCase().includes(query));
  });
  const visibleIds = new Set(visible.map((row) => row.id));
  const isVisible = (definition: Definition, via?: 'tool') =>
    visibleIds.has(catalogRow(definition, via).id);
  const selected = rows.filter((row) => !view.excluded.has(row.id));
  const hasEstimates = rows.some(({ definition }) => definition.estimatedTokens !== undefined);
  const countTokens = (entries: CatalogRow[]) =>
    hasEstimates
      ? entries.reduce((total, { definition }) => total + (definition.estimatedTokens ?? 0), 0)
      : undefined;
  const updateSelection = (ids: string[], checked: boolean) =>
    updateView((previous) => {
      const excluded = new Set(previous.excluded);
      for (const id of ids) {
        if (checked) excluded.delete(id);
        else excluded.add(id);
      }
      return { ...previous, excluded };
    });
  const selectable = ({ id, definition }: CatalogRow) => ({
    estimatedTokens: definition.estimatedTokens,
    checked: !view.excluded.has(id),
    onToggle: (checked: boolean) => updateSelection([id], checked)
  });
  const toolbar = rows.length > 0 && (
    <McpCatalogToolbar
      item={item}
      query={view.query}
      onQueryChange={(nextQuery) => updateView((previous) => ({ ...previous, query: nextQuery }))}
      selectedCount={selected.length}
      count={rows.length}
      selectedTokens={countTokens(selected)}
      totalTokens={countTokens(rows)}
      allVisibleSelected={visible.every((row) => !view.excluded.has(row.id))}
      hasVisibleItems={visible.length > 0}
      busy={discovering}
      onSelectVisible={() =>
        updateSelection(
          visible.map((row) => row.id),
          true
        )
      }
      onClear={() =>
        updateSelection(
          rows.map((row) => row.id),
          false
        )
      }
      onCopy={() =>
        void copyText(
          item === 'resource' ? 'Resource list' : 'Prompt list',
          exportCatalog(item, serverName, visible)
        )
      }
      onDownload={() =>
        downloadFile(
          buildCatalogInfoFilename(item, serverName, serverVersion),
          exportCatalog(item, serverName, selected.length ? selected : rows),
          'application/json'
        )
      }
    />
  );
  const noMatches = rows.length > 0 && visible.length === 0;
  const bodyClass = `px-3 py-4 sm:px-4${rows.length ? ' border-t' : ''}`;
  const renderResource = (
    resource: McpCatalogDefinition<McpResourceInfo | McpResourceTemplateInfo>,
    via?: 'tool',
    canRead = true
  ) => {
    const target =
      'uri' in resource
        ? { kind: 'resource' as const, uri: resource.uri }
        : { kind: 'template' as const, uriTemplate: resource.uriTemplate };
    const uri = target.kind === 'resource' ? target.uri : target.uriTemplate;
    const title = resource.title || resource.name;
    const isSkillFile = /\/SKILL\.md(?:[?#].*)?$/.test(uri);
    const row = catalogRow(resource, via);
    const preview = canRead && (
      <McpPreview
        title={title}
        serverName={serverName}
        target={target}
        load={loadPreview}
        via={via}
        inline={isSkillFile ? 'skill' : undefined}
      />
    );
    return (
      <CatalogEntry
        key={row.id}
        {...selectable(row)}
        title={title}
        description={resource.description}
        action={!isSkillFile && preview}
        inlinePreview={isSkillFile && preview}
      >
        {resource.title && resource.title !== resource.name && (
          <p className="wrap-anywhere font-mono text-xs">{resource.name}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-all font-mono text-xs">{uri}</p>
          {isSkillFile && (
            <Badge variant="secondary">
              {target.kind === 'resource' ? 'Skill file' : 'Skill file template'}
            </Badge>
          )}
        </div>
        {resource.mimeType && <p className="text-xs text-muted-foreground">{resource.mimeType}</p>}
      </CatalogEntry>
    );
  };

  if (kind === 'prompts') {
    return (
      <>
        {toolbar}
        <div className={bodyClass} role={noMatches ? 'status' : undefined}>
          {noMatches && (
            <p className="text-sm text-muted-foreground">No prompts match your search.</p>
          )}
          <CatalogSection
            section={catalog.prompts}
            label="prompts"
            visible={(prompt) => isVisible(prompt)}
            render={(prompt) => {
              const title = prompt.title || prompt.name;
              const row = catalogRow(prompt);
              return (
                <CatalogEntry
                  key={row.id}
                  {...selectable(row)}
                  title={title}
                  description={prompt.description}
                  action={
                    <McpPreview
                      title={title}
                      serverName={serverName}
                      target={{ kind: 'prompt', prompt }}
                      load={loadPreview}
                    />
                  }
                >
                  {prompt.title && prompt.title !== prompt.name && (
                    <p className="wrap-anywhere font-mono text-xs">{prompt.name}</p>
                  )}
                  {prompt.arguments?.length > 0 && (
                    <ul
                      aria-label="Prompt arguments"
                      className="space-y-1 text-xs text-muted-foreground"
                    >
                      {prompt.arguments.map((argument) => (
                        <li key={argument.name} className="wrap-anywhere">
                          <code>{argument.name}</code> (
                          {argument.required ? 'required' : 'optional'})
                          {argument.description && <span> · {argument.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CatalogEntry>
              );
            }}
          />
        </div>
      </>
    );
  }

  const nativeTemplates = listed(catalog.resourceTemplates);
  const showTemplates =
    catalog.resourceTemplates.status !== 'unsupported' &&
    (!nativeTemplates.length || nativeTemplates.some((entry) => isVisible(entry)));
  const visibleToolTemplates =
    readyToolResources?.resourceTemplates.filter((entry) => isVisible(entry, 'tool')) ?? [];
  return (
    <>
      {toolbar}
      <div className={`space-y-4 ${bodyClass}`}>
        {noMatches && (
          <p role="status" className="text-sm text-muted-foreground">
            No resources match your search.
          </p>
        )}
        <CatalogSection
          section={catalog.resources}
          label={toolResources ? 'native resources' : 'resources'}
          render={renderResource}
          visible={isVisible}
        />
        {showTemplates && (
          <section className="space-y-2" aria-label="Resource templates">
            <h3 className="text-sm font-medium">Resource templates</h3>
            <CatalogSection
              section={catalog.resourceTemplates}
              label="resource templates"
              render={renderResource}
              visible={isVisible}
            />
          </section>
        )}
        {toolResources && (
          <section aria-label="Server tool resources" className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Server tool resources</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11 sm:h-8"
                disabled={discovering}
                onClick={listViaTool}
              >
                List via server tool
              </Button>
            </div>
            {toolResources.status === 'error' && (
              <p role="alert" className="wrap-anywhere text-sm text-destructive">
                {toolResources.message}
              </p>
            )}
            {toolResources.status === 'ready' && (
              <>
                <CatalogSection
                  section={{ status: 'ready', items: toolResources.resources }}
                  label="server tool resources"
                  render={(item) => renderResource(item, 'tool', toolResources.canRead)}
                  visible={(item) => isVisible(item, 'tool')}
                />
                {visibleToolTemplates.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Resource templates</h4>
                    <ul className="divide-y">
                      {visibleToolTemplates.map((item) =>
                        renderResource(item, 'tool', toolResources.canRead)
                      )}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
