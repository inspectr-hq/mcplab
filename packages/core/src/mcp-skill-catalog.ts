import type { McpResourceInfo, McpServerCatalog } from './mcp.js';

export interface McpCatalogSkillFile {
  uri: string;
  via?: 'tool';
  canRead: boolean;
  mimeType?: string;
}

export interface McpCatalogSkill {
  path: string;
  name: string;
  description?: string;
  instructions: McpCatalogSkillFile;
  manifest?: McpCatalogSkillFile;
}

const SKILL_DOCUMENT_URI = /^skill:\/\/([^\s/?#]+(?:\/[^\s/?#]+)*)\/SKILL\.md$/;

function catalogResources(catalog: McpServerCatalog) {
  const files = new Map<string, { metadata: McpResourceInfo; reference: McpCatalogSkillFile }>();
  const native = 'items' in catalog.resources ? catalog.resources.items : [];
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
  return files;
}

export function discoverMcpCatalogSkills(catalog: McpServerCatalog): McpCatalogSkill[] {
  const files = catalogResources(catalog);
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

export interface McpSkillFileEntry extends McpSkillManifestFile {
  resource?: McpCatalogSkillFile;
}

function encodeSkillFilePath(path: string): string | undefined {
  const segments = path.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..' || /[\p{Cc}\\]/u.test(part)))
    return undefined;
  try {
    return segments
      .map((part) =>
        encodeURIComponent(part).replace(
          /[!'()*]/g,
          (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
        )
      )
      .join('/');
  } catch {
    return undefined;
  }
}

export function resolveMcpSkillManifestFiles(
  skill: McpCatalogSkill,
  files: McpSkillManifestFile[],
  catalog: McpServerCatalog
): McpSkillFileEntry[] {
  const resources = catalogResources(catalog);
  const fallback = skill.manifest ?? skill.instructions;
  const root = `skill://${skill.path}`;
  return [
    ...files.filter((file) => file.path === 'SKILL.md'),
    ...files.filter((file) => file.path !== 'SKILL.md')
  ].map((file) => {
    const relativeUri = encodeSkillFilePath(file.path);
    if (!relativeUri) return file;
    const uri = `${root}/${relativeUri}`;
    const listed = resources.get(uri);
    const resource = listed?.reference ?? { ...fallback, uri };
    const mimeType = listed?.metadata.mimeType;
    return { ...file, resource: mimeType ? { ...resource, mimeType } : resource };
  });
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
