import { describe, expect, it } from 'vitest';
import { mergeLibraryAgentsIntoConfig, applyLibraryAgents } from './runs-routes.js';
import { hashConfig } from '@inspectr/mcplab-core';
import type { EvalConfig } from '@inspectr/mcplab-core';

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
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any) => c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        loadSnapshot: () => ({}),
        compareRunToSnapshot: () => ({}),
        applySnapshotPolicyToRunResult: () => ({}),
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
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any) => c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        loadSnapshot: () => ({}),
        compareRunToSnapshot: () => ({}),
        applySnapshotPolicyToRunResult: () => ({}),
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
      runQueueState: { queue: [], activeJobId: null, isAdvancingQueue: false },
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        addJobEvent: () => undefined,
        sendSseEvent: () => undefined,
        ensureInsideRoot: (_root: string, path: string) => path,
        listRuns: () => [],
        getRunResults: () => ({}),
        getScenarioRunTraceRecords: () => [],
        selectScenarioIds: (c: any) => c,
        expandConfigForAgents: (c: any) => c,
        resolveRunSelectedAgents: () => [],
        loadSnapshot: () => ({}),
        compareRunToSnapshot: () => ({}),
        applySnapshotPolicyToRunResult: () => ({}),
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
});
