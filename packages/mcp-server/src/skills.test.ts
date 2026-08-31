import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const originalEnv = { ...process.env };
const roots: string[] = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeFixtureSkillsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-skills-'));
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

describe('loadSkills', () => {
  it('falls back to repository skills when running from source', async () => {
    delete process.env.MCPLAB_SKILLS_DIR;
    const { resolveSkillsDir } = await import('./skills.js');
    expect(resolveSkillsDir()).toMatch(/(?:^|\/)skills$/);
  });

  it('loads a skill with description parsed from frontmatter and SKILL.md listed first', async () => {
    makeFixtureSkillsDir();
    const { loadSkills } = await import('./skills.js');
    const skills = loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
    expect(skills[0].description).toBe('A demo skill for tests.');
    expect(skills[0].files[0]).toBe('SKILL.md');
    expect(skills[0].files).toContain('references/notes.md');
  });

  it('computes a stable sha256 manifest across repeated loads', async () => {
    makeFixtureSkillsDir();
    const { loadSkills } = await import('./skills.js');
    const first = loadSkills();
    const second = loadSkills();
    expect(first[0].manifest).toEqual(second[0].manifest);
    const skillMdEntry = first[0].manifest.files.find((f) => f.path === 'SKILL.md');
    expect(skillMdEntry?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const expectedHash = createHash('sha256')
      .update('---\nname: demo-skill\ndescription: A demo skill for tests.\n---\n\n# Demo Skill\n')
      .digest('hex');
    expect(skillMdEntry?.sha256).toBe(expectedHash);
  });

  it('returns an empty list and does not throw when the skills directory is missing', async () => {
    process.env.MCPLAB_SKILLS_DIR = join(tmpdir(), 'does-not-exist-mcplab-skills');
    const { loadSkills } = await import('./skills.js');
    expect(loadSkills({ error: () => {} })).toEqual([]);
  });

  it('returns an empty list and does not throw when the skills directory exists but has no subdirectories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-skills-empty-'));
    roots.push(root);
    process.env.MCPLAB_SKILLS_DIR = root;
    const { loadSkills } = await import('./skills.js');
    expect(loadSkills({ error: () => {} })).toEqual([]);
  });

  it('skips a skill subdirectory missing SKILL.md and still returns valid skills', async () => {
    const root = makeFixtureSkillsDir();
    mkdirSync(join(root, 'broken-skill'), { recursive: true });
    writeFileSync(join(root, 'broken-skill', 'notes.md'), 'no SKILL.md here\n');
    const { loadSkills } = await import('./skills.js');
    const skills = loadSkills({ error: () => {} });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
  });

  it('skips a skill directory whose name is unsafe for a skill:// resource URI, keeping other skills', async () => {
    const root = makeFixtureSkillsDir();
    mkdirSync(join(root, 'bad skill name'), { recursive: true });
    writeFileSync(
      join(root, 'bad skill name', 'SKILL.md'),
      '---\nname: bad skill name\ndescription: Should be skipped.\n---\n\n# Bad\n'
    );
    const { loadSkills } = await import('./skills.js');
    const skills = loadSkills({ error: () => {} });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
  });

  it('excludes a file whose relative path is unsafe for a skill:// resource URI, keeping the rest of the skill', async () => {
    const root = makeFixtureSkillsDir();
    writeFileSync(join(root, 'demo-skill', 'references', 'my notes.md'), '# My Notes\n');
    const { loadSkills } = await import('./skills.js');
    const skills = loadSkills({ error: () => {} });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
    expect(skills[0].files).not.toContain('references/my notes.md');
    expect(skills[0].files).toContain('references/notes.md');
    expect(skills[0].manifest.files.map((f) => f.path)).not.toContain('references/my notes.md');
  });

  it('does not false-positive on a normal kebab-case skill with ordinary filenames', async () => {
    makeFixtureSkillsDir();
    const { loadSkills } = await import('./skills.js');
    const skills = loadSkills({ error: () => {} });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
    expect(skills[0].files).toEqual(['SKILL.md', 'references/notes.md']);
  });
});

describe('readSkillFile', () => {
  it('reads a file within a skill by relative path', async () => {
    makeFixtureSkillsDir();
    const { readSkillFile } = await import('./skills.js');
    expect(readSkillFile('demo-skill', 'references/notes.md')).toBe('# Notes\n');
  });

  it('throws for an unknown skill', async () => {
    makeFixtureSkillsDir();
    const { readSkillFile } = await import('./skills.js');
    expect(() => readSkillFile('missing-skill', 'SKILL.md')).toThrow(/Unknown skill/);
  });

  it('throws for an unknown file within a known skill', async () => {
    makeFixtureSkillsDir();
    const { readSkillFile } = await import('./skills.js');
    expect(() => readSkillFile('demo-skill', 'nope.md')).toThrow(/Unknown skill file/);
  });

  it('throws when the skill name traverses outside the skills root', async () => {
    makeFixtureSkillsDir();
    const { readSkillFile } = await import('./skills.js');
    expect(() => readSkillFile('..', 'package.json')).toThrow(/Unknown skill/);
    expect(() => readSkillFile('../../etc', 'passwd')).toThrow(/Unknown skill/);
  });

  it('throws rather than following a symlink that escapes the skill directory', async () => {
    const root = makeFixtureSkillsDir();
    const secretRoot = mkdtempSync(join(tmpdir(), 'mcplab-skills-secret-'));
    roots.push(secretRoot);
    const secretPath = join(secretRoot, 'secret.txt');
    writeFileSync(secretPath, 'TOP SECRET\n');
    const linkPath = join(root, 'demo-skill', 'leak.md');
    symlinkSync(secretPath, linkPath);
    const { readSkillFile } = await import('./skills.js');
    expect(() => readSkillFile('demo-skill', 'leak.md')).toThrow(/Unknown skill file/);
  });

  it('throws rather than following a symlinked subdirectory that escapes the skill directory', async () => {
    const root = makeFixtureSkillsDir();
    const secretRoot = mkdtempSync(join(tmpdir(), 'mcplab-skills-secret-dir-'));
    roots.push(secretRoot);
    writeFileSync(join(secretRoot, 'secret.txt'), 'TOP SECRET\n');
    const linkPath = join(root, 'demo-skill', 'shared');
    symlinkSync(secretRoot, linkPath, 'dir');
    const { readSkillFile } = await import('./skills.js');
    expect(() => readSkillFile('demo-skill', 'shared/secret.txt')).toThrow(/Unknown skill file/);
  });
});
