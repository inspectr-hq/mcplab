import { describe, expect, it, vi } from 'vitest';
import { advanceQueue } from './run-queue-domain.js';
import {
  cleanupFixtureRoot,
  createOauthEvalFixture,
  createQueuedJob,
  createRunQueueState,
  makeRunsRouteDeps
} from './runs-routes.test-helpers.js';

function makeDeps(eventSink: Array<{ jobId: string; type: string; message?: string }> = []) {
  return makeRunsRouteDeps({
    asJson: (res: any, _status: number, body: unknown) => {
      res.__body = body;
    },
    addJobEvent: (job: any, event: any) => {
      eventSink.push({
        jobId: job.id,
        type: event.type,
        message: String(event?.payload?.message ?? '')
      });
    },
    resolveRunSelectedAgents: () => ['mini']
  });
}

describe('queue OAuth concurrency', () => {
  it('skips stopped jobs without skipping the runnable job behind them', async () => {
    const fixture = createOauthEvalFixture();
    const events: Array<{ jobId: string; type: string; message?: string }> = [];
    const stoppedJob = createQueuedJob(fixture.configPath, 'job-1');
    stoppedJob.status = 'stopped';
    const runnableJob = createQueuedJob(fixture.configPath, 'job-2');
    const jobs = new Map([
      ['job-1', stoppedJob],
      ['job-2', runnableJob]
    ]);
    const runQueueState = createRunQueueState({ queue: ['job-1', 'job-2'] });

    try {
      await advanceQueue(
        jobs,
        runQueueState,
        {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root
        } as any,
        {
          ensureServersAuthorized: vi.fn().mockResolvedValue({
            servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
            allReady: true
          }),
          getAuthHeadersForServers: vi.fn().mockRejectedValue(new Error('stop test run'))
        } as any,
        makeDeps(events) as any,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runQueueState.queue).not.toContain('job-1');
      expect(events.some((event) => event.jobId === 'job-2' && event.type === 'started')).toBe(
        true
      );
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('re-runs queue advancement when another advance request arrives during OAuth checks', async () => {
    const fixture = createOauthEvalFixture();
    const events: Array<{ jobId: string; type: string; message?: string }> = [];
    const ensureDeferred = Promise.withResolvers<{
      servers: Array<{ serverName: string; status: 'ready'; debugState?: string }>;
      allReady: true;
    }>();
    const jobs = new Map([
      ['job-1', createQueuedJob(fixture.configPath, 'job-1')],
      ['job-2', createQueuedJob(fixture.configPath, 'job-2')]
    ]);
    const runQueueState = createRunQueueState({ queue: ['job-1', 'job-2'] });
    const oauthSessionManager = {
      ensureServersAuthorized: vi
        .fn()
        .mockReturnValueOnce(ensureDeferred.promise)
        .mockResolvedValue({
          servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
          allReady: true
        }),
      getAuthHeadersForServers: vi.fn().mockRejectedValue(new Error('stop test run'))
    } as any;

    try {
      const settings = {
        evalsDir: fixture.evalsDir,
        runsDir: fixture.runsDir,
        librariesDir: fixture.librariesDir,
        workspaceRoot: fixture.root,
        toolAnalysisResultsDir: fixture.root
      } as any;
      const deps = makeDeps(events) as any;
      const firstAdvance = advanceQueue(
        jobs,
        runQueueState,
        settings,
        oauthSessionManager,
        deps,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      const secondAdvance = advanceQueue(
        jobs,
        runQueueState,
        settings,
        oauthSessionManager,
        deps,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runQueueState.admittingJobIds.has('job-1')).toBe(true);
      expect(runQueueState.queue).toContain('job-2');
      expect(oauthSessionManager.ensureServersAuthorized).toHaveBeenCalledTimes(1);

      ensureDeferred.resolve({
        servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
        allReady: true
      });
      await firstAdvance;
      await secondAdvance;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(oauthSessionManager.ensureServersAuthorized).toHaveBeenCalledTimes(2);
      expect(runQueueState.queue).toHaveLength(0);
      expect(events.filter((event) => event.type === 'started')).toHaveLength(2);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('admits another worker while one OAuth authorization check is still pending', async () => {
    const fixture = createOauthEvalFixture();
    const events: Array<{ jobId: string; type: string; message?: string }> = [];
    const ensureDeferred = Promise.withResolvers<{
      servers: Array<{ serverName: string; status: 'ready'; debugState?: string }>;
      allReady: true;
    }>();
    const jobs = new Map([
      ['job-1', createQueuedJob(fixture.configPath, 'job-1')],
      ['job-2', createQueuedJob(fixture.configPath, 'job-2')]
    ]);
    const runQueueState = createRunQueueState({
      queue: ['job-1', 'job-2'],
      queueWorkerCount: 2
    });
    const oauthSessionManager = {
      ensureServersAuthorized: vi
        .fn()
        .mockReturnValueOnce(ensureDeferred.promise)
        .mockResolvedValueOnce({
          servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
          allReady: true
        }),
      getAuthHeadersForServers: vi.fn().mockRejectedValue(new Error('stop test run'))
    } as any;

    try {
      void advanceQueue(
        jobs,
        runQueueState,
        {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root
        } as any,
        oauthSessionManager,
        makeDeps(events) as any,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(oauthSessionManager.ensureServersAuthorized).toHaveBeenCalledTimes(2);
      expect(events.some((event) => event.jobId === 'job-2' && event.type === 'started')).toBe(
        true
      );
      expect(events.some((event) => event.jobId === 'job-1' && event.type === 'started')).toBe(
        false
      );

      ensureDeferred.resolve({
        servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
        allReady: true
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('preserves hostHeader when a completed job advances the next queued OAuth job', async () => {
    const fixture = createOauthEvalFixture();
    const events: Array<{ jobId: string; type: string; message?: string }> = [];
    const jobs = new Map([
      ['job-1', createQueuedJob(fixture.configPath, 'job-1')],
      ['job-2', createQueuedJob(fixture.configPath, 'job-2')]
    ]);
    const runQueueState = createRunQueueState({ queue: ['job-1', 'job-2'] });
    const oauthSessionManager = {
      ensureServersAuthorized: vi.fn().mockResolvedValue({
        servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
        allReady: true
      }),
      getAuthHeadersForServers: vi.fn().mockRejectedValue(new Error('stop test run'))
    } as any;

    try {
      await advanceQueue(
        jobs,
        runQueueState,
        {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root
        } as any,
        oauthSessionManager,
        makeDeps(events) as any,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(oauthSessionManager.ensureServersAuthorized).toHaveBeenCalledTimes(2);
      expect(oauthSessionManager.ensureServersAuthorized.mock.calls[0]?.[1]).toBe('localhost');
      expect(oauthSessionManager.ensureServersAuthorized.mock.calls[1]?.[1]).toBe('localhost');
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });
});
