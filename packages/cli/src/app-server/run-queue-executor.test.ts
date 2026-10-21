import { describe, expect, it, vi } from 'vitest';
import { aggregateResults, expandConfigForAgents } from '@inspectr/mcplab-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveRunSelectedAgents } from './run-agent-selection.js';
const { runAllMock } = vi.hoisted(() => ({ runAllMock: vi.fn() }));
vi.mock('@inspectr/mcplab-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inspectr/mcplab-core')>()),
  runAll: runAllMock
}));
import {
  executeRunJob,
  getCompletedRunId,
  resolveOAuthServersForJob
} from './run-queue-executor.js';
import {
  createQueuedJob,
  createOauthEvalFixture,
  cleanupFixtureRoot
} from './runs-routes.test-helpers.js';

describe('executeRunJob', () => {
  it('resolves OAuth admission using saved agent refs after library deletion', () => {
    const fixture = createOauthEvalFixture();
    try {
      const yaml = readFileSync(fixture.configPath, 'utf8').replace(
        '  - id: mini\n    provider: openai\n    model: gpt-5-mini',
        '  - ref: original'
      );
      writeFileSync(fixture.configPath, yaml);
      const job = createQueuedJob(fixture.configPath);
      job.runParams.agentSnapshot = { original: { provider: 'openai', model: 'queued' } };
      expect(resolveOAuthServersForJob(job, fixture.librariesDir)).toEqual(['oauth-server']);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });
  it.each([false, true])(
    'runs the queued agent snapshot after library changes, referenced=%s',
    async (referenced) => {
      const fixture = createOauthEvalFixture();
      try {
        writeFileSync(
          fixture.configPath,
          `${referenced ? 'agents:\n  - ref: original\n' : ''}scenarios:\n  - id: s1\n    prompt: test\n    servers: []\n`
        );
        const job = createQueuedJob(fixture.configPath);
        job.runParams.requestedAgents = ['original'];
        job.runParams.agentSnapshot = { original: { provider: 'openai', model: 'queued-model' } };
        runAllMock.mockReset().mockResolvedValueOnce({
          runDir: fixture.runsDir,
          results: aggregateResults({
            runId: 'snapshot',
            timestamp: '2026-10-21T00:00:00Z',
            configHash: 'test',
            cliVersion: 'test',
            scenarioRuns: []
          })
        });
        const outcome = await executeRunJob({
          job,
          settings: {
            ...fixture,
            workspaceRoot: fixture.root,
            defaultEvaluationAgentName: 'replacement'
          },
          oauthSessionManager: {} as any,
          deps: {
            addJobEvent: () => {},
            getScenarioRunTraceRecords: () => [],
            selectScenarioIds: (config: any) => config,
            expandConfigForAgents,
            resolveRunSelectedAgents,
            readLibraries: () => ({
              agents: {
                replacement: { provider: 'openai', model: 'new-default' },
                original: { provider: 'openai', model: 'changed-library-model' }
              },
              servers: {},
              scenarios: {}
            }),
            pkgVersion: 'test'
          } as any
        });
        expect(outcome.status).toBe('completed');
        const config = runAllMock.mock.calls[0][0];
        expect(config.scenarios.map((scenario: any) => scenario.agent)).toEqual(['original']);
        expect(config.agents.original.model).toBe('queued-model');
      } finally {
        runAllMock.mockReset();
        cleanupFixtureRoot(fixture.root);
      }
    }
  );
  it.each([
    [1, true],
    [3, true],
    [1, false],
    [3, false]
  ] as const)(
    'keeps a stopped child terminal with %i runs and previously stopped=%s',
    async (runsPerScenario, previouslyStopped) => {
      const fixture = createOauthEvalFixture();
      try {
        const job = createQueuedJob(fixture.configPath, 'job-child-stop');
        job.runParams.runsPerScenario = runsPerScenario;
        const evaluationDecision = {
          provider: 'openai' as const,
          model: 'gpt-6-luna',
          passThreshold: 0.9,
          failThreshold: 0.1
        };
        runAllMock.mockImplementationOnce(async (_config, options) => {
          expect(options.evaluationDecision).toEqual(evaluationDecision);
          expect(options.evaluationJudge).toEqual({
            name: 'mini',
            agent: { provider: 'openai', model: 'test' }
          });
          const event = {
            scenarioId: 's1',
            agentName: 'mini',
            scenarioRunIndex: 1,
            totalScenarioRuns: runsPerScenario,
            runIndex: 0,
            runsPerScenario
          };
          await options.onProgress({ ...event, type: 'scenario_run_started' });
          if (previouslyStopped) job.childProgress![0]!.status = 'stopped';
          await options.onProgress({
            ...event,
            type: 'scenario_run_finished',
            outcome: 'stopped',
            pass: false,
            toolCallCount: 0
          });
          return {
            runDir: fixture.runsDir,
            results: aggregateResults({
              runId: 'execution-stop',
              timestamp: '2026-10-09T00:00:00Z',
              configHash: 'test',
              cliVersion: 'test',
              scenarioRuns: []
            })
          };
        });
        await executeRunJob({
          job,
          settings: {
            evalsDir: fixture.evalsDir,
            runsDir: fixture.runsDir,
            librariesDir: fixture.librariesDir,
            workspaceRoot: fixture.root,
            evaluationJudgeAgentName: 'mini',
            evaluationDecision
          },
          oauthSessionManager: {} as any,
          deps: {
            addJobEvent: (target: any, event: any) => target.events.push(event),
            getScenarioRunTraceRecords: () => [],
            selectScenarioIds: (config: any) => ({
              ...config,
              scenarios: [{ id: 's1', prompt: 'hi', servers: [] }]
            }),
            expandConfigForAgents: (config: any) => ({
              ...config,
              scenarios: [
                {
                  id: 's1',
                  prompt: 'hi',
                  agent: 'mini',
                  servers: [],
                  eval: { agent_assertions: [{ label: 'Check', prompt: 'Valid?' }] }
                }
              ]
            }),
            resolveRunSelectedAgents: () => ['mini'],
            readLibraries: () => ({
              agents: { mini: { provider: 'openai', model: 'test' } },
              servers: {},
              scenarios: []
            }),
            pkgVersion: 'test'
          } as any
        });
        expect(runAllMock).toHaveBeenCalled();
        expect(job.childProgress).toEqual([
          expect.objectContaining({ status: 'stopped', completed: 0, total: runsPerScenario })
        ]);
        expect(job.events.some((event: any) => event.payload.message?.includes('-> STOPPED'))).toBe(
          true
        );
        expect(job.events.some((event: any) => event.payload.message?.includes('-> FAIL'))).toBe(
          false
        );
      } finally {
        cleanupFixtureRoot(fixture.root);
      }
    }
  );

  it('routes only servers with Inspectr enabled through the proxy', async () => {
    const fixture = createOauthEvalFixture();
    try {
      const job = createQueuedJob(fixture.configPath, 'job-inspectr');
      const acquire = vi.fn(async (serverUrl: string) => ({
        upstreamOrigin: new URL(serverUrl).origin,
        proxyOrigin: 'http://127.0.0.1:9999',
        dashboardUrl: 'http://127.0.0.1:9998/?channel=test'
      }));
      const inspectrResults = aggregateResults({
        runId: 'execution-inspectr',
        timestamp: '2026-10-16T00:00:00Z',
        configHash: 'test',
        cliVersion: 'test',
        scenarioRuns: [{ scenario_id: 's1', agent: 'mini', runs: [] }]
      });
      runAllMock.mockImplementationOnce(async (_config, options) => {
        expect(options.mcpServerUrlOverrides).toEqual({
          inspected: 'http://127.0.0.1:9999/mcp?x=1'
        });
        expect(
          options.resolveMcpRequestHeaders({ phase: 'connect', runId: 'r1', serverName: 'plain' })
        ).toBeUndefined();
        expect(
          options.resolveMcpRequestHeaders({
            phase: 'connect',
            runId: 'r1',
            serverName: 'inspected'
          })
        ).toMatchObject({ 'inspectr-trace-id': 'mcplab-run:r1' });
        return { runDir: fixture.runsDir, results: inspectrResults };
      });
      const servers = {
        inspected: {
          transport: 'http',
          url: 'http://upstream.test/mcp?x=1',
          inspectr: { enabled: true }
        },
        plain: { transport: 'http', url: 'http://other.test/mcp' }
      };
      await executeRunJob({
        job,
        settings: {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root
        },
        oauthSessionManager: {} as any,
        inspectrSessionManager: { acquire } as any,
        deps: {
          addJobEvent: (target: any, event: any) => target.events.push(event),
          getScenarioRunTraceRecords: () => [],
          selectScenarioIds: (config: any) => ({
            ...config,
            servers,
            scenarios: [{ id: 's1', prompt: 'hi', servers: ['inspected', 'plain'] }]
          }),
          expandConfigForAgents: (config: any) => ({
            ...config,
            servers,
            scenarios: [{ id: 's1', prompt: 'hi', agent: 'mini', servers: ['inspected', 'plain'] }]
          }),
          resolveRunSelectedAgents: () => ['mini'],
          readLibraries: () => ({
            agents: { mini: { provider: 'openai', model: 'test' } },
            servers: {},
            scenarios: []
          }),
          pkgVersion: 'test'
        } as any
      });
      expect(runAllMock).toHaveBeenCalled();
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(acquire).toHaveBeenCalledWith('http://upstream.test/mcp?x=1');
      expect(job.events.filter((event: any) => event.type === 'inspection_ready')).toHaveLength(1);
      expect(inspectrResults.scenarios[0]?.inspectr_origins).toEqual(['http://upstream.test']);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('runs without inspection and warns when Inspectr cannot start', async () => {
    const fixture = createOauthEvalFixture();
    try {
      const job = createQueuedJob(fixture.configPath, 'job-inspectr-missing');
      const acquire = vi.fn().mockRejectedValue(new Error('Inspectr is not installed.'));
      const results = aggregateResults({
        runId: 'execution-inspectr-missing',
        timestamp: '2026-10-17T00:00:00Z',
        configHash: 'test',
        cliVersion: 'test',
        scenarioRuns: [{ scenario_id: 's1', agent: 'mini', runs: [] }]
      });
      runAllMock.mockImplementationOnce(async (_config, options) => {
        expect(options.mcpServerUrlOverrides).toEqual({});
        expect(options.resolveMcpRequestHeaders).toBeUndefined();
        return { runDir: fixture.runsDir, results };
      });
      const servers = {
        inspected: {
          transport: 'http',
          url: 'http://upstream.test/mcp',
          inspectr: { enabled: true }
        },
        sibling: {
          transport: 'http',
          url: 'http://upstream.test/other',
          inspectr: { enabled: true }
        }
      };
      await executeRunJob({
        job,
        settings: {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root
        },
        oauthSessionManager: {} as any,
        inspectrSessionManager: { acquire } as any,
        deps: {
          addJobEvent: (target: any, event: any) => target.events.push(event),
          getScenarioRunTraceRecords: () => [],
          selectScenarioIds: (config: any) => ({
            ...config,
            servers,
            scenarios: [{ id: 's1', prompt: 'hi', servers: ['inspected', 'sibling'] }]
          }),
          expandConfigForAgents: (config: any) => ({
            ...config,
            servers,
            scenarios: [
              { id: 's1', prompt: 'hi', agent: 'mini', servers: ['inspected', 'sibling'] }
            ]
          }),
          resolveRunSelectedAgents: () => ['mini'],
          readLibraries: () => ({
            agents: { mini: { provider: 'openai', model: 'test' } },
            servers: {},
            scenarios: []
          }),
          pkgVersion: 'test'
        } as any
      });

      expect(runAllMock).toHaveBeenCalled();
      // One failed start per origin, not one per server.
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(
        job.events.some((event: any) =>
          String(event.payload?.message ?? '').includes(
            'Warning: Inspectr is unavailable for http://upstream.test (Inspectr is not installed.)'
          )
        )
      ).toBe(true);
      expect(results.scenarios[0]).not.toHaveProperty('inspectr_origins');
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('uses the evaluation ID for grouped completion results', () => {
    expect(
      getCompletedRunId({ runParams: { evaluationRunId: 'evaluation-1' } } as any, 'execution-1')
    ).toBe('evaluation-1');
    expect(getCompletedRunId({ runParams: {} } as any, 'execution-1')).toBe('execution-1');
  });

  it.each([
    ['missing-judge', false],
    ['browser', false],
    ['missing-judge', true],
    ['browser', true]
  ] as const)(
    'validates judge %s only for semantic queued runs=%s',
    async (judgeName, hasSemanticChecks) => {
      const fixture = createOauthEvalFixture();
      try {
        const job = createQueuedJob(fixture.configPath, 'job-bad-judge');
        runAllMock.mockReset();
        runAllMock.mockResolvedValueOnce({
          runDir: fixture.runsDir,
          results: aggregateResults({
            runId: 'execution',
            timestamp: '2026-10-13T00:00:00Z',
            configHash: 'test',
            cliVersion: 'test',
            scenarioRuns: []
          })
        });
        const addJobEvent = (jobEventTarget: any, event: any) => {
          jobEventTarget.events.push(event);
        };
        const result = await executeRunJob({
          job,
          settings: {
            evalsDir: fixture.evalsDir,
            runsDir: fixture.runsDir,
            librariesDir: fixture.librariesDir,
            workspaceRoot: fixture.root,
            evaluationJudgeAgentName: judgeName
          },
          oauthSessionManager: {} as any,
          deps: {
            addJobEvent,
            getScenarioRunTraceRecords: () => [],
            selectScenarioIds: (config: any) => ({
              ...config,
              scenarios: [
                {
                  id: 's1',
                  prompt: 'test',
                  servers: [],
                  ...(hasSemanticChecks
                    ? { eval: { agent_assertions: [{ label: 'Valid', prompt: 'Valid?' }] } }
                    : {})
                }
              ]
            }),
            expandConfigForAgents: (config: any) => config,
            resolveRunSelectedAgents: () => ['mini'],
            readLibraries: () => ({
              agents: {
                mini: { provider: 'openai', model: 'gpt-5-mini' },
                browser: { type: 'browser', provider: 'chatgpt', url: 'https://chatgpt.com' }
              },
              servers: {},
              scenarios: {}
            }),
            pkgVersion: 'test'
          } as any
        });

        expect(result.status).toBe(hasSemanticChecks ? 'error' : 'completed');
        expect(runAllMock).toHaveBeenCalledTimes(hasSemanticChecks ? 0 : 1);
        if (!hasSemanticChecks) expect(runAllMock.mock.calls[0][1].evaluationJudge).toBeUndefined();
      } finally {
        cleanupFixtureRoot(fixture.root);
      }
    }
  );
});
