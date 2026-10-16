import { readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

export interface RunDirectorySnapshot {
  runId: string;
  files: Record<string, FileSnapshot>;
}

function resolveRunPath(root: string, runId: string, artifact?: string): string {
  const base = resolve(root);
  const target = resolve(base, runId, artifact ?? '');
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`Invalid run directory path: ${runId}`);
  }
  return target;
}

export function listRunDirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function snapshotRunDirectory(
  root: string,
  runId: string,
  artifacts: readonly string[]
): RunDirectorySnapshot | null {
  const runDir = resolveRunPath(root, runId);
  try {
    if (!statSync(runDir).isDirectory()) return null;
  } catch {
    return null;
  }

  const files: Record<string, FileSnapshot> = {};
  for (const artifact of artifacts) {
    const artifactPath = resolveRunPath(root, runId, artifact);
    try {
      const stat = statSync(artifactPath);
      if (stat.isFile()) files[artifact] = { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // Missing or concurrently replaced files are simply absent from the snapshot.
    }
  }
  return { runId, files };
}

export function snapshotsEqual(
  a: RunDirectorySnapshot | null | undefined,
  b: RunDirectorySnapshot | null | undefined
): boolean {
  if (!a || !b || a.runId !== b.runId) return false;
  const aFiles = Object.keys(a.files).sort();
  const bFiles = Object.keys(b.files).sort();
  if (aFiles.length !== bFiles.length || aFiles.some((file, index) => file !== bFiles[index])) {
    return false;
  }
  return aFiles.every(
    (file) =>
      a.files[file]?.size === b.files[file]?.size &&
      a.files[file]?.mtimeMs === b.files[file]?.mtimeMs
  );
}
