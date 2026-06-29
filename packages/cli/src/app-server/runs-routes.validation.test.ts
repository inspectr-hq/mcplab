import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@inspectr/mcplab-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inspectr/mcplab-core')>();
  return {
    ...actual,
    hashConfig: vi.fn(() => 'test-hash'),
    runAll: vi.fn(async () => {
      return {
        results: {
          metadata: { run_id: 'preview-run' },
          scenarios: [{ runs: [{}] }]
        }
      };
    })
  };
});

import { handleRunsRoutes } from './runs-routes.js';
import { runAll } from '@inspectr/mcplab-core';
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

  it('returns 400 for preview when evaluation judge setting references a missing agent', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs/preview', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs/preview',
      method: 'POST',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp',
        evaluationJudgeAgentName: 'missing-judge'
      } as any,
      runQueueService: createRunQueueServiceForTest({ runQueueState: createRunQueueState() }),
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({
          selectedAgentName: 'assistant-1',
          scenario: {
            id: 'scn-1',
            prompt: 'test',
            serverNames: ['server-1'],
            evalRules: [],
            extractRules: []
          }
        }),
        readLibraries: () => ({
          agents: {
            'assistant-1': { provider: 'openai', model: 'gpt-4o-mini' }
          },
          servers: {
            'server-1': { transport: 'http', url: 'http://localhost:3000/mcp' }
          },
          scenarios: {}
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        }
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'Evaluation judge agent not found: missing-judge'
    );
  });

  it('passes attachments through preview config', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs/preview', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs/preview',
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
          selectedAgentName: 'assistant-1',
          scenario: {
            id: 'scn-1',
            prompt: 'test',
            serverNames: ['server-1'],
            attachments: [
              {
                type: 'document',
                media_type: 'text/plain',
                data: 'aGVsbG8=',
                name: 'notes.txt'
              }
            ],
            evalRules: [],
            extractRules: []
          }
        }),
        readLibraries: () => ({
          agents: {
            'assistant-1': { provider: 'openai', model: 'gpt-4o-mini' }
          },
          servers: {
            'server-1': { transport: 'http', url: 'http://localhost:3000/mcp' }
          },
          scenarios: {}
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        },
        getScenarioRunTraceRecords: () => [],
        pickDefaultAssistantAgentName: () => 'assistant-1',
        pkgVersion: 'test',
        selectScenarioIds: (config: any) => config
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(200);
    expect((responses[0]?.payload as any)?.runId).toBe('preview-run');
  });

  it('passes tool_sequence eval rules through preview config', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs/preview', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs/preview',
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
          selectedAgentName: 'assistant-1',
          scenario: {
            id: 'scn-1',
            prompt: 'test',
            serverNames: ['server-1'],
            evalRules: [{ type: 'tool_sequence', sequence: ['search_tags', 'value_based_search'] }],
            extractRules: []
          }
        }),
        readLibraries: () => ({
          agents: {
            'assistant-1': { provider: 'openai', model: 'gpt-4o-mini' }
          },
          servers: {
            'server-1': { transport: 'http', url: 'http://localhost:3000/mcp' }
          },
          scenarios: {}
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        },
        getScenarioRunTraceRecords: () => [],
        pickDefaultAssistantAgentName: () => 'assistant-1',
        pkgVersion: 'test',
        selectScenarioIds: (config: any) => config
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(200);
    expect(vi.mocked(runAll).mock.calls.at(-1)?.[0].scenarios[0]?.eval?.tool_sequence).toEqual([
      'search_tags',
      'value_based_search'
    ]);
  });

  it('normalizes legacy tool_sequence value strings in preview config', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs/preview', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs/preview',
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
          selectedAgentName: 'assistant-1',
          scenario: {
            id: 'scn-1',
            prompt: 'test',
            serverNames: ['server-1'],
            evalRules: [{ type: 'tool_sequence', value: 'search_tags -> value_based_search' }],
            extractRules: []
          }
        }),
        readLibraries: () => ({
          agents: {
            'assistant-1': { provider: 'openai', model: 'gpt-4o-mini' }
          },
          servers: {
            'server-1': { transport: 'http', url: 'http://localhost:3000/mcp' }
          },
          scenarios: {}
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        },
        getScenarioRunTraceRecords: () => [],
        pickDefaultAssistantAgentName: () => 'assistant-1',
        pkgVersion: 'test',
        selectScenarioIds: (config: any) => config
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(200);
    expect(vi.mocked(runAll).mock.calls.at(-1)?.[0].scenarios[0]?.eval?.tool_sequence).toEqual([
      'search_tags',
      'value_based_search'
    ]);
  });

  it('returns a warning when preview eval rules include multiple tool_sequence checks', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs/preview', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs/preview',
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
          selectedAgentName: 'assistant-1',
          scenario: {
            id: 'scn-1',
            prompt: 'test',
            serverNames: ['server-1'],
            evalRules: [
              { type: 'tool_sequence', sequence: ['search_tags', 'value_based_search'] },
              { type: 'tool_sequence', sequence: ['lookup', 'fetch'] }
            ],
            extractRules: []
          }
        }),
        readLibraries: () => ({
          agents: {
            'assistant-1': { provider: 'openai', model: 'gpt-4o-mini' }
          },
          servers: {
            'server-1': { transport: 'http', url: 'http://localhost:3000/mcp' }
          },
          scenarios: {}
        }),
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        },
        getScenarioRunTraceRecords: () => [],
        pickDefaultAssistantAgentName: () => 'assistant-1',
        pkgVersion: 'test',
        selectScenarioIds: (config: any) => config
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(200);
    expect((responses[0]?.payload as any)?.warnings).toEqual([
      'Multiple tool_sequence checks were provided; only the last valid sequence was used.'
    ]);
    expect(vi.mocked(runAll).mock.calls.at(-1)?.[0].scenarios[0]?.eval?.tool_sequence).toEqual([
      'lookup',
      'fetch'
    ]);
  });

  it('returns 400 for preview when url-only text attachment is provided', async () => {
    const responses: Array<{ status: number; payload: unknown }> = [];
    const handled = await handleRunsRoutes({
      req: { url: '/api/runs/preview', headers: {}, on: () => undefined } as any,
      res: {} as any,
      pathname: '/api/runs/preview',
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
          selectedAgentName: 'assistant-1',
          scenario: {
            id: 'scn-1',
            prompt: 'test',
            serverNames: ['server-1'],
            attachments: [
              {
                type: 'document',
                media_type: 'text/plain',
                url: 'https://example.com/file.txt'
              }
            ],
            evalRules: [],
            extractRules: []
          }
        }),
        readLibraries: () => ({
          agents: {
            'assistant-1': { provider: 'openai', model: 'gpt-4o-mini' }
          },
          servers: {
            'server-1': { transport: 'http', url: 'http://localhost:3000/mcp' }
          },
          scenarios: {}
        }),
        pickDefaultAssistantAgentName: () => 'assistant-1',
        asJson: (_res: unknown, status: number, payload: unknown) => {
          responses.push({ status, payload });
        }
      }) as any
    });

    expect(handled).toBe(true);
    expect(responses[0]?.status).toBe(400);
    expect(String((responses[0]?.payload as any)?.error ?? '')).toContain(
      'Preview attachment must be image/* or application/pdf when only url is provided'
    );
  });
});
