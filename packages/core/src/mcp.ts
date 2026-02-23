import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, ToolDef } from './types.js';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private oauthCache = new Map<string, { token: string; expiresAt: number }>();
  private static readonly MAX_CONNECT_RETRIES = 3;

  async connectAll(servers: Record<string, ServerConfig>, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    for (const [name, server] of Object.entries(servers)) {
      throwIfAborted(signal);
      if (server.transport !== 'http') {
        throw new Error(`Unsupported transport for server ${name}: ${server.transport}`);
      }
      let lastError: any;
      for (let attempt = 0; attempt <= McpClientManager.MAX_CONNECT_RETRIES; attempt += 1) {
        try {
          const client = new Client({
            name: `mcp-eval-${name}`,
            version: '0.1.0'
          });
          const headers = await this.getAuthHeaders(name, server);
          const transport = new StreamableHTTPClientTransport(new URL(server.url), {
            requestInit: { headers }
          });
          await client.connect(transport);
          this.clients.set(name, client);
          lastError = undefined;
          break;
        } catch (err: any) {
          throwIfAborted(signal);
          lastError = err;
          if (attempt >= McpClientManager.MAX_CONNECT_RETRIES) break;
          await sleep(250 * (attempt + 1), signal);
        }
      }
      if (lastError) {
        throw new Error(
          formatMcpError(
            `Failed to connect to MCP server '${name}' after ${McpClientManager.MAX_CONNECT_RETRIES} retries`,
            server.url,
            lastError
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

  async listTools(serverName: string): Promise<ToolDef[]> {
    const client = this.getClient(serverName);
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
      throw new Error(
        formatMcpError(`Failed to list tools for server '${serverName}'`, undefined, err)
      );
    }
  }

  async callTool(serverName: string, tool: string, args: unknown): Promise<any> {
    const client = this.getClient(serverName);
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

  private async getAuthHeaders(
    serverName: string,
    server: ServerConfig
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (!server.auth) return headers;

    if (server.auth.type === 'bearer') {
      const token = process.env[server.auth.env];
      if (!token) {
        throw new Error(`Missing bearer token env var: ${server.auth.env}`);
      }
      headers['Authorization'] = `Bearer ${token}`;
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
    const clientId = process.env[server.auth.client_id_env];
    const clientSecret = process.env[server.auth.client_secret_env];
    if (!clientId) {
      throw new Error(`Missing OAuth client id env var: ${server.auth.client_id_env}`);
    }
    if (!clientSecret) {
      throw new Error(`Missing OAuth client secret env var: ${server.auth.client_secret_env}`);
    }

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

function formatMcpError(prefix: string, url: string | undefined, err: any): string {
  const message = err?.message ?? String(err);
  const hints: string[] = [];
  if (message.includes('fetch failed')) {
    hints.push('Verify the MCP server is running and reachable.');
    if (url) hints.push(`Check the URL: ${url}`);
    hints.push('If auth is required, confirm the bearer token env var is set.');
  }
  const hintText = hints.length > 0 ? ` Hints: ${hints.join(' ')}` : '';
  return `${prefix}. ${message}.${hintText}`;
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
