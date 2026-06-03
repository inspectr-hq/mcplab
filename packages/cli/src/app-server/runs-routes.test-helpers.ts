import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createRunQueueState(overrides: Record<string, unknown> = {}) {
  return {
    queue: [] as string[],
    activeJobIds: new Set<string>(),
    admittingJobIds: new Set<string>(),
    queueWorkerCount: 1,
    isAdvancingQueue: false,
    needsAdvanceQueue: false,
    clients: new Set(),
    ...overrides
  };
}

export function makeRunsRouteDeps(overrides: Record<string, unknown> = {}) {
  return {
    parseBody: async () => ({}),
    asJson: (_res: unknown, _status: number, _payload: unknown) => undefined,
    addJobEvent: () => undefined,
    sendSseEvent: () => undefined,
    ensureInsideRoot: (_root: string, path: string) => path,
    listRuns: () => [],
    getRunResults: () => ({}),
    getScenarioRunTraceRecords: () => [],
    selectScenarioIds: (config: any, ids?: string[]) =>
      ids?.length ? { ...config, scenarios: config.scenarios.filter((s: any) => ids.includes(s.id)) } : config,
    expandConfigForAgents: (config: any) => config,
    resolveRunSelectedAgents: () => [],
    readLibraries: () => ({ agents: {}, servers: {}, scenarios: {} }),
    pickDefaultAssistantAgentName: () => undefined,
    pkgVersion: 'test',
    ...overrides
  };
}

export function createOauthEvalFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-queue-oauth-'));
  const evalsDir = join(root, 'evals');
  const runsDir = join(root, 'runs');
  const librariesDir = join(root, 'libs');
  mkdirSync(evalsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(librariesDir, { recursive: true });
  const configPath = join(evalsDir, 'eval.yaml');
  writeFileSync(
    configPath,
    [
      'servers:',
      '  - id: oauth-server',
      '    transport: http',
      '    url: http://localhost:3300/mcp',
      '    auth:',
      '      type: oauth_authorization_code',
      '      client_id: client-id',
      'agents:',
      '  - id: mini',
      '    provider: openai',
      '    model: gpt-5-mini',
      'scenarios:',
      '  - id: s1',
      '    prompt: test',
      '    servers: [oauth-server]'
    ].join('\n'),
    'utf8'
  );
  return { root, evalsDir, runsDir, librariesDir, configPath };
}

export function cleanupFixtureRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function createQueuedJob(configPath: string, id = 'job-1') {
  return {
    id,
    status: 'queued',
    clients: new Set(),
    events: [],
    abortController: new AbortController(),
    runParams: {
      configPath,
      runsPerScenario: 1,
      scenarioIds: null,
      requestedAgents: null,
      runNote: null,
      serverOverrideAll: null,
      scenarioServerOverrides: null
    }
  } as any;
}
