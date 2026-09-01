import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, ToolDef } from './types.js';
import { createAbortError, isAbortError, throwIfAborted } from './abort.js';
import { resolveConfigValue } from './config-values.js';

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ToolDef['annotations'];
}

export interface McpCallToolOptions {
  requestHeaders?: Record<string, string>;
  signal?: AbortSignal;
}

export interface McpConnectAllOptions {
  serverAuthHeaders?: Record<string, Record<string, string>>;
}

export interface McpImplementationIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: 'light' | 'dark';
}

export interface McpServerImplementation {
  name: string;
  version?: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  icons?: McpImplementationIcon[];
}

export function normalizeListedTool(tool: any): ToolDef {
  const annotations =
    tool.annotations && typeof tool.annotations === 'object' && !Array.isArray(tool.annotations)
      ? (tool.annotations as ToolDef['annotations'])
      : undefined;

  const title =
    typeof tool.title === 'string'
      ? tool.title
      : typeof annotations?.title === 'string'
      ? annotations.title
      : undefined;
  return {
    name: tool.name,
    title: title,
    description: tool.description,
    inputSchema: tool.inputSchema ?? tool.input_schema ?? tool.input,
    outputSchema: tool.outputSchema ?? tool.output_schema,
    annotations
  };
}

export class McpClientManager {
  static onBeforeConnect: (() => void) | undefined;
  private clients = new Map<string, Client>();
  private scopedClients = new Map<string, Client>();
  private scopedClientConnectPromises = new Map<string, Promise<Client>>();
  private servers = new Map<string, ServerConfig>();
  private authHeaders = new Map<string, Record<string, string>>();
  private serverVersions = new Map<string, string | null>();
  private serverImplementations = new Map<string, McpServerImplementation | null>();
  private oauthCache = new Map<string, { token: string; expiresAt: number }>();
  private static readonly MAX_CONNECT_RETRIES = 3;
  private static readonly MAX_SCOPED_CLIENTS = 100;
  private readonly maxScopedClients: number;

  constructor(options?: { maxScopedClients?: number }) {
    const configuredMax = options?.maxScopedClients ?? McpClientManager.MAX_SCOPED_CLIENTS;
    this.maxScopedClients = Math.max(1, configuredMax);
  }

  async connectAll(
    servers: Record<string, ServerConfig>,
    signal?: AbortSignal,
    options?: McpConnectAllOptions
  ): Promise<void> {
    McpClientManager.onBeforeConnect?.();
    throwIfAborted(signal);
    this.servers = new Map(Object.entries(servers));
    this.serverVersions.clear();
    this.serverImplementations.clear();
    for (const [name, server] of Object.entries(servers)) {
      throwIfAborted(signal);
      if (server.transport !== 'http') {
        throw new Error(`Unsupported transport for server ${name}: ${server.transport}`);
      }
      try {
        const authHeadersOverride = options?.serverAuthHeaders?.[name];
        const authHeaders =
          authHeadersOverride && Object.keys(authHeadersOverride).length > 0
            ? mergeRequestHeaders(authHeadersOverride)
            : await this.getAuthHeaders(name, server);
        this.authHeaders.set(name, authHeaders);
        const headers = mergeRequestHeaders(authHeaders, getStaticHeaders(server));
        const client = await this.connectClientWithRetry(
          `mcp-eval-${name}`,
          server,
          headers,
          signal
        );
        this.clients.set(name, client);
        const implementation = client.getServerVersion();
        this.serverVersions.set(name, implementation?.version ?? null);
        this.serverImplementations.set(
          name,
          implementation ? normalizeImplementation(implementation) : null
        );
      } catch (err: any) {
        throw new Error(
          formatMcpError(
            `Failed to connect to MCP server '${name}' after ${McpClientManager.MAX_CONNECT_RETRIES} retries`,
            server.url,
            err
          )
        );
      }
    }
  }

  getClient(serverName: string): Client {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP client not found for server: ${serverName}`);
    }
    return client;
  }

  async listTools(
    serverName: string,
    signal?: AbortSignal,
    requestHeaders?: Record<string, string>
  ): Promise<ToolDef[]> {
    const client =
      requestHeaders && Object.keys(requestHeaders).length > 0
        ? await this.getOrCreateScopedClient(serverName, requestHeaders, signal)
        : this.getClient(serverName);
    let lastError: any;
    for (let attempt = 0; attempt <= McpClientManager.MAX_CONNECT_RETRIES; attempt += 1) {
      try {
        const result: any = await client.listTools(undefined, signal ? { signal } : undefined);
        const tools = Array.isArray(result?.tools)
          ? result.tools
          : Array.isArray(result)
          ? result
          : [];
        return tools.map(normalizeListedTool);
      } catch (err: any) {
        throwIfAborted(signal);
        lastError = err;
        if (attempt >= McpClientManager.MAX_CONNECT_RETRIES) break;
        await sleep(250 * (attempt + 1), signal);
      }
    }
    throw new Error(
      formatMcpError(
        `Failed to list tools for server '${serverName}' after ${McpClientManager.MAX_CONNECT_RETRIES} retries`,
        undefined,
        lastError
      )
    );
  }

  async callTool(
    serverName: string,
    tool: string,
    args: unknown,
    options?: McpCallToolOptions
  ): Promise<any> {
    const callHeaders = options?.requestHeaders;
    const client =
      callHeaders && Object.keys(callHeaders).length > 0
        ? await this.getOrCreateScopedClient(serverName, callHeaders, options?.signal)
        : this.getClient(serverName);
    throwIfAborted(options?.signal);
    try {
      const result = await client.callTool(
        {
          name: tool,
          arguments: args as any
        },
        undefined,
        options?.signal ? { signal: options.signal } : undefined
      );
      return result;
    } catch (err: any) {
      if (options?.signal?.aborted || isAbortError(err)) {
        throw err;
      }
      throw new Error(
        formatMcpError(`Tool call failed '${tool}' on server '${serverName}'`, undefined, err)
      );
    }
  }

  async disconnectAll(): Promise<void> {
    const scopedClientSnapshot = Array.from(this.scopedClients.values());
    const inflightClients = await Promise.allSettled(this.scopedClientConnectPromises.values());
    const connectedInflightClients = inflightClients.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    const clients = [
      ...Array.from(this.clients.values()),
      ...scopedClientSnapshot,
      ...connectedInflightClients
    ];
    this.clients.clear();
    this.scopedClients.clear();
    this.scopedClientConnectPromises.clear();
    this.servers.clear();
    this.authHeaders.clear();
    this.serverVersions.clear();
    this.serverImplementations.clear();
    await Promise.all(
      clients.map(async (client) => {
        try {
          const close = (client as unknown as { close?: () => Promise<void> | void }).close;
          if (typeof close === 'function') {
            await close.call(client);
          }
        } catch {
          // Best-effort shutdown: ignore close errors to avoid masking run results.
        }
      })
    );
  }

  getServerVersions(): Record<string, string | null> {
    return Object.fromEntries(this.serverVersions.entries());
  }

  getServerImplementations(): Record<string, McpServerImplementation | null> {
    return Object.fromEntries(this.serverImplementations.entries());
  }

  private async connectClient(
    clientName: string,
    server: ServerConfig,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Client> {
    const client = new Client({
      name: clientName,
      version: '0.1.0'
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers }
    });
    await client.connect(transport, signal ? { signal } : undefined);
    return client;
  }

  private async connectClientWithRetry(
    clientName: string,
    server: ServerConfig,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Client> {
    let lastError: any;
    for (let attempt = 0; attempt <= McpClientManager.MAX_CONNECT_RETRIES; attempt += 1) {
      try {
        return await this.connectClient(clientName, server, headers, signal);
      } catch (err: any) {
        throwIfAborted(signal);
        lastError = err;
        if (attempt >= McpClientManager.MAX_CONNECT_RETRIES) break;
        await sleep(250 * (attempt + 1), signal);
      }
    }
    throw lastError;
  }

  private async evictIfNeeded(): Promise<void> {
    while (this.scopedClients.size >= this.maxScopedClients) {
      const oldest = this.scopedClients.entries().next();
      if (oldest.done) break;
      const [oldestKey, oldestClient] = oldest.value;
      this.scopedClients.delete(oldestKey);
      try {
        const close = (oldestClient as unknown as { close?: () => Promise<void> | void }).close;
        if (typeof close === 'function') {
          await close.call(oldestClient);
        }
      } catch {
        // Best-effort shutdown: ignore close errors while evicting.
      }
    }
  }

  private async getOrCreateScopedClient(
    serverName: string,
    requestHeaders: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Client> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server config not found for server: ${serverName}`);
    }
    const headers = mergeRequestHeaders(
      this.authHeaders.get(serverName),
      getStaticHeaders(server),
      requestHeaders
    );
    const key = `${serverName}:${serializeHeaders(headers)}`;
    const existing = this.scopedClients.get(key);
    if (existing) {
      // Refresh insertion order so the map acts as an LRU.
      this.scopedClients.delete(key);
      this.scopedClients.set(key, existing);
      return existing;
    }
    const inFlight = this.scopedClientConnectPromises.get(key);
    if (inFlight) return raceWithAbort(inFlight, signal);

    const connectPromise = this.connectClientWithRetry(
      `mcp-eval-${serverName}-scoped`,
      server,
      headers,
      signal
    )
      .then(async (client) => {
        await this.evictIfNeeded();
        this.scopedClients.set(key, client);
        return client;
      })
      .finally(() => {
        this.scopedClientConnectPromises.delete(key);
      });
    this.scopedClientConnectPromises.set(key, connectPromise);
    return raceWithAbort(connectPromise, signal);
  }

  /**
   * Resolve a config value that may contain a ${VAR} env-var reference.
   * - `${FOO}` → reads process.env.FOO
   * - plain string → returned as-is
   * - treatPlainAsEnvVar: legacy mode where plain strings are treated as env var names
   */
  private resolveValue(value: string, label: string, treatPlainAsEnvVar = false): string {
    if (!treatPlainAsEnvVar) return resolveConfigValue(value, label);
    const resolved = process.env[value];
    if (!resolved) {
      throw new Error(`Missing env var '${value}' for ${label}`);
    }
    return resolved;
  }

  private async getAuthHeaders(
    serverName: string,
    server: ServerConfig
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (!server.auth) return headers;

    if (server.auth.type === 'bearer') {
      let resolved: string | undefined;
      if (server.auth.token) {
        resolved = this.resolveValue(server.auth.token, 'bearer token');
      } else if (server.auth.env) {
        // Legacy: env field is always an env var name
        resolved = process.env[server.auth.env];
        if (!resolved) {
          throw new Error(`Missing bearer token env var: ${server.auth.env}`);
        }
      }
      if (!resolved) {
        throw new Error('No bearer token or env var configured');
      }
      headers['Authorization'] = `Bearer ${resolved}`;
      return headers;
    }

    if (server.auth.type === 'api_key') {
      const headerName = server.auth.header_name || 'X-API-Key';
      const resolved = this.resolveValue(server.auth.value, 'API key');
      headers[headerName] = resolved;
      return headers;
    }

    if (server.auth.type === 'oauth_client_credentials') {
      const cached = this.oauthCache.get(serverName);
      if (cached && cached.expiresAt > Date.now() + 30_000) {
        headers['Authorization'] = `Bearer ${cached.token}`;
        return headers;
      }
      const token = await this.fetchOauthToken(serverName, server);
      headers['Authorization'] = `Bearer ${token}`;
      return headers;
    }

    if (server.auth.type === 'oauth_authorization_code') {
      throw new Error(
        `Server '${serverName}' uses OAuth authorization_code metadata. This auth type is intended for OAuth Debugger setup, not automated MCP runtime connections. Use bearer or oauth_client_credentials for runs.`
      );
    }

    return headers;
  }

  private async fetchOauthToken(serverName: string, server: ServerConfig): Promise<string> {
    if (!server.auth || server.auth.type !== 'oauth_client_credentials') {
      throw new Error(`OAuth auth not configured for server '${serverName}'`);
    }
    const clientId = this.resolveValue(server.auth.client_id_env, 'OAuth client_id', true);
    const clientSecret = this.resolveValue(
      server.auth.client_secret_env,
      'OAuth client_secret',
      true
    );

    const params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    if (server.auth.scope) params.set('scope', server.auth.scope);
    if (server.auth.audience) params.set('audience', server.auth.audience);
    if (server.auth.token_params) {
      for (const [key, value] of Object.entries(server.auth.token_params)) {
        params.set(key, value);
      }
    }

    try {
      const response = await fetch(server.auth.token_url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      if (!response.ok) {
        const text = await safeReadText(response);
        throw new Error(`Token request failed: ${response.status} ${response.statusText} ${text}`);
      }
      const data = (await response.json()) as {
        access_token?: string;
        token_type?: string;
        expires_in?: number;
      };
      const accessToken = data.access_token;
      if (!accessToken) {
        throw new Error('Token response missing access_token');
      }
      const ttl = typeof data.expires_in === 'number' ? data.expires_in * 1000 : 60 * 60 * 1000;
      this.oauthCache.set(serverName, { token: accessToken, expiresAt: Date.now() + ttl });
      return accessToken;
    } catch (err: any) {
      throw new Error(
        formatMcpError(
          `Failed to fetch OAuth token for server '${serverName}'`,
          server.auth.token_url,
          err
        )
      );
    }
  }
}

function normalizeImplementation(input: unknown): McpServerImplementation | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  const name = typeof source.name === 'string' ? source.name : '';
  const version = typeof source.version === 'string' ? source.version : '';
  if (!name) return null;
  const normalized: McpServerImplementation = version ? { name, version } : { name };
  if (typeof source.title === 'string' && source.title.trim()) normalized.title = source.title;
  if (typeof source.description === 'string' && source.description.trim()) {
    normalized.description = source.description;
  }
  if (typeof source.websiteUrl === 'string' && source.websiteUrl.trim()) {
    normalized.websiteUrl = source.websiteUrl;
  }
  if (Array.isArray(source.icons)) {
    const icons = source.icons
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => {
        const src = typeof entry.src === 'string' ? entry.src : '';
        if (!src) return null;
        const icon: McpImplementationIcon = { src };
        if (typeof entry.mimeType === 'string' && entry.mimeType.trim())
          icon.mimeType = entry.mimeType;
        if (Array.isArray(entry.sizes)) {
          const sizes = entry.sizes.map((size) => String(size).trim()).filter(Boolean);
          if (sizes.length > 0) icon.sizes = sizes;
        }
        if (entry.theme === 'light' || entry.theme === 'dark') icon.theme = entry.theme;
        return icon;
      })
      .filter((icon): icon is McpImplementationIcon => !!icon);
    if (icons.length > 0) normalized.icons = icons;
  }
  return normalized;
}

function getStaticHeaders(server: ServerConfig): Record<string, string> {
  return server.headers ?? {};
}

export function mergeRequestHeaders(
  ...headerSources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of headerSources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      merged[key.toLowerCase()] = value;
    }
  }
  return merged;
}

function serializeHeaders(headers: Record<string, string>): string {
  const sortedEntries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

function formatMcpError(prefix: string, url: string | undefined, err: any): string {
  const rawMessage = err?.message ?? String(err);
  const message = sanitizeMcpTransportErrorMessage(rawMessage);
  const statusCode = extractHttpStatusCode(err, rawMessage);
  const messageStatusCode = extractHttpStatusCode(undefined, message);
  const hints: string[] = [];
  if (rawMessage.includes('fetch failed')) {
    hints.push('Verify the MCP server is running and reachable.');
    if (url) hints.push(`Check the URL: ${url}`);
    hints.push('If auth is required, confirm the bearer token env var is set.');
  }
  const statusSuffix =
    statusCode && messageStatusCode !== statusCode ? ` (HTTP ${statusCode})` : '';
  const hintText = hints.length > 0 ? ` Hints: ${hints.join(' ')}` : '';
  return `${prefix}. ${ensureSentence(message)}${statusSuffix}${hintText}`;
}

export function sanitizeMcpTransportErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  const htmlLike = /<!doctype html|<html|<\/html>/i.test(normalized);

  if (htmlLike) {
    const titleMatch = normalized.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();
    const hostFromTitle = title?.split('|')[0]?.trim();
    const statusMatch = title?.match(/\b(\d{3})\b/);
    const status = statusMatch?.[1];

    const summaryParts = ['streamable HTTP error'];
    if (hostFromTitle) summaryParts.push(`from ${hostFromTitle}`);
    if (status) summaryParts.push(`(HTTP ${status})`);
    summaryParts.push('upstream returned an HTML error page');
    return summaryParts.join(' ');
  }

  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217)}...`;
}

export function extractHttpStatusCode(err: unknown, message?: string): number | undefined {
  const candidates = [
    (err as { status?: unknown } | undefined)?.status,
    (err as { statusCode?: unknown } | undefined)?.statusCode,
    (err as { response?: { status?: unknown } } | undefined)?.response?.status
  ];
  for (const candidate of candidates) {
    const parsed = toHttpStatusCode(candidate);
    if (parsed) return parsed;
  }

  const text = message ?? '';
  const fromHttpContext = text.match(/\bhttp(?:\s+status)?\s*[:=()-]*\s*(\d{3})\b/i)?.[1];
  if (fromHttpContext) return toHttpStatusCode(fromHttpContext);
  const fromStatusCode = text.match(/\bstatus(?:\s+code)?\s*[:=()-]*\s*(\d{3})\b/i)?.[1];
  if (fromStatusCode) return toHttpStatusCode(fromStatusCode);
  return undefined;
}

function toHttpStatusCode(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isInteger(numeric)) return undefined;
  if (numeric < 100 || numeric > 599) return undefined;
  return numeric;
}

function ensureSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => reject(createAbortError());
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}
