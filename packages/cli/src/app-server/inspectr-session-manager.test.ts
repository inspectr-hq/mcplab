import { describe, expect, it, vi } from 'vitest';
import {
  buildInspectrRequestHeaders,
  InspectrSessionManager,
  rewriteUrlThroughInspectr
} from './inspectr-session-manager.js';

describe('InspectrSessionManager', () => {
  it('reuses a ready session for the same upstream origin and preserves request paths', async () => {
    const child = { kill: vi.fn(), once: vi.fn(), on: vi.fn() } as any;
    const spawn = vi.fn(() => child);
    let nextPort = 49000;
    const manager = new InspectrSessionManager({
      storageRoot: '/tmp/mcplab-inspectr-test',
      commandPath: 'inspectr-test',
      allocatePort: async () => nextPort++,
      spawn,
      waitForReady: async () => undefined
    });

    const first = await manager.acquire('https://backend.test/mcp');
    const second = await manager.acquire('https://backend.test/other');

    expect(first).toEqual({
      upstreamOrigin: 'https://backend.test',
      proxyOrigin: 'http://127.0.0.1:49000',
      dashboardUrl: 'http://127.0.0.1:49001'
    });
    expect(second).toBe(first);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      '--listen=127.0.0.1:49000',
      '--app-port=49001',
      '--backend=https://backend.test',
      '--print=false'
    ]);
  });

  it('rewrites only the origin while preserving path and query', () => {
    expect(
      rewriteUrlThroughInspectr(
        'https://backend.test/base/mcp?tenant=acme',
        'http://127.0.0.1:49000'
      )
    ).toBe('http://127.0.0.1:49000/base/mcp?tenant=acme');
  });

  it('builds run and execution tags without allowing header delimiters', () => {
    expect(
      buildInspectrRequestHeaders({
        phase: 'scenario',
        runId: 'run-1',
        serverName: 'billing,prod',
        scenarioId: 'create customer',
        agentName: 'agent-1',
        requestId: 'mcplab-run:run-1:create:agent-1:run1'
      })
    ).toEqual({
      'inspectr-tag':
        'mcplab, mcplab-run:run-1, mcplab-scenario:create customer, mcplab-agent:agent-1, mcplab-server:billing_prod',
      'inspectr-trace-id': 'mcplab-run:run-1:create:agent-1:run1'
    });
  });
});
