import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import {
  handleMcplabMcpHttpRequest,
  type SessionRuntime
} from '../../packages/mcp-server/src/runtime.js';

export interface ManualMcpServerOptions {
  host: string;
  port: number;
  mcpPath: string;
  name: string;
  beforeMcp?: (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    url: URL
  ) => Promise<boolean> | boolean;
  onRoot?: (req: IncomingMessage, res: ServerResponse) => void;
}

export function envServerOptions(defaultPort: number, defaultName: string): ManualMcpServerOptions {
  return {
    host: process.env.MCP_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.MCP_PORT ?? String(defaultPort), 10),
    mcpPath: process.env.MCP_PATH || '/mcp',
    name: defaultName
  };
}

export async function startManualMcpServer(options: ManualMcpServerOptions): Promise<{
  close(): Promise<void>;
  url: string;
}> {
  const sessions = new Map<string, SessionRuntime>();
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/' && req.method === 'GET') {
      if (options.onRoot) {
        options.onRoot(req, res);
        return;
      }
      sendJson(res, 200, {
        name: options.name,
        transport: 'streamable-http',
        mcp_endpoint: options.mcpPath
      });
      return;
    }

    if (options.beforeMcp && (await options.beforeMcp(req, res, pathname, url))) {
      return;
    }

    if (pathname === options.mcpPath) {
      await handleMcplabMcpHttpRequest(req, res, sessions, { path: options.mcpPath });
      return;
    }

    sendText(res, 404, 'Not Found');
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address() as AddressInfo;
  const base = `http://${addr.address}:${addr.port}`;
  // eslint-disable-next-line no-console
  console.log(`[${options.name}] listening on ${base}${options.mcpPath}`);

  return {
    url: base,
    async close() {
      for (const runtime of sessions.values()) {
        try {
          await runtime.transport.close();
          await runtime.server.close();
        } catch {
          // ignore shutdown errors
        }
      }
      sessions.clear();
      await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()));
    }
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', Buffer.byteLength(text));
  res.end(text);
}

export function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function requireBearer(
  req: IncomingMessage,
  res: ServerResponse,
  expectedToken: string
): boolean {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${expectedToken}`) {
    res.statusCode = 401;
    res.setHeader('www-authenticate', 'Bearer realm="mcplab-test"');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  return true;
}
