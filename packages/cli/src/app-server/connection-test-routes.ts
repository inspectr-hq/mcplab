import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { testAgentConnection, testDecisionConnection } from '@inspectr/mcplab-core';
import { asJson, parseBody } from './http.js';

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    (isIP(host) === 4 && host.startsWith('127.')) ||
    (isIP(host) === 6 && host === '::1')
  );
}

function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || !req.headers.host) return false;
  try {
    const parsed = new URL(origin);
    const forwardedHeader = req.headers['x-forwarded-proto'];
    const forwardedProtocol = (
      Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader
    )
      ?.split(',')[0]
      ?.trim();
    const protocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : (req.socket as TLSSocket).encrypted
        ? 'https:'
        : 'http:';
    const localAddress = req.socket.localAddress?.replace(/^::ffff:/, '');
    const localPort = req.socket.localPort;
    const originHost = parsed.hostname.replace(/^\[|\]$/g, '');
    const localHost = localAddress?.replace(/^\[|\]$/g, '');
    const defaultPort = parsed.protocol === 'https:' ? 443 : 80;
    const originPort = parsed.port ? Number(parsed.port) : defaultPort;
    const isLocalHost =
      Boolean(localHost) &&
      (originHost === localHost ||
        (isLoopbackHostname(originHost) && isLoopbackHostname(localHost!)));
    return (
      !parsed.username &&
      !parsed.password &&
      parsed.origin === origin &&
      ((parsed.protocol === protocol && isLocalHost && originPort === localPort) ||
        (parsed.protocol === 'http:' &&
          parsed.port === '8685' &&
          isLoopbackHostname(parsed.hostname) &&
          isLoopbackHostname(localHost ?? '')))
    );
  } catch {
    return false;
  }
}

export async function handleConnectionTestRoutes({
  req,
  res,
  pathname,
  method
}: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
}): Promise<boolean> {
  if (method !== 'POST') return false;
  const probes = {
    '/api/settings/decision/test': testDecisionConnection,
    '/api/agents/test': testAgentConnection
  };
  if (!Object.hasOwn(probes, pathname)) return false;
  if (!isSameOriginRequest(req)) {
    asJson(res, 403, { error: 'Cross-origin request rejected.' });
    return true;
  }
  const probe = probes[pathname as keyof typeof probes];
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);
  try {
    const result = await probe(await parseBody(req), controller.signal);
    if (!controller.signal.aborted) asJson(res, 200, result);
  } catch (error: unknown) {
    if (!controller.signal.aborted) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    res.off('close', onClose);
  }
  return true;
}
