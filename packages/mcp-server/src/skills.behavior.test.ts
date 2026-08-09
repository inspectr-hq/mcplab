import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type RegisteredResource = {
  uri: string;
  config: { title?: string; mimeType?: string };
  cb: (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>;
};

const originalEnv = { ...process.env };
const roots: string[] = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

function makeFixtureSkillsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-skills-behavior-'));
  roots.push(root);
  const skillDir = join(root, 'demo-skill');
  mkdirSync(join(skillDir, 'references'), { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: demo-skill\ndescription: A demo skill for tests.\n---\n\n# Demo Skill\n'
  );
  writeFileSync(join(skillDir, 'references', 'notes.md'), '# Notes\n');
  process.env.MCPLAB_SKILLS_DIR = root;
  return root;
}

async function setupResources(): Promise<Map<string, RegisteredResource>> {
  const { registerSkills } = await import('./skills.js');
  const resources = new Map<string, RegisteredResource>();
  const fakeServer = {
    registerResource: (
      _name: string,
      uri: string,
      config: RegisteredResource['config'],
      cb: RegisteredResource['cb']
    ) => {
      resources.set(uri, { uri, config, cb });
    }
  };
  registerSkills(fakeServer as any);
  return resources;
}

async function setupTools(): Promise<
  Map<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>
> {
  vi.resetModules();
  const { registerTools } = await import('./runtime.js');
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>();
  registerTools({
    registerTool: (name: string, _config: unknown, cb: any) => {
      tools.set(name, cb);
      return { name };
    }
  } as any);
  return tools;
}

function toolResult<T>(value: unknown): { isError?: boolean; structuredContent: T } {
  return value as { isError?: boolean; structuredContent: T };
}

describe('registerSkills resources', () => {
  it('registers SKILL.md, _manifest, and supporting files under skill:// URIs', async () => {
    makeFixtureSkillsDir();
    const resources = await setupResources();
    expect([...resources.keys()].sort()).toEqual(
      [
        'skill://demo-skill/SKILL.md',
        'skill://demo-skill/_manifest',
        'skill://demo-skill/references/notes.md'
      ].sort()
    );
  });

  it('reads back file content matching disk content', async () => {
    makeFixtureSkillsDir();
    const resources = await setupResources();
    const resource = resources.get('skill://demo-skill/references/notes.md')!;
    const result = await resource.cb(new URL(resource.uri));
    expect(result.contents[0].text).toBe('# Notes\n');
    expect(result.contents[0].mimeType).toBe('text/markdown');
  });

  it('serves a JSON manifest with sha256 hashes', async () => {
    makeFixtureSkillsDir();
    const resources = await setupResources();
    const resource = resources.get('skill://demo-skill/_manifest')!;
    const result = await resource.cb(new URL(resource.uri));
    const manifest = JSON.parse(result.contents[0].text);
    expect(manifest.name).toBe('demo-skill');
    expect(manifest.files.find((f: { path: string }) => f.path === 'SKILL.md').sha256).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  it('does not crash when a skill has a top-level file literally named _manifest, and still registers other skills', async () => {
    const root = makeFixtureSkillsDir();
    const badSkillDir = join(root, 'bad-manifest-skill');
    mkdirSync(badSkillDir, { recursive: true });
    writeFileSync(
      join(badSkillDir, 'SKILL.md'),
      '---\nname: bad-manifest-skill\ndescription: Collides with the manifest URI.\n---\n\n# Bad\n'
    );
    // A real top-level file named `_manifest` produces the same skill://bad-manifest-skill/_manifest
    // URI as the explicit manifest resource registered afterwards, which a real MCP server's
    // registerResource rejects as a duplicate.
    writeFileSync(join(badSkillDir, '_manifest'), 'not actually a manifest\n');

    const { registerSkills } = await import('./skills.js');
    const registered = new Map<string, unknown>();
    const errors: unknown[][] = [];
    const throwingFakeServer = {
      registerResource: (_name: string, uri: string, _config: unknown, cb: unknown) => {
        if (registered.has(uri)) {
          throw new Error(`Resource ${uri} is already registered`);
        }
        registered.set(uri, cb);
      }
    };

    expect(() =>
      registerSkills(throwingFakeServer as any, { error: (...args: unknown[]) => errors.push(args) })
    ).not.toThrow();

    // The failing skill's collision was logged rather than thrown.
    expect(errors.length).toBeGreaterThan(0);

    // The other, valid skill's resources were still registered normally.
    expect(registered.has('skill://demo-skill/SKILL.md')).toBe(true);
    expect(registered.has('skill://demo-skill/references/notes.md')).toBe(true);
    expect(registered.has('skill://demo-skill/_manifest')).toBe(true);
  });
});

describe('mcplab_list_skills / mcplab_get_skill tools', () => {
  it('lists skills without exposing manifest hashes', async () => {
    makeFixtureSkillsDir();
    const tools = await setupTools();
    const result = toolResult<{
      skills: Array<{ name: string; description: string; files: string[] }>;
    }>(await tools.get('mcplab_list_skills')!({}));
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{64}/);
    expect(result.structuredContent.skills).toEqual([
      {
        name: 'demo-skill',
        description: 'A demo skill for tests.',
        files: ['SKILL.md', 'references/notes.md']
      }
    ]);
  });

  it('returns file content matching the resource content', async () => {
    makeFixtureSkillsDir();
    const tools = await setupTools();
    const result = toolResult<{ name: string; file: string; content: string }>(
      await tools.get('mcplab_get_skill')!({ name: 'demo-skill', file: 'references/notes.md' })
    );
    expect(result.structuredContent.content).toBe('# Notes\n');
  });

  it('defaults to SKILL.md when file is omitted', async () => {
    makeFixtureSkillsDir();
    const tools = await setupTools();
    const result = toolResult<{ file: string; content: string }>(
      await tools.get('mcplab_get_skill')!({ name: 'demo-skill' })
    );
    expect(result.structuredContent.file).toBe('SKILL.md');
    expect(result.structuredContent.content).toContain('# Demo Skill');
  });

  it('returns a well-formed error for an unknown skill', async () => {
    makeFixtureSkillsDir();
    const tools = await setupTools();
    const result = toolResult(await tools.get('mcplab_get_skill')!({ name: 'nope' }));
    expect(result.isError).toBe(true);
  });
});
