import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || (isIP(host) === 4 && host.startsWith('127.')) || host === '::1';
}

/** Return the browser origin when it matches the public MCPLab origin. */
export function allowedRequestOrigin(req: IncomingMessage): string | undefined | null {
  const origin = req.headers.origin;
  if (origin === undefined) return undefined;
  if (typeof origin !== 'string') return null;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) return null;
    const forwardedProto = firstHeader(req.headers['x-forwarded-proto']);
    const forwardedHost = firstHeader(req.headers['x-forwarded-host']);
    const protocol = forwardedProto
      ? `${forwardedProto.toLowerCase()}:`
      : (req.socket as TLSSocket).encrypted
        ? 'https:'
        : 'http:';
    const host = forwardedHost ?? req.headers.host;
    if (!host) return null;
    const publicUrl = new URL(`${protocol}//${host}`);
    if (parsed.origin === publicUrl.origin) return origin;

    // The app's Vite development UI runs on 8685 and calls the backend on 8787.
    // Keep this limited to the same hostname and development port.
    if (
      protocol === 'http:' &&
      parsed.protocol === 'http:' &&
      (parsed.hostname.toLowerCase() === publicUrl.hostname.toLowerCase() ||
        (isLoopbackHostname(parsed.hostname) && isLoopbackHostname(publicUrl.hostname))) &&
      parsed.port === '8685'
    ) {
      return origin;
    }
    return null;
  } catch {
    return null;
  }
}

/** Apply a restricted CORS policy and report whether a browser origin is trusted. */
export function applyRequestOriginPolicy(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = allowedRequestOrigin(req);
  if (origin === null) return false;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, MCP-Session-Id, Last-Event-ID, Accept'
    );
  }
  return true;
}
