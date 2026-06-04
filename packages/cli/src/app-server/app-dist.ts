import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ResolveAppDistDeps {
  existsSync?: typeof existsSync;
  moduleUrl?: string;
}

export function resolveAppDist(workspaceRoot: string, deps: ResolveAppDistDeps = {}): string {
  const exists = deps.existsSync ?? existsSync;
  const moduleUrl = deps.moduleUrl ?? import.meta.url;
  const repoAppDist = resolve(workspaceRoot, 'packages', 'app', 'dist');
  if (exists(repoAppDist)) return repoAppDist;

  const thisFileDir = dirname(fileURLToPath(moduleUrl));
  return resolve(thisFileDir, '..', 'app');
}
