import { existsSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

function isYamlFile(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml');
}

function toPosixRelative(rootDir: string, absPath: string): string {
  return relative(rootDir, absPath).split(sep).join('/');
}

export function listYamlConfigFilesRecursive(rootDir: string): string[] {
  const resolvedRoot = resolve(rootDir);
  if (!existsSync(resolvedRoot)) return [];
  const stat = statSync(resolvedRoot);
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  const walk = (currentDir: string) => {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const absPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (entry.isFile() && isYamlFile(entry.name)) {
        files.push(absPath);
      }
    }
  };

  walk(resolvedRoot);
  files.sort((a, b) =>
    toPosixRelative(resolvedRoot, a).localeCompare(toPosixRelative(resolvedRoot, b))
  );
  return files;
}

export function resolveRunConfigPaths(configPath: string, cwd = process.cwd()): string[] {
  const resolved = resolve(cwd, configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Config path not found: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory()) {
    throw new Error(`Config path must be a file or directory: ${resolved}`);
  }
  const files = listYamlConfigFilesRecursive(resolved);
  if (files.length === 0) {
    throw new Error(`No .yaml/.yml files found under config directory: ${resolved}`);
  }
  return files;
}

export function deriveConfigRelativePath(configPath: string, rootDir: string): string {
  return toPosixRelative(resolve(rootDir), resolve(configPath));
}

export function deriveSuitePathFromRelativePath(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}
