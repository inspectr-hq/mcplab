import { join, resolve } from 'node:path';

export function ensureInsideRoot(rootDir: string, candidatePath: string): string {
  const root = resolve(rootDir);
  const candidate = resolve(candidatePath);
  if (!(candidate === root || candidate.startsWith(`${root}/`))) {
    throw new Error(`Path outside allowed root: ${candidatePath}`);
  }
  return candidate;
}

export function encodeEvalId(absPath: string, rootDir: string): string {
  const rel = absPath.slice(resolve(rootDir).length + 1);
  return Buffer.from(rel, 'utf8').toString('base64url');
}

export function decodeEvalId(id: string, rootDir: string): string {
  const rel = Buffer.from(id, 'base64url').toString('utf8');
  return ensureInsideRoot(rootDir, join(rootDir, rel));
}

export function safeFileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `config-${Date.now()}`
  );
}
