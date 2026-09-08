import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn as defaultSpawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { McpRequestHeaderContext } from '@inspectr/mcplab-core';

export interface InspectrProxySession {
  upstreamOrigin: string;
  proxyOrigin: string;
  dashboardUrl: string;
}

export function buildInspectrRequestHeaders(
  context: McpRequestHeaderContext
): Record<string, string> {
  const tags = [
    'mcplab',
    `mcplab-run:${tagPart(context.runId)}`,
    ...(context.scenarioId ? [`mcplab-scenario:${tagPart(context.scenarioId)}`] : []),
    ...(context.agentName ? [`mcplab-agent:${tagPart(context.agentName)}`] : []),
    `mcplab-server:${tagPart(context.serverName)}`
  ];
  return {
    'inspectr-tag': tags.join(', '),
    'inspectr-trace-id': context.requestId ?? `mcplab-run:${tagPart(context.runId)}`
  };
}

interface InspectrChild {
  kill(signal?: NodeJS.Signals): boolean;
  once(event: string, listener: (...args: any[]) => void): this;
}

interface InspectrSessionManagerOptions {
  storageRoot: string;
  commandPath?: string;
  allocatePort?: () => Promise<number>;
  spawn?: (
    command: string,
    args: string[],
    options: { cwd: string; stdio: ['ignore', 'ignore', 'ignore'] }
  ) => InspectrChild;
  waitForReady?: (session: InspectrProxySession, child: InspectrChild) => Promise<void>;
}

type ManagedSession = InspectrProxySession & { child: InspectrChild; cwd: string };

export class InspectrSessionManager {
  private readonly storageRoot: string;
  private readonly commandPath: string;
  private readonly allocatePort: () => Promise<number>;
  private readonly spawn: NonNullable<InspectrSessionManagerOptions['spawn']>;
  private readonly waitForReady: NonNullable<InspectrSessionManagerOptions['waitForReady']>;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly starting = new Map<string, Promise<ManagedSession>>();

  constructor(options: InspectrSessionManagerOptions) {
    this.storageRoot = options.storageRoot;
    this.commandPath = options.commandPath ?? resolveInspectrCommand();
    this.allocatePort = options.allocatePort ?? allocateFreePort;
    this.spawn = options.spawn ?? ((command, args, spawnOptions) => defaultSpawn(command, args, spawnOptions));
    this.waitForReady = options.waitForReady ?? waitForPorts;
  }

  async acquire(serverUrl: string): Promise<InspectrProxySession> {
    const upstreamOrigin = normalizeOrigin(serverUrl);
    const existing = this.sessions.get(upstreamOrigin);
    if (existing) return existing;
    const inFlight = this.starting.get(upstreamOrigin);
    if (inFlight) return inFlight;

    const promise = this.start(upstreamOrigin).finally(() => {
      this.starting.delete(upstreamOrigin);
    });
    this.starting.set(upstreamOrigin, promise);
    return promise;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.starting.values());
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => stopChild(session.child)));
  }

  private async start(upstreamOrigin: string): Promise<ManagedSession> {
    const proxyPort = await this.allocatePort();
    const dashboardPort = await this.allocatePort();
    const cwd = join(this.storageRoot, originKey(upstreamOrigin));
    mkdirSync(cwd, { recursive: true });
    const channel = `mcplab-${originKey(upstreamOrigin)}`;
    const channelCode = randomBytes(16).toString('hex');
    const dashboardUrl = new URL(`http://127.0.0.1:${dashboardPort}`);
    dashboardUrl.searchParams.set('channel', channel);
    dashboardUrl.searchParams.set('channelCode', channelCode);
    const session: InspectrProxySession = {
      upstreamOrigin,
      proxyOrigin: `http://127.0.0.1:${proxyPort}`,
      dashboardUrl: dashboardUrl.toString()
    };
    const child = this.spawn(
      this.commandPath,
      [
        `--listen=127.0.0.1:${proxyPort}`,
        `--app-port=${dashboardPort}`,
        `--backend=${upstreamOrigin}`,
        `--channel=${channel}`,
        `--channel-code=${channelCode}`,
        '--print=false'
      ],
      { cwd, stdio: ['ignore', 'ignore', 'ignore'] }
    );
    try {
      await this.waitForReady(session, child);
    } catch (error) {
      await stopChild(child);
      throw new Error(
        `Inspectr failed to start for ${upstreamOrigin}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const managed = session as ManagedSession;
    Object.defineProperties(managed, {
      child: { value: child, enumerable: false },
      cwd: { value: cwd, enumerable: false }
    });
    this.sessions.set(upstreamOrigin, managed);
    child.once('exit', () => {
      if (this.sessions.get(upstreamOrigin) === managed) this.sessions.delete(upstreamOrigin);
    });
    return managed;
  }
}

function resolveInspectrCommand(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@inspectr/inspectr/package.json');
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.inspectr;
  if (!bin) throw new Error('Installed @inspectr/inspectr package has no inspectr executable');
  const packageBin = join(dirname(packageJsonPath), bin);
  return existsSync(packageBin) ? packageBin : 'inspectr';
}

function normalizeOrigin(serverUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error(`Inspectr requires an absolute MCP server URL: ${serverUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Inspectr supports HTTP MCP server URLs only: ${serverUrl}`);
  }
  return parsed.origin;
}

export function rewriteUrlThroughInspectr(serverUrl: string, proxyOrigin: string): string {
  const original = new URL(serverUrl);
  return new URL(`${original.pathname}${original.search}`, proxyOrigin).toString();
}

function originKey(origin: string): string {
  return createHash('sha256').update(origin).digest('hex').slice(0, 16);
}

function tagPart(value: string): string {
  return value.trim().replace(/[\u0000-\u001f\u007f,]+/g, '_').slice(0, 120) || 'unknown';
}

async function allocateFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error('Could not allocate a local Inspectr port');
  return port;
}

async function waitForPorts(session: InspectrProxySession, child: InspectrChild): Promise<void> {
  const ports = [new URL(session.proxyOrigin).port, new URL(session.dashboardUrl).port].map(Number);
  let childExited = false;
  const markExited = () => {
    childExited = true;
  };
  child.once('error', markExited);
  child.once('exit', markExited);
  const deadline = Date.now() + 15_000;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    if (childExited) throw new Error('Inspectr process exited during startup');
    if (await Promise.all(ports.map(canConnect))) {
      stableChecks += 1;
      if (stableChecks >= 2 && (await hasDashboardConfig(session.dashboardUrl))) return;
    } else {
      stableChecks = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for Inspectr proxy and dashboard');
}

async function hasDashboardConfig(dashboardUrl: string): Promise<boolean> {
  try {
    const configUrl = new URL('/app/config', dashboardUrl);
    const response = await fetch(configUrl, {
      signal: AbortSignal.timeout(1_000)
    });
    if (!response.ok) return false;
    const config = (await response.json()) as {
      token?: unknown;
      channel_code?: unknown;
      sse_endpoint?: unknown;
    };
    return Boolean(config.token && config.channel_code && config.sse_endpoint);
  } catch {
    return false;
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function stopChild(child: InspectrChild): Promise<void> {
  child.kill('SIGTERM');
}
