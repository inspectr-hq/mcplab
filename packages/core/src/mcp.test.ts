import { describe, expect, it } from 'vitest';
import { mergeRequestHeaders, sanitizeMcpTransportErrorMessage } from './mcp.js';

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
});
