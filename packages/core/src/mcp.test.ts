import { describe, expect, it, vi } from 'vitest';
import {
  McpClientManager,
  extractHttpStatusCode,
  mergeRequestHeaders,
  normalizeListedTool,
  sanitizeMcpTransportErrorMessage
} from './mcp.js';

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
