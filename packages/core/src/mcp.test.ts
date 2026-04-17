import { describe, expect, it } from 'vitest';
import {
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
      annotations: { readOnlyHint: true, destructiveHint: false }
    });
    expect(normalized.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });

  it('treats array annotations as absent — array passes typeof object but is not a valid annotations object', () => {
    const normalized = normalizeListedTool({
      name: 'get_data',
      annotations: []
    });
    expect(normalized.annotations).toBeUndefined();
  });
});
