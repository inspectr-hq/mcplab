import { describe, expect, it } from 'vitest';
import { sanitizeMcpTransportErrorMessage } from './mcp.js';

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
