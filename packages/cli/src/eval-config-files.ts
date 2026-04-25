import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
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
  const visitedDirs = new Set<string>();
  const walk = (currentDir: string) => {
    const currentRealPath = realpathSync(currentDir);
    if (visitedDirs.has(currentRealPath)) {
      return;
    }
    visitedDirs.add(currentRealPath);

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (entry.isFile() && isYamlFile(entry.name)) {
        files.push(absPath);
      } else if (entry.isSymbolicLink()) {
        const targetStat = statSync(absPath, { throwIfNoEntry: false });
        if (!targetStat) continue;
        if (targetStat.isDirectory()) {
          // Guard against symlinks that point outside the intended root
          const targetRealPath = realpathSync(absPath);
          if (
            targetRealPath.startsWith(resolvedRoot) &&
            targetRealPath[resolvedRoot.length] === sep
          ) {
            walk(absPath);
          }
        } else if (targetStat.isFile() && isYamlFile(entry.name)) {
          files.push(absPath);
        }
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
  return resolveRunConfigSelection(configPath, cwd).configPaths;
}

export function resolveRunConfigSelection(
  configPath: string,
  cwd = process.cwd()
): { requestedPath: string; requestedPathIsDirectory: boolean; configPaths: string[] } {
  const resolved = resolve(cwd, configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Config path not found: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (stat.isFile()) {
    return { requestedPath: resolved, requestedPathIsDirectory: false, configPaths: [resolved] };
  }
  if (!stat.isDirectory()) {
    throw new Error(`Config path must be a file or directory: ${resolved}`);
  }
  const files = listYamlConfigFilesRecursive(resolved);
  if (files.length === 0) {
    throw new Error(`No .yaml/.yml files found under config directory: ${resolved}`);
  }
  return { requestedPath: resolved, requestedPathIsDirectory: true, configPaths: files };
}

export function deriveConfigRelativePath(configPath: string, rootDir: string): string {
  return toPosixRelative(resolve(rootDir), resolve(configPath));
}

export function deriveSuitePathFromRelativePath(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}
