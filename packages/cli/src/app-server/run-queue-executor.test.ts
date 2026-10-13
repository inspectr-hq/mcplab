import { describe, expect, it, vi } from 'vitest';
import { aggregateResults } from '@inspectr/mcplab-core';
const { runAllMock } = vi.hoisted(() => ({ runAllMock: vi.fn() }));
vi.mock('@inspectr/mcplab-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inspectr/mcplab-core')>()),
  runAll: runAllMock
}));
import { executeRunJob, getCompletedRunId } from './run-queue-executor.js';
import {
  createQueuedJob,
  createOauthEvalFixture,
  cleanupFixtureRoot
} from './runs-routes.test-helpers.js';

describe('executeRunJob', () => {
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
              scenarios: [{ id: 's1', prompt: 'hi', agent: 'mini', servers: [] }]
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

  it('uses the evaluation ID for grouped completion results', () => {
    expect(
      getCompletedRunId({ runParams: { evaluationRunId: 'evaluation-1' } } as any, 'execution-1')
    ).toBe('evaluation-1');
    expect(getCompletedRunId({ runParams: {} } as any, 'execution-1')).toBe('execution-1');
  });

  it('fails early when evaluation judge setting points to a missing agent', async () => {
    const fixture = createOauthEvalFixture();
    try {
      const job = createQueuedJob(fixture.configPath, 'job-bad-judge');
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
          evaluationJudgeAgentName: 'missing-judge'
        },
        oauthSessionManager: {} as any,
        deps: {
          addJobEvent,
          getScenarioRunTraceRecords: () => [],
          selectScenarioIds: (config: any) => config,
          expandConfigForAgents: (config: any) => config,
          resolveRunSelectedAgents: () => ['mini'],
          readLibraries: () => ({
            agents: { mini: { provider: 'openai', model: 'gpt-5-mini' } },
            servers: {},
            scenarios: {}
          }),
          pkgVersion: 'test'
        } as any
      });

      expect(result).toEqual({ status: 'error' });
      expect(job.events.some((event: any) => event.type === 'error')).toBe(true);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });
});
