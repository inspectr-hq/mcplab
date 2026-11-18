import type { McpCatalogSkill } from '@/lib/data-sources/types';
import { McpPreview, type LoadMcpPreview } from './McpPreview';

export function McpSkillsPanel({
  skills,
  serverName,
  loadPreview
}: {
  skills: McpCatalogSkill[];
  serverName: string;
  loadPreview: LoadMcpPreview;
}) {
  return (
    <ul aria-label="Discovered skills" className="divide-y px-3 sm:px-4">
      {skills.map(({ path, name, description, instructions, manifest }) => (
        <li key={path} className="min-w-0 space-y-2 py-4">
          <h3 className="wrap-anywhere text-sm font-semibold">{name}</h3>
          {path !== name && (
            <p className="wrap-anywhere font-mono text-xs text-muted-foreground">{path}</p>
          )}
          {description && (
            <p className="whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground">
              {description}
            </p>
          )}
          <div className="space-y-1">
            {instructions.canRead && (
              <McpPreview
                title={name}
                serverName={serverName}
                target={{ kind: 'resource', uri: instructions.uri }}
                load={loadPreview}
                via={instructions.via}
                inline="skill"
              />
            )}
            {manifest?.canRead && (
              <McpPreview
                title={`${name} manifest`}
                serverName={serverName}
                target={{ kind: 'resource', uri: manifest.uri }}
                load={loadPreview}
                via={manifest.via}
                inline="manifest"
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
