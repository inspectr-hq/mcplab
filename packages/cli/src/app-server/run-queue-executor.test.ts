import { describe, expect, it } from 'vitest';
import { executeRunJob } from './run-queue-executor.js';
import { createQueuedJob, createOauthEvalFixture, cleanupFixtureRoot } from './runs-routes.test-helpers.js';

describe('executeRunJob', () => {
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
