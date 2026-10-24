import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleRunsRoutes } from './runs-routes.js';
import { makeRunsRouteDeps } from './runs-routes.test-helpers.js';

async function requestBody(selection: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'server-variants-'));
  try {
    const configPath = join(root, 'eval.yaml');
    writeFileSync(
      configPath,
      'servers:\n  - id: dev\n    transport: http\n    url: http://dev/mcp\nagents:\n  - id: api\n    provider: openai\n    model: test\n  - id: browser\n    type: browser\n    provider: chatgpt-com\n    url: https://chatgpt.com\nscenarios:\n  - id: test\n    prompt: hello\n    servers: [dev]\n'
    );
    const enqueueRun = vi.fn(() => ({ jobId: 'queued' }));
    const asJson = vi.fn();
    await handleRunsRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: { evalsDir: root, librariesDir: root } as any,
      runQueueService: { enqueueRun } as any,
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({ configPath, ...selection }),
        asJson,
        readLibraries: () => ({
          agents: {},
          scenarios: {},
          browserProviders: {},
          servers: {
            dev: { transport: 'http', url: 'http://dev/mcp' },
            prod: { transport: 'http', url: 'http://prod/mcp' }
          }
        })
      }) as any
    });
    return { enqueueRun, asJson };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const request = (serverSets: unknown) => requestBody({ server_sets: serverSets });

describe('server variant execution planning', () => {
  it('expands each set across API and browser jobs under one evaluation', async () => {
    const { enqueueRun, asJson } = await request([{ id: 'A' }, { id: 'B', servers: ['prod'] }]);
    expect(asJson).toHaveBeenCalledWith(expect.anything(), 202, expect.anything());
    expect(enqueueRun).toHaveBeenCalledTimes(4);
    const jobs = enqueueRun.mock.calls.map((call) => (call as any)[0]);
    expect(new Set(jobs.map((job) => job.evaluationRunId)).size).toBe(1);
    expect(jobs.map((job) => job.serverVariant.id)).toEqual(['A', 'A', 'B', 'B']);
    expect(
      jobs
        .filter((job) => job.executionType === 'rover')
        .map((job) => job.roverScenarios[0].servers)
    ).toEqual([['dev'], ['prod']]);
  });
  it('rejects a later invalid set before enqueueing anything', async () => {
    const { enqueueRun, asJson } = await request([{ id: 'A' }, { id: 'B', servers: ['missing'] }]);
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(asJson).toHaveBeenCalledWith(expect.anything(), 400, {
      error: expect.stringContaining('Unknown server')
    });
  });
});

it('accepts server_sets with nested servers in the app API', async () => {
  const { enqueueRun, asJson } = await requestBody({
    server_sets: [{ id: 'A' }, { id: 'B', servers: ['prod'] }]
  });
  expect(asJson).toHaveBeenCalledWith(expect.anything(), 202, expect.anything());
  expect(enqueueRun).toHaveBeenCalledTimes(4);
  const jobs = enqueueRun.mock.calls.map((call) => (call as any)[0]);
  expect(jobs.map((job) => job.serverVariant.id)).toEqual(['A', 'A', 'B', 'B']);
  expect(
    jobs.filter((job) => job.executionType === 'rover').map((job) => job.roverScenarios[0].servers)
  ).toEqual([['dev'], ['prod']]);
});

it('applies servers to both API and browser jobs without comparison', async () => {
  const { enqueueRun, asJson } = await requestBody({ servers: ['prod'] });
  expect(asJson).toHaveBeenCalledWith(expect.anything(), 202, expect.anything());
  const jobs = enqueueRun.mock.calls.map((call) => (call as any)[0]);
  expect(jobs).toHaveLength(2);
  expect(jobs.every((job) => job.serverOverrideAll?.[0] === 'prod')).toBe(true);
  expect(jobs.find((job) => job.executionType === 'rover').roverScenarios[0].servers).toEqual([
    'prod'
  ]);
});

it.each([
  { server_sets: [{ id: 'a' }], servers: ['prod'] },
  { servers: [] },
  { server_sets: [{ id: 'a' }], scenarioServerOverrides: { test: ['dev'] } }
])('rejects conflicting selections before enqueueing: %j', async (input) => {
  const { enqueueRun, asJson } = await requestBody(input);
  expect(enqueueRun).not.toHaveBeenCalled();
  expect(asJson).toHaveBeenCalledWith(expect.anything(), 400, expect.anything());
});
