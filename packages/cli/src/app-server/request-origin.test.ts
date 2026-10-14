import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { allowedRequestOrigin, applyRequestOriginPolicy } from './request-origin.js';

function request(headers: Record<string, string>, encrypted = false) {
  return {
    headers,
    socket: { encrypted }
  } as unknown as IncomingMessage;
}

function response() {
  return Object.assign(new EventEmitter(), { setHeader: vi.fn() }) as unknown as ServerResponse;
}

describe('central browser origin policy', () => {
  it('accepts a public Host name instead of comparing the local socket address', () => {
    expect(
      allowedRequestOrigin(
        request({ host: 'devbox.local:8787', origin: 'http://devbox.local:8787' })
      )
    ).toBe('http://devbox.local:8787');
  });

  it('supports forwarded HTTPS hosts behind a TLS proxy', () => {
    expect(
      allowedRequestOrigin(
        request({
          host: 'mcplab:8787',
          origin: 'https://mcplab.example',
          'x-forwarded-host': 'mcplab.example',
          'x-forwarded-proto': 'https'
        })
      )
    ).toBe('https://mcplab.example');
  });

  it('allows only the same-host local Vite development origin', () => {
    expect(
      allowedRequestOrigin(
        request({ host: 'devbox.local:8787', origin: 'http://devbox.local:8685' })
      )
    ).toBe('http://devbox.local:8685');
    expect(
      allowedRequestOrigin(
        request({ host: 'devbox.local:8787', origin: 'http://devbox.local:8686' })
      )
    ).toBeNull();
    expect(
      allowedRequestOrigin(request({ host: '127.0.0.1:8787', origin: 'http://localhost:8685' }))
    ).toBe('http://localhost:8685');
  });

  it('rejects other websites and never grants wildcard CORS', () => {
    const req = request({ host: 'localhost:8787', origin: 'https://attacker.example' });
    const res = response();
    expect(applyRequestOriginPolicy(req, res)).toBe(false);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('reflects only the validated origin for cross-port development requests', () => {
    const req = request({ host: 'localhost:8787', origin: 'http://localhost:8685' });
    const res = response();
    expect(applyRequestOriginPolicy(req, res)).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://localhost:8685'
    );
    expect(res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
  });
});
