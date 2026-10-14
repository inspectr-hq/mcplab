import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { probe, agentProbe } = vi.hoisted(() => ({ probe: vi.fn(), agentProbe: vi.fn() }));
vi.mock('@inspectr/mcplab-core', async (original) => ({
  ...(await original<typeof import('@inspectr/mcplab-core')>()),
  testDecisionConnection: probe,
  testAgentConnection: agentProbe
}));
import { handleConnectionTestRoutes } from './connection-test-routes.js';

const config = { provider: 'openai', model: 'gpt-6-luna', passThreshold: 0.9, failThreshold: 0.1 };
const result = {
  ok: true,
  message: 'Connection succeeded.',
  provider: 'openai',
  requestedModel: config.model,
  probability: 0.5,
  durationMs: 10
};
function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 0,
    writableEnded: false,
    setHeader: vi.fn(),
    end: vi.fn()
  });
}
function call(
  res = response(),
  body: unknown = config,
  pathname = '/api/settings/decision/test',
  method = 'POST',
  origin?: string,
  host = 'localhost:8787'
) {
  const req = Object.assign(Readable.from([JSON.stringify(body)]), {
    headers: { host, ...(origin ? { origin } : {}) },
    socket: {
      encrypted: false,
      localAddress: '127.0.0.1',
      localPort: 8787
    }
  }) as unknown as IncomingMessage;
  return handleConnectionTestRoutes({
    req,
    res: res as unknown as ServerResponse,
    pathname,
    method
  });
}

beforeEach(() => {
  probe.mockReset().mockResolvedValue(result);
  agentProbe.mockReset().mockResolvedValue({
    ok: true,
    provider: 'azure_foundry',
    requestedModel: 'my-deployment',
    message: 'Inference responded',
    durationMs: 20
  });
});
describe('decision test route', () => {
  it('tests the submitted draft and returns the result without workspace settings', async () => {
    const res = response();
    expect(await call(res)).toBe(true);
    expect(probe).toHaveBeenCalledWith(config, expect.any(AbortSignal));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual(result);
  });
  it('returns a failed probe as an explicit result rather than a judge verdict', async () => {
    const failed = {
      ...result,
      ok: false,
      failure: 'missing_credentials',
      message: 'Missing OPENAI_API_KEY'
    };
    probe.mockResolvedValue(failed);
    const res = response();
    await call(res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual(failed);
  });
  it('returns 400 for invalid draft settings', async () => {
    probe.mockRejectedValue(new Error('Invalid decision thresholds'));
    const res = response();
    await call(res, { ...config, passThreshold: -1 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ error: 'Invalid decision thresholds' });
  });
  it.each(['/api/settings/decision/test', '/api/agents/test'])(
    'rejects cross-origin probes to %s before contacting the configured provider',
    async (pathname) => {
      const res = response();
      expect(await call(res, config, pathname, 'POST', 'https://attacker.example')).toBe(true);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({
        error: 'Cross-origin request rejected.'
      });
      expect(probe).not.toHaveBeenCalled();
      expect(agentProbe).not.toHaveBeenCalled();
    }
  );
  it('allows a same-origin probe', async () => {
    const res = response();
    expect(
      await call(res, config, '/api/settings/decision/test', 'POST', 'http://localhost:8787')
    ).toBe(true);
    expect(probe).toHaveBeenCalledOnce();
  });
  it('allows the local Vite app to test connections through the MCPLab backend', async () => {
    const res = response();
    expect(
      await call(
        res,
        config,
        '/api/settings/decision/test',
        'POST',
        'http://localhost:8685',
        '127.0.0.1:8787'
      )
    ).toBe(true);
    expect(probe).toHaveBeenCalledOnce();
  });
  it('rejects unrelated local web origins', async () => {
    const res = response();
    await call(res, config, '/api/settings/decision/test', 'POST', 'http://localhost:8686');
    expect(res.statusCode).toBe(403);
    expect(probe).not.toHaveBeenCalled();
  });
  it('rejects DNS-rebinding origins that match the Host header', async () => {
    const res = response();
    await call(
      res,
      config,
      '/api/settings/decision/test',
      'POST',
      'http://attacker.example:8787',
      'attacker.example:8787'
    );
    expect(res.statusCode).toBe(403);
    expect(probe).not.toHaveBeenCalled();
  });
  it.each(['/api/settings/decision/test', '/api/agents/test'])(
    'aborts %s when the client disconnects and removes the listener',
    async (pathname) => {
      const selectedProbe = pathname === '/api/agents/test' ? agentProbe : probe;
      let signal: AbortSignal | undefined;
      selectedProbe.mockImplementation((_raw, abortSignal: AbortSignal) => {
        signal = abortSignal;
        return new Promise((_resolve, reject) =>
          abortSignal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        );
      });
      const res = response();
      const pending = call(res, config, pathname);
      await vi.waitFor(() => expect(selectedProbe).toHaveBeenCalled());
      res.emit('close');
      expect(await pending).toBe(true);
      expect(signal?.aborted).toBe(true);
      expect(res.end).not.toHaveBeenCalled();
      expect(res.listenerCount('close')).toBe(0);
    }
  );
  it('ignores other paths and methods', async () => {
    expect(await call(response(), config, '/api/settings')).toBe(false);
    expect(await call(response(), config, '/api/settings/decision/test', 'GET')).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('agent inference test route', () => {
  const agent = { provider: 'azure_foundry', model: 'my-deployment' };
  it('tests the submitted agent and returns an inference result without saving a library', async () => {
    const res = response();
    expect(await call(res, agent, '/api/agents/test')).toBe(true);
    expect(agentProbe).toHaveBeenCalledWith(agent, expect.any(AbortSignal));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
      ok: true,
      requestedModel: 'my-deployment'
    });
    expect(probe).not.toHaveBeenCalled();
  });
  it('returns an explicit failure result for inaccessible deployments', async () => {
    agentProbe.mockResolvedValue({ ok: false, failure: 'deployment', message: 'Check deployment' });
    const res = response();
    await call(res, agent, '/api/agents/test');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
      ok: false,
      failure: 'deployment'
    });
  });
  it('rejects invalid agent input without changing settings', async () => {
    agentProbe.mockRejectedValue(new Error('Choose an LLM provider'));
    const res = response();
    await call(res, { type: 'browser' }, '/api/agents/test');
    expect(res.statusCode).toBe(400);
  });
});
