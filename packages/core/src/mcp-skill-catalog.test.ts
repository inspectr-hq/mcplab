import { describe, expect, it } from 'vitest';
import type { McpServerCatalog } from './mcp.js';
import {
  discoverMcpCatalogSkills,
  parseMcpSkillManifest,
  resolveMcpSkillManifestFiles
} from './mcp-skill-catalog.js';

const resource = (uri: string, description?: string) => ({ name: uri, uri, description });

describe('discoverMcpCatalogSkills', () => {
  it('groups FastMCP skill resources and preserves the transport for each file', () => {
    const instructions = 'skill://team/work-organizer/SKILL.md';
    const manifest = 'skill://team/work-organizer/_manifest';
    const catalog: McpServerCatalog = {
      resources: {
        status: 'ready',
        items: [
          resource(instructions, 'Find saved work.'),
          resource('skill://team/work-organizer/examples/SKILL.md'),
          resource('skill://manifest-only/_manifest'),
          resource('docs://guide/SKILL.md')
        ]
      },
      resourceTemplates: { status: 'unsupported' },
      prompts: { status: 'unsupported' },
      toolResources: {
        status: 'ready',
        canRead: true,
        resources: [resource(instructions), resource(manifest)],
        resourceTemplates: []
      }
    };
    expect(discoverMcpCatalogSkills(catalog)).toEqual([
      {
        path: 'team/work-organizer',
        name: 'work-organizer',
        description: 'Find saved work.',
        instructions: { uri: instructions, canRead: true },
        manifest: { uri: manifest, via: 'tool', canRead: true }
      }
    ]);
  });
});

describe('parseMcpSkillManifest', () => {
  it('reads FastMCP and MCPLab file metadata and preserves raw fallback for unknown shapes', () => {
    expect(
      parseMcpSkillManifest(
        JSON.stringify({
          skill: 'demo',
          files: [{ path: 'SKILL.md', size: 42, hash: 'sha256:abc' }]
        })
      )
    ).toEqual([{ path: 'SKILL.md', size: 42, digest: 'sha256:abc' }]);
    expect(
      parseMcpSkillManifest(
        JSON.stringify({ name: 'demo', files: [{ path: 'notes.md', bytes: 0, sha256: 'def' }] })
      )
    ).toEqual([{ path: 'notes.md', size: 0, digest: 'def' }]);
    expect(parseMcpSkillManifest('{"files":["invalid"]}')).toBeNull();
    expect(parseMcpSkillManifest('not JSON')).toBeNull();
  });
});

describe('resolveMcpSkillManifestFiles', () => {
  it('looks up advertised file transports and resolves unlisted paths within the skill', () => {
    const root = 'skill://team/work-organizer';
    const catalog: McpServerCatalog = {
      resources: {
        status: 'ready',
        items: [resource(`${root}/SKILL.md`), resource(`${root}/references/native.md`)]
      },
      resourceTemplates: { status: 'unsupported' },
      prompts: { status: 'unsupported' },
      toolResources: {
        status: 'ready',
        canRead: true,
        resources: [resource(`${root}/_manifest`), resource(`${root}/references/tool.md`)],
        resourceTemplates: []
      }
    };
    const [skill] = discoverMcpCatalogSkills(catalog);
    const files = [
      { path: 'references/native.md' },
      { path: 'references/tool.md' },
      { path: 'references/first draft (1).md' },
      { path: '../other/SKILL.md' },
      { path: 'skill://other/SKILL.md' },
      { path: 'references\\outside.md' },
      { path: 'SKILL.md' }
    ];
    expect(resolveMcpSkillManifestFiles(skill, files, catalog)).toEqual([
      { path: 'SKILL.md', resource: { uri: `${root}/SKILL.md`, canRead: true } },
      {
        path: 'references/native.md',
        resource: { uri: `${root}/references/native.md`, canRead: true }
      },
      {
        path: 'references/tool.md',
        resource: { uri: `${root}/references/tool.md`, via: 'tool', canRead: true }
      },
      {
        path: 'references/first draft (1).md',
        resource: {
          uri: `${root}/references/first%20draft%20%281%29.md`,
          via: 'tool',
          canRead: true
        }
      },
      { path: '../other/SKILL.md' },
      { path: 'skill://other/SKILL.md' },
      { path: 'references\\outside.md' }
    ]);
  });
});
