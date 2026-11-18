import {
  resolveMcpSkillManifestFiles,
  type McpCatalogSkill,
  type McpServerCatalog
} from '@/lib/data-sources/types';
import { McpPreview, type LoadMcpPreview } from './McpPreview';
import { McpSkillFileBrowser } from './McpSkillFileBrowser';

export function McpSkillsPanel({
  skills,
  catalog,
  serverName,
  loadPreview
}: {
  skills: McpCatalogSkill[];
  catalog: McpServerCatalog;
  serverName: string;
  loadPreview: LoadMcpPreview;
}) {
  return (
    <ul aria-label="Discovered skills" className="divide-y px-3 sm:px-4">
      {skills.map((skill) => {
        const { path, name, description, instructions, manifest } = skill;
        return (
          <li key={path} className="min-w-0 space-y-2 py-4">
            <h3 className="wrap-anywhere text-sm font-semibold">{name}</h3>
            <p className="wrap-anywhere font-mono text-xs text-muted-foreground">skill://{path}</p>
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
                  title={name}
                  serverName={serverName}
                  target={{ kind: 'resource', uri: manifest.uri }}
                  load={loadPreview}
                  via={manifest.via}
                  inline="manifest"
                  renderManifest={(files) => (
                    <McpSkillFileBrowser
                      files={resolveMcpSkillManifestFiles(skill, files, catalog)}
                      serverName={serverName}
                      load={loadPreview}
                    />
                  )}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
