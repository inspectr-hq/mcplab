import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  McpClientManager,
  extractHttpStatusCode,
  mergeRequestHeaders,
  normalizeListedTool,
  sanitizeMcpTransportErrorMessage
} from './mcp.js';
import type { ServerConfig } from './types.js';

describe('sanitizeMcpTransportErrorMessage', () => {
  it('condenses HTML upstream failures into a short summary', () => {
    const raw =
      'Streamable HTTP error: Error POSTing to endpoint: <!DOCTYPE html><html><head><title>in-spectr.dev | 502: Bad gateway</title></head><body>very long cloudflare page...</body></html>';

    const sanitized = sanitizeMcpTransportErrorMessage(raw);

    expect(sanitized).toContain('streamable HTTP error');
    expect(sanitized).toContain('in-spectr.dev');
    expect(sanitized).toContain('502');
    expect(sanitized).not.toContain('<!DOCTYPE html>');
    expect(sanitized.length).toBeLessThan(220);
  });
});

describe('extractHttpStatusCode', () => {
  it('extracts status from common error object fields', () => {
    expect(extractHttpStatusCode({ status: 429 })).toBe(429);
    expect(extractHttpStatusCode({ statusCode: '503' })).toBe(503);
    expect(extractHttpStatusCode({ response: { status: 401 } })).toBe(401);
  });

  it('falls back to parsing status code from error message', () => {
    expect(extractHttpStatusCode({}, 'Streamable HTTP error (HTTP 502)')).toBe(502);
  });

  it('does not infer status code from unrelated 3-digit numbers', () => {
    expect(extractHttpStatusCode({}, 'failed at line 404 of config')).toBeUndefined();
    expect(extractHttpStatusCode({}, 'retried 503 times')).toBeUndefined();
  });

  it('ignores non-http numeric values', () => {
    expect(extractHttpStatusCode({ status: 42 })).toBeUndefined();
    expect(extractHttpStatusCode({ statusCode: '999' })).toBeUndefined();
  });
});

describe('mergeRequestHeaders', () => {
  it('merges headers with later sources taking precedence', () => {
    const merged = mergeRequestHeaders(
      { authorization: 'Bearer abc', 'x-request-id': 'auth-id' },
      { 'x-request-id': 'static-id', 'x-env': 'prod' },
      { 'x-request-id': 'runtime-id' }
    );

    expect(merged).toEqual({
      authorization: 'Bearer abc',
      'x-request-id': 'runtime-id',
      'x-env': 'prod'
    });
  });

  it('ignores undefined header sources', () => {
    const merged = mergeRequestHeaders(undefined, { 'x-request-id': 'runtime-id' }, undefined);
    expect(merged).toEqual({ 'x-request-id': 'runtime-id' });
  });

  it('normalizes keys to lowercase and applies precedence case-insensitively', () => {
    const merged = mergeRequestHeaders(
      { Authorization: 'Bearer auth' },
      { authorization: 'Bearer static' },
      { AUTHORIZATION: 'Bearer runtime' }
    );
    expect(merged).toEqual({ authorization: 'Bearer runtime' });
  });
});

describe('normalizeListedTool', () => {
  it('maps outputSchema and snake_case schema fields from MCP listTools payload', () => {
    const normalized = normalizeListedTool({
      name: 'get_user_profile',
      title: 'Get User Profile',
      description: 'Get user profile',
      input_schema: {
        type: 'object',
        properties: { userId: { type: 'string' } }
      },
      output_schema: {
        type: 'object',
        properties: { name: { type: 'string' } }
      }
    });

    expect(normalized).toEqual({
      name: 'get_user_profile',
      title: 'Get User Profile',
      description: 'Get user profile',
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'string' } }
      },
      outputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } }
      }
    });
  });

  it('maps a valid annotations object', () => {
    const normalized = normalizeListedTool({
      name: 'get_data',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    });
    expect(normalized.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    });
  });

  it('uses annotations.title as fallback when top-level title is missing', () => {
    const normalized = normalizeListedTool({
      name: 'create_rule',
      annotations: { title: 'Create Rule' }
    });
    expect(normalized.title).toBe('Create Rule');
  });

  it('prefers top-level title over annotations.title', () => {
    const normalized = normalizeListedTool({
      name: 'create_rule',
      title: 'Top Level',
      annotations: { title: 'Annotation Level' }
    });
    expect(normalized.title).toBe('Top Level');
  });

  it('treats array annotations as absent — array passes typeof object but is not a valid annotations object', () => {
    const normalized = normalizeListedTool({
      name: 'get_data',
      annotations: []
    });
    expect(normalized.annotations).toBeUndefined();
  });
});

describe('McpClientManager.getRequestHeadersForServers', () => {
  const oauthServer = {
    transport: 'http' as const,
    url: 'https://example.test/mcp',
    auth: {
      type: 'oauth_client_credentials' as const,
      token_url: 'https://example.test/token',
      client_id_env: 'TEST_CLIENT_ID',
      client_secret_env: 'TEST_CLIENT_SECRET'
    }
  };

  beforeEach(() => {
    process.env.TEST_CLIENT_ID = 'client-id';
    process.env.TEST_CLIENT_SECRET = 'client-secret';
  });

  afterEach(() => {
    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
    vi.unstubAllGlobals();
  });

  it('fetches a fresh token for oauth_client_credentials servers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'first-token', expires_in: 3600 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new McpClientManager();
    (manager as any).servers = new Map([['oauth-api', oauthServer]]);

    const headers = await manager.getRequestHeadersForServers(['oauth-api']);

    expect(headers).toEqual({ 'oauth-api': { Authorization: 'Bearer first-token' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached token instead of refetching before it nears expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'cached-token', expires_in: 3600 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new McpClientManager();
    (manager as any).servers = new Map([['oauth-api', oauthServer]]);

    await manager.getRequestHeadersForServers(['oauth-api']);
    const headers = await manager.getRequestHeadersForServers(['oauth-api']);

    expect(headers).toEqual({ 'oauth-api': { Authorization: 'Bearer cached-token' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cached token is within the expiry skew', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'expiring-token', expires_in: 20 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'renewed-token', expires_in: 3600 })
      });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new McpClientManager();
    (manager as any).servers = new Map([['oauth-api', oauthServer]]);

    await manager.getRequestHeadersForServers(['oauth-api']);
    const headers = await manager.getRequestHeadersForServers(['oauth-api']);

    expect(headers).toEqual({ 'oauth-api': { Authorization: 'Bearer renewed-token' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-flight token refresh when the run is cancelled', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (!init?.signal) {
          reject(new Error('Token fetch did not receive the abort signal'));
          return;
        }
        init.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })),
          { once: true }
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new McpClientManager();
    (manager as any).servers = new Map([['oauth-api', oauthServer]]);

    const headersPromise = manager.getRequestHeadersForServers(['oauth-api'], controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(headersPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('omits servers with static or no auth, and skips fetching for them', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const manager = new McpClientManager();
    (manager as any).servers = new Map<string, ServerConfig>([
      ['oauth-api', oauthServer],
      [
        'bearer-api',
        { transport: 'http', url: 'https://b.test/mcp', auth: { type: 'bearer', token: 'static' } }
      ],
      ['open-api', { transport: 'http', url: 'https://o.test/mcp' }]
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'token', expires_in: 3600 })
    });

    const headers = await manager.getRequestHeadersForServers([
      'oauth-api',
      'bearer-api',
      'open-api'
    ]);

    expect(Object.keys(headers)).toEqual(['oauth-api']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('McpClientManager.listTools', () => {
  it('uses a scoped client when request headers are provided', async () => {
    const manager = new McpClientManager();
    const scopedListTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'search_tags', description: 'Search tags' }]
    });
    const baseListTools = vi.fn();

    vi.spyOn(manager as any, 'getOrCreateScopedClient').mockResolvedValue({
      listTools: scopedListTools
    });
    vi.spyOn(manager as any, 'getClient').mockReturnValue({
      listTools: baseListTools
    });

    const tools = await manager.listTools('oauth-server', undefined, {
      authorization: 'Bearer refreshed-token'
    });

    expect(tools).toEqual([
      {
        name: 'search_tags',
        title: undefined,
        description: 'Search tags',
        inputSchema: undefined,
        outputSchema: undefined,
        annotations: undefined
      }
    ]);
    expect((manager as any).getOrCreateScopedClient).toHaveBeenCalledWith(
      'oauth-server',
      { authorization: 'Bearer refreshed-token' },
      undefined
    );
    expect(baseListTools).not.toHaveBeenCalled();
  });
});
