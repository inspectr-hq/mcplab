import type { McpResourceInfo, McpServerCatalog } from './mcp.js';

export interface McpCatalogSkillFile {
  uri: string;
  via?: 'tool';
  canRead: boolean;
}

export interface McpCatalogSkill {
  path: string;
  name: string;
  description?: string;
  instructions: McpCatalogSkillFile;
  manifest?: McpCatalogSkillFile;
}

const SKILL_DOCUMENT_URI = /^skill:\/\/([^\s/?#]+(?:\/[^\s/?#]+)*)\/SKILL\.md$/;

export function discoverMcpCatalogSkills(catalog: McpServerCatalog): McpCatalogSkill[] {
  const files = new Map<string, { metadata: McpResourceInfo; reference: McpCatalogSkillFile }>();
  const native = catalog.resources.status === 'ready' ? catalog.resources.items : [];
  for (const metadata of native) {
    files.set(metadata.uri, { metadata, reference: { uri: metadata.uri, canRead: true } });
  }
  const tool = catalog.toolResources;
  if (tool?.status === 'ready') {
    for (const metadata of tool.resources) {
      if (files.has(metadata.uri)) continue;
      files.set(metadata.uri, {
        metadata,
        reference: { uri: metadata.uri, via: 'tool', canRead: tool.canRead }
      });
    }
  }

  const candidates = new Map<string, McpCatalogSkill>();
  for (const { metadata, reference } of files.values()) {
    const path = SKILL_DOCUMENT_URI.exec(metadata.uri)?.[1];
    if (!path) continue;
    candidates.set(path, {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      description: metadata.description,
      instructions: reference,
      manifest: files.get(`skill://${path}/_manifest`)?.reference
    });
  }
  return [...candidates.values()].filter(({ path, manifest }) => {
    if (manifest) return true;
    // An enclosing skill can publish an example SKILL.md as an ordinary supporting file.
    for (let slash = path.lastIndexOf('/'); slash > 0; slash = path.lastIndexOf('/', slash - 1)) {
      if (candidates.has(path.slice(0, slash))) return false;
    }
    return true;
  });
}

export interface McpSkillManifestFile {
  path: string;
  size?: number;
  digest?: string;
}

export function parseMcpSkillManifest(text: string): McpSkillManifestFile[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files))
    return null;
  const files: McpSkillManifestFile[] = [];
  for (const entry of value.files) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !entry.path)
      return null;
    const size = entry.size ?? entry.bytes;
    const digest = entry.hash ?? entry.sha256;
    files.push({
      path: entry.path,
      ...(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
      ...(typeof digest === 'string' && digest ? { digest } : {})
    });
  }
  return files;
}
