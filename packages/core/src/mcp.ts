import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, ToolDef } from './types.js';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallToolOptions {
  requestHeaders?: Record<string, string>;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private scopedClients = new Map<string, Client>();
  private scopedClientConnectPromises = new Map<string, Promise<Client>>();
  private servers = new Map<string, ServerConfig>();
  private authHeaders = new Map<string, Record<string, string>>();
  private oauthCache = new Map<string, { token: string; expiresAt: number }>();
  private static readonly MAX_CONNECT_RETRIES = 3;
  private static readonly MAX_SCOPED_CLIENTS = 100;
  private readonly maxScopedClients: number;

  constructor(options?: { maxScopedClients?: number }) {
    const configuredMax = options?.maxScopedClients ?? McpClientManager.MAX_SCOPED_CLIENTS;
    this.maxScopedClients = Math.max(1, configuredMax);
  }

  async connectAll(servers: Record<string, ServerConfig>, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.servers = new Map(Object.entries(servers));
    for (const [name, server] of Object.entries(servers)) {
      throwIfAborted(signal);
      if (server.transport !== 'http') {
        throw new Error(`Unsupported transport for server ${name}: ${server.transport}`);
      }
      try {
        const authHeaders = await this.getAuthHeaders(name, server);
        this.authHeaders.set(name, authHeaders);
        const headers = mergeRequestHeaders(authHeaders, getStaticHeaders(server));
        const client = await this.connectClientWithRetry(
          `mcp-eval-${name}`,
          server,
          headers,
          signal
        );
        this.clients.set(name, client);
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

  async listTools(serverName: string, signal?: AbortSignal): Promise<ToolDef[]> {
    const client = this.getClient(serverName);
    let lastError: any;
    for (let attempt = 0; attempt <= McpClientManager.MAX_CONNECT_RETRIES; attempt += 1) {
      try {
        const result: any = await client.listTools();
        const tools = Array.isArray(result?.tools)
          ? result.tools
          : Array.isArray(result)
          ? result
          : [];
        return tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? tool.input_schema ?? tool.input
        }));
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
        ? await this.getOrCreateScopedClient(serverName, callHeaders)
        : this.getClient(serverName);
    try {
      const result = await client.callTool({
        name: tool,
        arguments: args as any
      });
      return result;
    } catch (err: any) {
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

  private async connectClient(
    clientName: string,
    server: ServerConfig,
    headers: Record<string, string>
  ): Promise<Client> {
    const client = new Client({
      name: clientName,
      version: '0.1.0'
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers }
    });
    await client.connect(transport);
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
        return await this.connectClient(clientName, server, headers);
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
    requestHeaders: Record<string, string>
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
    if (inFlight) return inFlight;

    const connectPromise = this.connectClientWithRetry(
      `mcp-eval-${serverName}-scoped`,
      server,
      headers
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
    return connectPromise;
  }

  /**
   * Resolve a config value that may contain a ${VAR} env-var reference.
   * - `${FOO}` → reads process.env.FOO
   * - plain string → returned as-is
   * - treatPlainAsEnvVar: legacy mode where plain strings are treated as env var names
   */
  private resolveValue(value: string, label: string, treatPlainAsEnvVar = false): string {
    const envMatch = value.match(/^\$\{(.+)\}$/);
    if (envMatch) {
      const resolved = process.env[envMatch[1]];
      if (!resolved) {
        throw new Error(`Missing env var '${envMatch[1]}' for ${label}`);
      }
      return resolved;
    }
    if (treatPlainAsEnvVar) {
      const resolved = process.env[value];
      if (!resolved) {
        throw new Error(`Missing env var '${value}' for ${label}`);
      }
      return resolved;
    }
    return value;
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
    const clientSecret = this.resolveValue(server.auth.client_secret_env, 'OAuth client_secret', true);

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
  const hints: string[] = [];
  if (rawMessage.includes('fetch failed')) {
    hints.push('Verify the MCP server is running and reachable.');
    if (url) hints.push(`Check the URL: ${url}`);
    hints.push('If auth is required, confirm the bearer token env var is set.');
  }
  const hintText = hints.length > 0 ? ` Hints: ${hints.join(' ')}` : '';
  return `${prefix}. ${message}.${hintText}`;
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
      reject(new Error('Run aborted by user'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Run aborted by user');
  }
}
