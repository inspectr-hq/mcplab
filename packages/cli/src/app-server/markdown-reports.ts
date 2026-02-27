import { basename, extname, relative, resolve, sep } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';

const MAX_REPORT_BYTES = 2 * 1024 * 1024;

type MarkdownReportListItem = {
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
};

export type MarkdownReportsRouteDeps = Pick<AppRouteDeps, 'asJson'>;

export async function handleMarkdownReportsRoutes(params: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppRouteRequestContext['settings'];
  deps: MarkdownReportsRouteDeps;
}): Promise<boolean> {
  const { req, res, pathname, method, settings, deps } = params;
  const { asJson } = deps;

  if (pathname === '/api/markdown-reports' && method === 'GET') {
    const root = resolveReportsRoot(settings);
    const items = listMarkdownFilesRecursive(root, settings.workspaceRoot);
    asJson(res, 200, {
      root,
      exists: safeIsDirectory(root),
      items
    });
    return true;
  }

  if (pathname === '/api/markdown-reports/content' && method === 'GET') {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathParam = String(url.searchParams.get('path') ?? '').trim();
    if (!pathParam) {
      asJson(res, 400, { error: 'path is required' });
      return true;
    }
    const root = resolveReportsRoot(settings);
    let targetPath: string;
    try {
      targetPath = resolveReportPath(root, pathParam);
    } catch (error) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    if (!isMarkdownExt(targetPath)) {
      asJson(res, 400, { error: 'path must point to a .md or .markdown file' });
      return true;
    }

    let st;
    try {
      st = statSync(targetPath);
    } catch {
      asJson(res, 404, { error: 'Report not found' });
      return true;
    }
    if (!st.isFile()) {
      asJson(res, 404, { error: 'Report not found' });
      return true;
    }
    if (st.size > MAX_REPORT_BYTES) {
      asJson(res, 413, { error: `Report exceeds ${MAX_REPORT_BYTES} bytes` });
      return true;
    }

    try {
      const content = readFileSync(targetPath, 'utf8');
      const relativePath = relative(root, targetPath).split(sep).join('/');
      asJson(res, 200, {
        root,
        path: relative(settings.workspaceRoot, targetPath).split(sep).join('/'),
        relativePath,
        name: basename(targetPath),
        sizeBytes: st.size,
        mtime: st.mtime.toISOString(),
        content
      });
    } catch (error) {
      asJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  return false;
}

function resolveReportsRoot(settings: AppRouteRequestContext['settings']): string {
  return resolve(settings.workspaceRoot, 'mcplab/reports');
}

function resolveReportPath(root: string, relativePath: string): string {
  if (!relativePath.trim()) throw new Error('path is required');
  const target = resolve(root, relativePath);
  const withinRoot = target === root || target.startsWith(`${root}${sep}`);
  if (!withinRoot) {
    throw new Error('path escapes reports root');
  }
  return target;
}

function isMarkdownExt(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.md' || ext === '.markdown';
}

function listMarkdownFilesRecursive(root: string, workspaceRoot: string): MarkdownReportListItem[] {
  if (!safeIsDirectory(root)) return [];
  const items: MarkdownReportListItem[] = [];

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isMarkdownExt(fullPath)) continue;
      try {
        const st = statSync(fullPath);
        if (!st.isFile()) continue;
        items.push({
          path: relative(workspaceRoot, fullPath).split(sep).join('/'),
          relativePath: relative(root, fullPath).split(sep).join('/'),
          name: basename(fullPath),
          sizeBytes: st.size,
          mtime: st.mtime.toISOString()
        });
      } catch {
        // Skip unreadable/broken entries in listing.
      }
    }
  };

  walk(root);
  items.sort((a, b) => {
    if (a.mtime === b.mtime) return a.path.localeCompare(b.path);
    return b.mtime.localeCompare(a.mtime);
  });
  return items;
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
