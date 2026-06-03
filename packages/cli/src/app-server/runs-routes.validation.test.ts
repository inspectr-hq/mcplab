import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleRunsRoutes } from './runs-routes.js';
import {
  createRunQueueServiceForTest,
  createRunQueueState,
  makeRunsRouteDeps
} from './runs-routes.test-helpers.js';

describe('run request validation', () => {
  it('returns 400 when serverOverrideAll is an empty array', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: createRunQueueServiceForTest({ runQueueState: createRunQueueState() }),
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({
          configPath: '/tmp/eval.yaml',
          serverOverrideAll: []
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        }
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'serverOverrideAll must include at least one server id'
    );
  });

  it('returns 400 when scenarioServerOverrides is not an object map', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: createRunQueueServiceForTest({ runQueueState: createRunQueueState() }),
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({
          configPath: '/tmp/eval.yaml',
          scenarioServerOverrides: [] as unknown
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        }
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'scenarioServerOverrides must be an object of scenarioId -> string[]'
    );
  });

  it('returns 400 when a scenarioServerOverrides entry is not an array', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: createRunQueueServiceForTest({ runQueueState: createRunQueueState() }),
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({
          configPath: '/tmp/eval.yaml',
          scenarioServerOverrides: { 'scenario-a': 'server-x' as unknown }
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        }
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'scenarioServerOverrides.scenario-a must be an array of server ids'
    );
  });

  it('returns 400 when scenarioServerOverrides references unknown server ids', async () => {
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

    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: {
        evalsDir,
        runsDir: join(root, 'runs'),
        librariesDir,
        workspaceRoot: root,
        toolAnalysisResultsDir: root
      } as any,
      runQueueService: createRunQueueServiceForTest({ runQueueState: createRunQueueState() }),
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({
          configPath,
          scenarioServerOverrides: { s1: ['missing-server'] }
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        }
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'Unknown server refs in scenarioServerOverrides.s1: missing-server'
    );
  });
});
