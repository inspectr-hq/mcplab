import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export function mapContentType(pathname: string): string {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

export async function proxyToVite(
  req: IncomingMessage,
  res: ServerResponse,
  target: string,
  pathname: string,
  search: string
) {
  const url = `${target}${pathname}${search}`;
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    } else {
      headers.set(key, value);
    }
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : req;
  const response = await fetch(url, { method, headers, body: body as any, duplex: 'half' } as any);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body as any) {
    res.write(chunk);
  }
  res.end();
}

export function serveStatic(params: {
  appDist: string;
  pathname: string;
  res: ServerResponse;
  ensureInsideRoot: (rootDir: string, candidatePath: string) => string;
  asText: (res: ServerResponse, code: number, body: string) => void;
}) {
  const { appDist, pathname, res, ensureInsideRoot, asText } = params;
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const requested = ensureInsideRoot(appDist, join(appDist, cleanPath));
  const filePath =
    existsSync(requested) && statSync(requested).isFile()
      ? requested
      : ensureInsideRoot(appDist, join(appDist, 'index.html'));
  if (!existsSync(filePath)) {
    asText(
      res,
      500,
      `Missing app build at ${appDist}. Run "npm run build -w @inspectr/mcplab-app".`
    );
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', mapContentType(filePath));
  createReadStream(filePath).pipe(res);
}
