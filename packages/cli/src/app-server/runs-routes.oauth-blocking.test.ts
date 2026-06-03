import { describe, expect, it, vi } from 'vitest';
import { advanceQueue } from './run-queue-domain.js';
import { OAuthAuthorizationRequiredError } from './oauth-session-manager.js';
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

describe('queue OAuth blocking', () => {
  it('blocks queued job when OAuth is still required', async () => {
    const fixture = createOauthEvalFixture();
    const job = createQueuedJob(fixture.configPath);
    const events: Array<{ jobId: string; type: string; message?: string }> = [];

    try {
      await advanceQueue(
        new Map([[job.id, job]]),
        createRunQueueState({ queue: [job.id] }),
        {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root
        } as any,
        {
          ensureServersAuthorized: vi.fn().mockResolvedValue({
            servers: [{ serverName: 'oauth-server', status: 'auth_required' }],
            allReady: false
          })
        } as any,
        makeDeps(events) as any,
        { hostHeader: 'localhost' }
      );

      expect(job.status).toBe('blocked_auth');
      expect(job.blockedAuthServers).toEqual(['oauth-server']);
      expect(events.some((event) => event.type === 'oauth_required')).toBe(true);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('auto-refresh-ready path does not block and emits OAuth readiness log', async () => {
    const fixture = createOauthEvalFixture();
    const job = createQueuedJob(fixture.configPath);
    const events: Array<{ jobId: string; type: string; message?: string }> = [];

    try {
      await advanceQueue(
        new Map([[job.id, job]]),
        createRunQueueState({ queue: [job.id] }),
        {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root
        } as any,
        {
          ensureServersAuthorized: vi.fn().mockResolvedValue({
            servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'refreshed' }],
            allReady: true
          }),
          getAuthHeadersForServers: vi.fn().mockRejectedValue(new Error('stop test run'))
        } as any,
        makeDeps(events) as any,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events.some((event) => event.type === 'oauth_required')).toBe(false);
      expect(
        events.some(
          (event) =>
            event.type === 'log' &&
            (event.message ?? '').includes('OAuth credentials ready for queued run: oauth-server')
        )
      ).toBe(true);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('resume unblocks queue after OAuth becomes ready', async () => {
    const fixture = createOauthEvalFixture();
    const job = createQueuedJob(fixture.configPath);
    const jobs = new Map([[job.id, job]]);
    const runQueueState = createRunQueueState({ queue: [job.id] });
    const events: Array<{ jobId: string; type: string; message?: string }> = [];
    const oauthSessionManager = {
      ensureServersAuthorized: vi
        .fn()
        .mockResolvedValueOnce({
          servers: [{ serverName: 'oauth-server', status: 'auth_required' }],
          allReady: false
        })
        .mockResolvedValueOnce({
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
      await advanceQueue(jobs, runQueueState, settings, oauthSessionManager, makeDeps(events) as any, {
        hostHeader: 'localhost'
      });
      expect(job.status).toBe('blocked_auth');

      await advanceQueue(jobs, runQueueState, settings, oauthSessionManager, makeDeps(events) as any, {
        hostHeader: 'localhost',
        retryBlockedAuth: true
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events.filter((event) => event.type === 'started').length).toBeGreaterThan(0);
      expect(events.filter((event) => event.type === 'oauth_required')).toHaveLength(1);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('emits a retry log when OAuth retry still blocks on the same servers', async () => {
    const fixture = createOauthEvalFixture();
    const job = createQueuedJob(fixture.configPath);
    job.status = 'blocked_auth';
    job.blockedAuthServers = ['oauth-server'];
    const jobs = new Map([[job.id, job]]);
    const runQueueState = createRunQueueState({ queue: [job.id] });
    const events: Array<{ jobId: string; type: string; message?: string }> = [];

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
            servers: [{ serverName: 'oauth-server', status: 'auth_required' }],
            allReady: false
          })
        } as any,
        makeDeps(events) as any,
        { hostHeader: 'localhost', retryBlockedAuth: true }
      );

      expect(job.status).toBe('blocked_auth');
      expect(
        events.some(
          (event) =>
            event.type === 'log' &&
            (event.message ?? '').includes('OAuth retry attempted; still waiting')
        )
      ).toBe(true);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('re-queues OAuthAuthorizationRequiredError jobs even when detail server names are missing', async () => {
    const fixture = createOauthEvalFixture();
    const job = createQueuedJob(fixture.configPath);
    const jobs = new Map([[job.id, job]]);
    const runQueueState = createRunQueueState({ queue: [job.id] });
    const events: Array<{ jobId: string; type: string; message?: string }> = [];

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
            servers: [{ serverName: 'oauth-server', status: 'ready' }],
            allReady: true
          }),
          getAuthHeadersForServers: vi.fn().mockRejectedValue(
            new OAuthAuthorizationRequiredError([
              { serverName: null as any, message: 'OAuth login required' }
            ])
          )
        } as any,
        makeDeps(events) as any,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(job.status).toBe('blocked_auth');
      expect(job.blockedAuthServers).toEqual(['oauth-server']);
      expect(runQueueState.queue).toContain(job.id);
      expect(events.some((event) => event.type === 'oauth_required')).toBe(true);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('prunes older admission-error jobs and emits one cleanup queue event after admission failure', async () => {
    const fixture = createOauthEvalFixture();

    const staleErroredJob: any = {
      id: 'old-error-job',
      status: 'error',
      clients: new Set(),
      events: [
        {
          type: 'error',
          ts: new Date(Date.now() - 31 * 60_000).toISOString(),
          payload: { message: 'old error' }
        }
      ],
      abortController: new AbortController(),
      runParams: {
        configPath: fixture.configPath,
        runsPerScenario: 1,
        scenarioIds: null,
        requestedAgents: null,
        runNote: null,
        serverOverrideAll: null,
        scenarioServerOverrides: null
      }
    };
    const job = createQueuedJob(fixture.configPath);
    job.runParams.serverOverrideAll = ['missing-server'];
    const jobs = new Map([
      [staleErroredJob.id, staleErroredJob],
      [job.id, job]
    ]);
    const runQueueState = createRunQueueState({ queue: [job.id] });
    const queueEvents: any[] = [];
    const queueClient = {
      destroyed: false,
      writableEnded: false
    } as any;

    try {
      runQueueState.clients.add(queueClient);
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
          ensureServersAuthorized: vi.fn()
        } as any,
        makeRunsRouteDeps({
          sendSseEvent: (_target: any, event: any) => {
            queueEvents.push(event);
          }
        }) as any,
        { hostHeader: 'localhost' }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(jobs.has('old-error-job')).toBe(false);
      expect(job.status).toBe('error');
      expect(queueEvents.filter((event) => event.type === 'queue_event')).toHaveLength(2);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('keeps a stopped job stopped when admission fails after user stop', async () => {
    const fixture = createOauthEvalFixture();
    const job = createQueuedJob(fixture.configPath);
    const jobs = new Map([[job.id, job]]);
    const runQueueState = createRunQueueState({ queue: [job.id], admittingJobIds: new Set([job.id]) });
    const events: Array<{ jobId: string; type: string; message?: string }> = [];
    job.status = 'stopped';

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
          ensureServersAuthorized: vi.fn().mockRejectedValue(new Error('oauth check failed'))
        } as any,
        makeDeps(events) as any,
        { hostHeader: 'localhost', retryBlockedAuth: true }
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(job.status).toBe('stopped');
      expect(events.some((event) => event.type === 'error')).toBe(false);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });
});
