import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { McpPreviewDialog, type LoadMcpPreview } from './McpPreviewDialog';
import type {
  McpCatalogList,
  McpResourceInfo,
  McpResourceTemplateInfo,
  McpServerCatalog
} from '@/lib/data-sources/types';

function CatalogSection<T>({
  section,
  label,
  render
}: {
  section: McpCatalogList<T>;
  label: string;
  render: (item: T) => ReactNode;
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
  return <ul className="divide-y">{section.items.map((item) => render(item))}</ul>;
}

function CatalogEntry({
  title,
  description,
  action,
  children
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 sm:gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="wrap-anywhere text-sm font-medium">{title}</p>
        {children}
        {description && (
          <p className="whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

export function McpCatalogPanel({
  kind,
  catalog,
  serverName,
  loadPreview,
  listViaTool,
  discovering
}: {
  kind: 'resources' | 'prompts';
  catalog: McpServerCatalog;
  serverName: string;
  loadPreview: LoadMcpPreview;
  listViaTool: () => void;
  discovering: boolean;
}) {
  const renderResource = (
    resource: McpResourceInfo | McpResourceTemplateInfo,
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
    return (
      <CatalogEntry
        key={uri}
        title={title}
        description={resource.description}
        action={
          canRead && (
            <McpPreviewDialog
              title={title}
              serverName={serverName}
              target={target}
              load={loadPreview}
              via={via}
            />
          )
        }
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
      <CatalogSection
        section={catalog.prompts}
        label="prompts"
        render={(prompt) => {
          const title = prompt.title || prompt.name;
          return (
            <CatalogEntry
              key={prompt.name}
              title={title}
              description={prompt.description}
              action={
                <McpPreviewDialog
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
                      <code>{argument.name}</code> ({argument.required ? 'required' : 'optional'})
                      {argument.description && <span> · {argument.description}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CatalogEntry>
          );
        }}
      />
    );
  }

  const showTemplates = catalog.resourceTemplates.status !== 'unsupported';
  const toolResources = catalog.toolResources;
  return (
    <div className="space-y-4">
      <CatalogSection
        section={catalog.resources}
        label={toolResources ? 'native resources' : 'resources'}
        render={renderResource}
      />
      {showTemplates && (
        <section className="space-y-2" aria-label="Resource templates">
          <h3 className="text-sm font-medium">Resource templates</h3>
          <CatalogSection
            section={catalog.resourceTemplates}
            label="resource templates"
            render={renderResource}
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
              />
              {toolResources.resourceTemplates.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Resource templates</h4>
                  <ul className="divide-y">
                    {toolResources.resourceTemplates.map((item) =>
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
  );
}
