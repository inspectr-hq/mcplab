import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export type SkillManifestEntry = {
  path: string;
  bytes: number;
  sha256: string;
};

export type SkillManifest = {
  name: string;
  files: SkillManifestEntry[];
};

export type LoadedSkill = {
  name: string;
  description: string;
  /** Relative file paths within the skill directory, SKILL.md always first. */
  files: string[];
  manifest: SkillManifest;
};

export function resolveSkillsDir(): string {
  const override = process.env.MCPLAB_SKILLS_DIR?.trim();
  if (override) return resolve(override);
  const bundled = fileURLToPath(new URL('./skills', import.meta.url));
  if (existsSync(bundled)) return bundled;
  // Development runs load this module from src/, while production loads the
  // copied resources from dist/. Fall back to the repository skill source.
  const repositorySkills = fileURLToPath(new URL('../../../skills', import.meta.url));
  return repositorySkills;
}

function parseFrontmatterDescription(skillMdContent: string): string {
  const match = skillMdContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  try {
    const frontmatter = parseYaml(match[1]);
    const description =
      frontmatter && typeof frontmatter === 'object'
        ? (frontmatter as Record<string, unknown>).description
        : undefined;
    return typeof description === 'string' ? description.trim() : '';
  } catch {
    return '';
  }
}

/** Lists files within a skill directory. Symlinks (files or directories) are skipped entirely. */
function listFilesRecursive(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs, base));
    } else if (entry.isFile()) {
      out.push(relative(base, abs).split(sep).join('/'));
    }
  }
  return out.sort();
}

// Skill names and relative file paths are interpolated directly into `skill://<name>/<path>`
// resource URIs (see registerSkills below). Restricting both to a safe character set at load
// time guarantees every URI we build is parseable (e.g. `new URL('skill://my skill/SKILL.md')`
// throws) and avoids reserved/ambiguous characters, without needing to encode/decode later.
const SAFE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_RELATIVE_FILE_PATH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

function loadSkill(skillsRoot: string, name: string, logger: Pick<Console, 'error'>): LoadedSkill {
  const dir = join(skillsRoot, name);
  const relativeFiles = listFilesRecursive(dir, dir).filter((relPath) => {
    if (SAFE_RELATIVE_FILE_PATH_PATTERN.test(relPath)) return true;
    logger.error(
      `[mcplab-mcp] skipping file '${relPath}' in skill '${name}': unsafe characters for a skill:// resource URI`
    );
    return false;
  });
  if (!relativeFiles.includes('SKILL.md')) {
    throw new Error(`Skill '${name}' is missing SKILL.md`);
  }
  const orderedFiles = ['SKILL.md', ...relativeFiles.filter((f) => f !== 'SKILL.md')];
  let skillMdContent = '';
  const manifestFiles: SkillManifestEntry[] = orderedFiles.map((relPath) => {
    const content = readFileSync(join(dir, relPath));
    if (relPath === 'SKILL.md') skillMdContent = content.toString('utf8');
    return {
      path: relPath,
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex')
    };
  });
  const description = parseFrontmatterDescription(skillMdContent);
  return {
    name,
    description,
    files: orderedFiles,
    manifest: { name, files: manifestFiles }
  };
}

export function loadSkills(logger: Pick<Console, 'error'> = console): LoadedSkill[] {
  const skillsRoot = resolveSkillsDir();
  if (!existsSync(skillsRoot)) {
    logger.error(
      `[mcplab-mcp] skills directory not found at ${skillsRoot}; skipping skill registration`
    );
    return [];
  }
  const names = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const skills: LoadedSkill[] = [];
  for (const name of names) {
    if (!SAFE_SKILL_NAME_PATTERN.test(name)) {
      logger.error(
        `[mcplab-mcp] skipping skill '${name}': name contains characters unsafe for a skill:// resource URI`
      );
      continue;
    }
    try {
      skills.push(loadSkill(skillsRoot, name, logger));
    } catch (error) {
      logger.error(`[mcplab-mcp] failed to load skill '${name}':`, error);
    }
  }
  return skills;
}

export function readSkillFile(name: string, file: string): string {
  const skillsRoot = resolve(resolveSkillsDir());
  const dir = resolve(join(skillsRoot, name));
  const dirWithinRoot = dir === skillsRoot || dir.startsWith(skillsRoot + sep);
  if (!dirWithinRoot || !existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Unknown skill: ${name}`);
  }
  // Re-check containment against realpaths: `dir` itself, or any path segment
  // leading up to it, could be a symlink that lands outside `skillsRoot` even
  // though the lexical (pre-symlink-resolution) path above looked contained.
  const realSkillsRoot = realpathSync(skillsRoot);
  const realDir = realpathSync(dir);
  const dirReallyWithinRoot =
    realDir === realSkillsRoot || realDir.startsWith(realSkillsRoot + sep);
  if (!dirReallyWithinRoot) {
    throw new Error(`Unknown skill: ${name}`);
  }

  const target = resolve(join(dir, file));
  const withinDir = target === dir || target.startsWith(dir + sep);
  if (!withinDir || !existsSync(target)) {
    throw new Error(`Unknown skill file: ${name}/${file}`);
  }
  // Same idea as above: `target` may look lexically contained in `dir` while
  // actually resolving (via a symlinked leaf file OR a symlinked intermediate
  // directory, e.g. `shared/secret.txt` where `shared` is a symlink) to a
  // location outside `realDir`. Comparing realpaths catches both cases.
  const realTarget = realpathSync(target);
  const reallyWithinDir = realTarget === realDir || realTarget.startsWith(realDir + sep);
  if (!reallyWithinDir || !statSync(realTarget).isFile()) {
    throw new Error(`Unknown skill file: ${name}/${file}`);
  }
  return readFileSync(target, 'utf8');
}

export type MinimalResourceServer = {
  registerResource: (
    name: string,
    uri: string,
    config: { title?: string; mimeType?: string },
    readCallback: (
      uri: URL
    ) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>
  ) => unknown;
};

function mimeTypeFor(relPath: string): string {
  if (relPath === '_manifest') return 'application/json';
  if (relPath.endsWith('.md')) return 'text/markdown';
  if (relPath.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

/**
 * Registers each loaded skill's files (plus a `_manifest` resource with sha256 hashes) as
 * MCP resources under `skill://<name>/<relative-path>` URIs, so MCP clients can fetch skill
 * content directly. Content is served via `readSkillFile`, which re-applies path-traversal
 * and symlink-escape protections on every read (the file list here is only used to build URIs).
 */
export function registerSkills(
  server: MinimalResourceServer,
  logger: Pick<Console, 'error'> = console
): LoadedSkill[] {
  const skills = loadSkills(logger);
  for (const skill of skills) {
    // Isolate one skill's resource registration from the rest, mirroring loadSkills' per-skill
    // try/catch above: a single bad skill (e.g. a URI collision from a file literally named
    // `_manifest`, which registerResource rejects as a duplicate) must not crash registration
    // for every other skill, or the whole server, since this runs from createConfiguredServer().
    try {
      for (const relPath of skill.files) {
        const uri = `skill://${skill.name}/${relPath}`;
        const mimeType = mimeTypeFor(relPath);
        server.registerResource(
          `skill-${skill.name}-${relPath}`,
          uri,
          { title: `${skill.name}: ${relPath}`, mimeType },
          async () => ({
            contents: [{ uri, mimeType, text: readSkillFile(skill.name, relPath) }]
          })
        );
      }
      const manifestUri = `skill://${skill.name}/_manifest`;
      server.registerResource(
        `skill-${skill.name}-manifest`,
        manifestUri,
        { title: `${skill.name}: manifest`, mimeType: 'application/json' },
        async () => ({
          contents: [
            {
              uri: manifestUri,
              mimeType: 'application/json',
              text: JSON.stringify(skill.manifest, null, 2)
            }
          ]
        })
      );
    } catch (error) {
      logger.error(`[mcplab-mcp] failed to register resources for skill '${skill.name}':`, error);
    }
  }
  return skills;
}
