import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const log = vi.fn();
    let nextPort = 49000;
    const manager = new InspectrSessionManager({
      storageRoot: '/tmp/mcplab-inspectr-test',
      commandPath: 'inspectr-test',
      allocatePorts: async (count) => Array.from({ length: count }, () => nextPort++),
      spawn,
      log,
      waitForReady: async () => undefined
    });

    const first = await manager.acquire('https://backend.test/mcp');
    const second = await manager.acquire('https://backend.test/other');

    expect(first).toEqual({
      upstreamOrigin: 'https://backend.test',
      proxyOrigin: 'http://127.0.0.1:49000',
      dashboardUrl: expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:49001\/\?channel=mcplab-[0-9a-f]{16}&channelCode=[0-9a-f]{32}$/
      )
    });
    expect(second).toBe(first);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[mcplab-app] Inspectr started for https://backend.test, proxy: http://127.0.0.1:49000, dashboard:'
      )
    );
    const dashboardUrl = new URL(first.dashboardUrl);
    const channel = dashboardUrl.searchParams.get('channel');
    const channelCode = dashboardUrl.searchParams.get('channelCode');
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      '--listen=127.0.0.1:49000',
      '--app-port=49001',
      '--backend=https://backend.test',
      `--channel=${channel}`,
      `--channel-code=${channelCode}`,
      '--print=false'
    ]);
  });

  it('explains how to install Inspectr when the executable is missing', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const child = {
      kill: vi.fn(),
      once: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
        return child;
      })
    } as any;
    const storageRoot = mkdtempSync(join(tmpdir(), 'mcplab-inspectr-missing-'));
    try {
      const manager = new InspectrSessionManager({
        storageRoot,
        commandPath: 'inspectr-missing',
        allocatePorts: async () => [49100, 49101],
        spawn: () => child,
        waitForReady: async () => {
          handlers.get('error')?.(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
          throw new Error('Inspectr process exited during startup');
        }
      });

      await expect(manager.acquire('https://backend.test/mcp')).rejects.toThrow(
        'Inspectr is not installed. Install it with `npm install -g @inspectr/inspectr` or Homebrew'
      );
      expect(child.kill).toHaveBeenCalled();
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('stops every running Inspectr process synchronously', async () => {
    const children: Array<{ kill: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn> }> = [];
    const storageRoot = mkdtempSync(join(tmpdir(), 'mcplab-inspectr-stop-'));
    try {
      let nextPort = 49200;
      const manager = new InspectrSessionManager({
        storageRoot,
        commandPath: 'inspectr-test',
        allocatePorts: async (count) => Array.from({ length: count }, () => nextPort++),
        spawn: () => {
          const child = { kill: vi.fn(), once: vi.fn() };
          children.push(child);
          return child as any;
        },
        log: () => undefined,
        waitForReady: async () => undefined
      });
      await manager.acquire('https://one.test/mcp');
      await manager.acquire('https://two.test/mcp');

      manager.stopAll();

      expect(children).toHaveLength(2);
      for (const child of children) expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('also stops a process that is still starting', async () => {
    const child = { kill: vi.fn(), once: vi.fn() } as any;
    let finishStartup!: () => void;
    const storageRoot = mkdtempSync(join(tmpdir(), 'mcplab-inspectr-starting-'));
    try {
      const manager = new InspectrSessionManager({
        storageRoot,
        commandPath: 'inspectr-test',
        allocatePorts: async () => [49300, 49301],
        spawn: () => child,
        log: () => undefined,
        waitForReady: () => new Promise<void>((resolve) => (finishStartup = resolve))
      });
      const starting = manager.acquire('https://slow.test/mcp');
      await vi.waitFor(() => expect(finishStartup).toBeDefined());

      manager.stopAll();

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      finishStartup();
      await starting;
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('rewrites only the origin while preserving path and query', () => {
    expect(
      rewriteUrlThroughInspectr(
        'https://backend.test/base/mcp?tenant=acme',
        'http://127.0.0.1:49000'
      )
    ).toBe('http://127.0.0.1:49000/base/mcp?tenant=acme');
  });

  it('keeps the proxy host when the upstream path starts with a double slash', () => {
    expect(
      rewriteUrlThroughInspectr('https://backend.test//evil.test/mcp', 'http://127.0.0.1:49000')
    ).toBe('http://127.0.0.1:49000//evil.test/mcp');
  });

  it('keeps tag headers ASCII so non-Latin names cannot break requests', () => {
    const headers = buildInspectrRequestHeaders({
      phase: 'scenario',
      runId: 'run-1',
      serverName: 'café',
      scenarioId: '検索',
      agentName: 'Claude – prod 🚀',
      requestId: 'mcplab-run:run-1:scn:agent:run1'
    });

    expect(headers['inspectr-tag']).toBe(
      'mcplab, mcplab-run:run-1, mcplab-scenario:_, mcplab-agent:Claude _ prod _, mcplab-server:cafe'
    );
    expect(() => new Headers(headers)).not.toThrow();
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
