import { describe, expect, it } from 'vitest';
import { mergeLibraryAgentsIntoConfig, applyLibraryAgents } from './runs-routes.js';
import { hashConfig } from '@inspectr/mcplab-core';
import type { EvalConfig } from '@inspectr/mcplab-core';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseAgent = (id: string): EvalConfig['agents'][string] => ({
  provider: 'openai' as const,
  model: 'gpt-4o',
  temperature: 0,
  max_tokens: 4096
});

describe('mergeLibraryAgentsIntoConfig', () => {
  it('adds library-only agents to the config agent map', () => {
    const config = {
      agents: { 'config-agent': baseAgent('config-agent') }
    } as unknown as EvalConfig;

    const libraryAgents = {
      'library-agent': baseAgent('library-agent')
    };

    const result = mergeLibraryAgentsIntoConfig(config, libraryAgents);

    expect(result.agents['config-agent']).toBeDefined();
    expect(result.agents['library-agent']).toBeDefined();
  });

  it('config agents take precedence over library agents with the same id', () => {
    const configAgentDef = { ...baseAgent('x'), model: 'config-model' };
    const libraryAgentDef = { ...baseAgent('x'), model: 'library-model' };

    const config = {
      agents: { 'shared-id': configAgentDef }
    } as unknown as EvalConfig;

    const libraryAgents = { 'shared-id': libraryAgentDef };

    const result = mergeLibraryAgentsIntoConfig(config, libraryAgents);

    expect(result.agents['shared-id'].model).toBe('config-model');
  });

  it('does not mutate the original config', () => {
    const originalAgents = { 'config-agent': baseAgent('config-agent') };
    const config = { agents: originalAgents } as unknown as EvalConfig;
    const libraryAgents = { 'library-agent': baseAgent('library-agent') };

    mergeLibraryAgentsIntoConfig(config, libraryAgents);

    expect(Object.keys(config.agents)).toEqual(['config-agent']);
  });
});

describe('applyLibraryAgents', () => {
  it('merges library agents into config and updates hash atomically', () => {
    const config = {
      agents: { 'config-agent': baseAgent('config-agent') }
    } as unknown as EvalConfig;
    const loaded = { config, hash: hashConfig(config) };
    const originalHash = loaded.hash;

    const libraryAgents = { 'library-agent': baseAgent('library-agent') };
    applyLibraryAgents(loaded, libraryAgents);

    expect(loaded.config.agents['library-agent']).toBeDefined();
    expect(loaded.hash).not.toBe(originalHash);
  });

  it('hash reflects the merged config, not the pre-merge config', () => {
    const config = {
      agents: { 'config-agent': baseAgent('config-agent') }
    } as unknown as EvalConfig;
    const loaded = { config, hash: 'stale-hash' };

    const libraryAgents = { 'library-agent': baseAgent('library-agent') };
    applyLibraryAgents(loaded, libraryAgents);

    expect(loaded.hash).toBe(hashConfig(loaded.config));
  });
});

describe('run request validation', () => {
  it('returns 400 when serverOverrideAll is an empty array', async () => {
    const { handleRunsRoutes } = await import('./runs-routes.js');
    const req = {
      url: '/api/runs',
      headers: {},
      on: () => undefined
    } as any;
    const responses: Array<{ status: number; payload: unknown }> = [];
    const deps: any = {
      parseBody: async () => ({
        configPath: '/tmp/eval.yaml',
        serverOverrideAll: []
      }),
      asJson: (_res: unknown, status: number, payload: unknown) => {
        responses.push({ status, payload });
      }
    };
    const handled = await handleRunsRoutes({
      req,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: { evalsDir: '/tmp', runsDir: '/tmp', librariesDir: '/tmp', workspaceRoot: '/tmp' },
      jobs: new Map(),
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false, clients: new Set() },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any, ids?: string[]) =>
          ids?.length ? { ...c, scenarios: c.scenarios.filter((s: any) => ids.includes(s.id)) } : c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        readLibraries: () => ({ agents: {}, servers: {}, scenarios: {} }),
        pickDefaultAssistantAgentName: () => undefined,
        pkgVersion: 'test'
      }
    } as any);
    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'serverOverrideAll must include at least one server id'
    );
  });

  it('returns 400 when scenarioServerOverrides is not an object map', async () => {
    const { handleRunsRoutes } = await import('./runs-routes.js');
    const req = {
      url: '/api/runs',
      headers: {},
      on: () => undefined
    } as any;
    const responses: Array<{ status: number; payload: unknown }> = [];
    const deps: any = {
      parseBody: async () => ({
        configPath: '/tmp/eval.yaml',
        scenarioServerOverrides: [] as unknown
      }),
      asJson: (_res: unknown, status: number, payload: unknown) => {
        responses.push({ status, payload });
      }
    };
    const handled = await handleRunsRoutes({
      req,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: { evalsDir: '/tmp', runsDir: '/tmp', librariesDir: '/tmp', workspaceRoot: '/tmp' },
      jobs: new Map(),
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false, clients: new Set() },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any, ids?: string[]) =>
          ids?.length ? { ...c, scenarios: c.scenarios.filter((s: any) => ids.includes(s.id)) } : c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        readLibraries: () => ({ agents: {}, servers: {}, scenarios: {} }),
        pickDefaultAssistantAgentName: () => undefined,
        pkgVersion: 'test'
      }
    } as any);
    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'scenarioServerOverrides must be an object of scenarioId -> string[]'
    );
  });

  it('returns 400 when a scenarioServerOverrides entry is not an array', async () => {
    const { handleRunsRoutes } = await import('./runs-routes.js');
    const req = {
      url: '/api/runs',
      headers: {},
      on: () => undefined
    } as any;
    const responses: Array<{ status: number; payload: unknown }> = [];
    const deps: any = {
      parseBody: async () => ({
        configPath: '/tmp/eval.yaml',
        scenarioServerOverrides: { 'scenario-a': 'server-x' as unknown }
      }),
      asJson: (_res: unknown, status: number, payload: unknown) => {
        responses.push({ status, payload });
      }
    };
    const handled = await handleRunsRoutes({
      req,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: { evalsDir: '/tmp', runsDir: '/tmp', librariesDir: '/tmp', workspaceRoot: '/tmp' },
      jobs: new Map(),
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false, clients: new Set() },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any, ids?: string[]) =>
          ids?.length ? { ...c, scenarios: c.scenarios.filter((s: any) => ids.includes(s.id)) } : c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        readLibraries: () => ({ agents: {}, servers: {}, scenarios: {} }),
        pickDefaultAssistantAgentName: () => undefined,
        pkgVersion: 'test'
      }
    } as any);
    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'scenarioServerOverrides.scenario-a must be an array of server ids'
    );
  });

  it('returns 400 when scenarioServerOverrides references unknown server ids', async () => {
    const { handleRunsRoutes } = await import('./runs-routes.js');
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-route-'));
    const evalsDir = join(root, 'evals');
    const librariesDir = join(root, 'libs');
    mkdirSync(evalsDir, { recursive: true });
    mkdirSync(librariesDir, { recursive: true });
    const configPath = join(evalsDir, 'eval.yaml');
    writeFileSync(
      configPath,
      [
        'servers:',
        '  - id: weather',
        '    transport: http',
        '    url: http://localhost:3300/mcp',
        'agents:',
        '  - id: mini',
        '    provider: openai',
        '    model: gpt-5-mini',
        'scenarios:',
        '  - id: s1',
        '    prompt: test',
        '    servers: [weather]'
      ].join('\n'),
      'utf8'
    );
    const req = { url: '/api/runs', headers: {}, on: () => undefined } as any;
    const responses: Array<{ status: number; payload: unknown }> = [];
    const deps: any = {
      parseBody: async () => ({
        configPath,
        scenarioServerOverrides: { s1: ['missing-server'] }
      }),
      asJson: (_res: unknown, status: number, payload: unknown) => {
        responses.push({ status, payload });
      }
    };
    const handled = await handleRunsRoutes({
      req,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: { evalsDir, runsDir: join(root, 'runs'), librariesDir, workspaceRoot: root },
      jobs: new Map(),
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false, clients: new Set() },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any, ids?: string[]) =>
          ids?.length ? { ...c, scenarios: c.scenarios.filter((s: any) => ids.includes(s.id)) } : c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        readLibraries: () => ({ agents: {}, servers: {}, scenarios: {} }),
        pickDefaultAssistantAgentName: () => undefined,
        pkgVersion: 'test'
      }
    } as any);
    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'Unknown server refs in scenarioServerOverrides.s1: missing-server'
    );
  });
});

describe('run queue SSE endpoint', () => {
  it('streams initial queue_snapshot and registers client', async () => {
    const { handleRunsRoutes } = await import('./runs-routes.js');

    const writes: string[] = [];
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) {
        this.headers[key] = value;
      },
      write(chunk: string) {
        writes.push(chunk);
      },
      flushHeaders() {
        return undefined;
      }
    } as any;

    let closeHandler: (() => void) | undefined;
    const req = {
      url: '/api/runs/queue/events',
      headers: {},
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeHandler = cb;
      }
    } as any;

    const runQueueState = {
      queue: [] as string[],
      activeJobId: null as string | null,
      isAdvancingQueue: false,
      clients: new Set<any>()
    };

    const handled = await handleRunsRoutes({
      req,
      res,
      pathname: '/api/runs/queue/events',
      method: 'GET',
      settings: { evalsDir: '/tmp', runsDir: '/tmp', librariesDir: '/tmp', workspaceRoot: '/tmp' },
      jobs: new Map(),
      runQueueState,
      oauthSessionManager: {} as any,
      deps: {
        parseBody: async () => ({}),
        asJson: () => undefined,
        addJobEvent: () => undefined,
        sendSseEvent: (target: any, event: any) => {
          target.write(`event: ${event.type}\n`);
          target.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any) => c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        readLibraries: () => ({ agents: {}, servers: {}, scenarios: {} }),
        pickDefaultAssistantAgentName: () => undefined,
        pkgVersion: 'test'
      }
    } as any);

    expect(handled).toBe(true);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(writes.join('')).toContain('event: queue_snapshot');
    expect(runQueueState.clients.size).toBe(1);

    closeHandler?.();
    expect(runQueueState.clients.size).toBe(0);
  });
});
