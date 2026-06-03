import { describe, expect, it } from 'vitest';
import { handleRunsRoutes } from './runs-routes.js';
import {
  cleanupFixtureRoot,
  createOauthEvalFixture,
  createRunQueueServiceForTest,
  createRunQueueState,
  makeRunsRouteDeps
} from './runs-routes.test-helpers.js';

describe('run queue SSE endpoint', () => {
  it('streams initial queue_event and registers client', async () => {
    const writes: string[] = [];
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) {
        this.headers[key] = value;
      },
      write(chunk: string) {
        writes.push(chunk);
      },
      flushHeaders() {
        return undefined;
      }
    } as any;

    let closeHandler: (() => void) | undefined;
    const deps = makeRunsRouteDeps({
      sendSseEvent: (target: any, event: any) => {
        target.write(`event: ${event.type}\n`);
        target.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });
    const handled = await handleRunsRoutes({
      req: {
        url: '/api/runs/queue/events',
        headers: {},
        on: (event: string, cb: () => void) => {
          if (event === 'close') closeHandler = cb;
        }
      } as any,
      res,
      pathname: '/api/runs/queue/events',
      method: 'GET',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: createRunQueueServiceForTest({ deps }),
      oauthSessionManager: {} as any,
      deps: deps as any
    });

    expect(handled).toBe(true);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(writes.join('')).toContain('event: queue_event');
    closeHandler?.();
  });
});

describe('queue event emission', () => {
  function makeDeps(sseEvents: Array<{ target: any; event: any }>) {
    return makeRunsRouteDeps({
      asJson: (res: any, _status: number, body: any) => {
        res.__body = body;
      },
      sendSseEvent: (target: any, event: any) => {
        sseEvents.push({ target, event });
      }
    });
  }

  it('SSE endpoint sends initial queue_event to new client', async () => {
    const sseEvents: Array<{ target: any; event: any }> = [];
    const deps = makeDeps(sseEvents) as any;
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) {
        this.headers[key] = value;
      },
      write() {
        return;
      },
      flushHeaders() {
        return undefined;
      }
    } as any;

    await handleRunsRoutes({
      req: { url: '/api/runs/queue/events', headers: {}, on: () => undefined } as any,
      res,
      pathname: '/api/runs/queue/events',
      method: 'GET',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: createRunQueueServiceForTest({ deps }),
      oauthSessionManager: {} as any,
      deps
    });

    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0].event.payload.event).toMatchObject({
      active: null,
      active_jobs: [],
      admitting_jobs: [],
      queued: []
    });
  });

  it('queue payload includes active_jobs alongside backward-compatible active', async () => {
    const res = { __body: null } as any;
    const runningJob = {
      id: 'job-1',
      status: 'running',
      clients: new Set(),
      events: [],
      abortController: new AbortController(),
      runParams: {
        configPath: '/tmp/eval.yaml',
        runsPerScenario: 1,
        scenarioIds: undefined,
        requestedAgents: undefined,
        runNote: undefined,
        serverOverrideAll: undefined,
        scenarioServerOverrides: undefined
      }
    } as any;
    const queuedJob = { ...runningJob, id: 'job-2', status: 'queued' } as any;

    await handleRunsRoutes({
      req: { url: '/api/runs/queue', headers: {}, on: () => undefined } as any,
      res,
      pathname: '/api/runs/queue',
      method: 'GET',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp',
        defaultQueueWorkers: 1
      } as any,
      runQueueService: createRunQueueServiceForTest({
        jobs: new Map([
          ['job-1', runningJob],
          ['job-2', queuedJob]
        ]),
        runQueueState: createRunQueueState({
          queue: ['job-2'],
          activeJobIds: new Set(['job-1'])
        })
      }),
      oauthSessionManager: {} as any,
      deps: makeDeps([]) as any
    });

    expect(res.__body).toMatchObject({
      active: expect.objectContaining({ jobId: 'job-1' }),
      active_jobs: [expect.objectContaining({ jobId: 'job-1' })],
      admitting_jobs: [],
      queued: [expect.objectContaining({ jobId: 'job-2' })]
    });
  });

  it('queue payload keeps retrying blocked jobs only in admitting_jobs', async () => {
    const res = { __body: null } as any;
    const retryingJob = {
      id: 'job-3',
      status: 'blocked_auth',
      blockedAuthServers: ['oauth-server'],
      clients: new Set(),
      events: [],
      abortController: new AbortController(),
      runParams: {
        configPath: '/tmp/eval.yaml',
        runsPerScenario: 1,
        scenarioIds: undefined,
        requestedAgents: undefined,
        runNote: undefined,
        serverOverrideAll: undefined,
        scenarioServerOverrides: undefined
      }
    } as any;

    await handleRunsRoutes({
      req: { url: '/api/runs/queue', headers: {}, on: () => undefined } as any,
      res,
      pathname: '/api/runs/queue',
      method: 'GET',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp',
        defaultQueueWorkers: 1
      } as any,
      runQueueService: createRunQueueServiceForTest({
        jobs: new Map([['job-3', retryingJob]]),
        runQueueState: createRunQueueState({
          queue: ['job-3'],
          admittingJobIds: new Set(['job-3'])
        })
      }),
      oauthSessionManager: {} as any,
      deps: makeDeps([]) as any
    });

    expect(res.__body).toMatchObject({
      active: null,
      active_jobs: [],
      admitting_jobs: [expect.objectContaining({ jobId: 'job-3', status: 'blocked_auth' })],
      queued: []
    });
  });

  it('emitQueueEvent broadcasts to all registered SSE clients on stop', async () => {
    const sseEvents: Array<{ target: any; event: any }> = [];
    const deps = makeDeps(sseEvents) as any;
    const runQueueState = createRunQueueState();
    const runQueueService = createRunQueueServiceForTest({ runQueueState, deps });

    for (let i = 0; i < 2; i += 1) {
      const res = {
        statusCode: 0,
        headers: {} as Record<string, string>,
        setHeader(key: string, value: string) {
          this.headers[key] = value;
        },
        write() {
          return;
        },
        flushHeaders() {
          return undefined;
        }
      } as any;
      await handleRunsRoutes({
        req: { url: '/api/runs/queue/events', headers: {}, on: () => undefined } as any,
        res,
        pathname: '/api/runs/queue/events',
        method: 'GET',
        settings: {
          evalsDir: '/tmp',
          runsDir: '/tmp',
          librariesDir: '/tmp',
          workspaceRoot: '/tmp',
          toolAnalysisResultsDir: '/tmp'
        } as any,
        runQueueService,
        oauthSessionManager: {} as any,
        deps
      });
    }

    sseEvents.length = 0;
    const jobId = 'test-job-1';
    const job: any = {
      id: jobId,
      status: 'queued',
      clients: new Set(),
      events: [],
      abortController: new AbortController(),
      runParams: {
        configPath: '/tmp/x.yaml',
        runsPerScenario: 1,
        scenarioIds: null,
        requestedAgents: null,
        runNote: null,
        serverOverrideAll: null,
        scenarioServerOverrides: null
      }
    };
    const jobs = new Map([[jobId, job]]);
    runQueueState.queue.push(jobId);
    const queueServiceWithJob = createRunQueueServiceForTest({ jobs, runQueueState, deps });

    const stopRes = { __body: null, statusCode: 0 } as any;
    stopRes.setHeader = () => undefined;
    stopRes.write = () => undefined;
    stopRes.end = () => undefined;

    await handleRunsRoutes({
      req: { url: `/api/runs/jobs/${jobId}/stop`, headers: {}, on: () => undefined } as any,
      res: stopRes,
      pathname: `/api/runs/jobs/${jobId}/stop`,
      method: 'POST',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: queueServiceWithJob,
      oauthSessionManager: {} as any,
      deps: {
        ...deps,
        asJson: (_r: any, _s: number, body: any) => {
          stopRes.__body = body;
        }
      } as any
    });

    expect(stopRes.__body).toMatchObject({ ok: true, status: 'stopped' });
    expect(sseEvents).toHaveLength(2);
    expect(runQueueState.queue).toHaveLength(0);
  });

  it('stop removes blocked_auth jobs from the queue', async () => {
    const jobId = 'blocked-job-1';
    const job: any = {
      id: jobId,
      status: 'blocked_auth',
      blockedAuthServers: ['oauth-server'],
      clients: new Set(),
      events: [],
      abortController: new AbortController(),
      runParams: {
        configPath: '/tmp/x.yaml',
        runsPerScenario: 1,
        scenarioIds: null,
        requestedAgents: null,
        runNote: null,
        serverOverrideAll: null,
        scenarioServerOverrides: null
      }
    };
    const res = { __body: null } as any;

    await handleRunsRoutes({
      req: { url: `/api/runs/jobs/${jobId}/stop`, headers: {}, on: () => undefined } as any,
      res,
      pathname: `/api/runs/jobs/${jobId}/stop`,
      method: 'POST',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService: createRunQueueServiceForTest({
        jobs: new Map([[jobId, job]]),
        runQueueState: createRunQueueState({ queue: [jobId] }),
        deps: makeDeps([])
      }),
      oauthSessionManager: {} as any,
      deps: makeDeps([]) as any
    });

    expect(res.__body).toMatchObject({ ok: true, status: 'stopped' });
  });

  it('starts a newly submitted job even when blocked_auth jobs are ahead in the queue', async () => {
    const fixture = createOauthEvalFixture();
    const blockedJob: any = {
      id: 'blocked-job-1',
      status: 'blocked_auth',
      blockedAuthServers: ['oauth-server'],
      clients: new Set(),
      events: [],
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
    const jobs = new Map([[blockedJob.id, blockedJob]]);
    const runQueueState = createRunQueueState({
      queue: [blockedJob.id],
      queueWorkerCount: 2
    });
    const events: Array<{ jobId: string; type: string }> = [];
    const res = { __body: null } as any;

    try {
      await handleRunsRoutes({
        req: { url: '/api/runs', headers: { host: 'localhost' }, on: () => undefined } as any,
        res,
        pathname: '/api/runs',
        method: 'POST',
        settings: {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root,
          defaultQueueWorkers: 2
        } as any,
        runQueueService: createRunQueueServiceForTest({
          jobs,
          runQueueState,
          settings: {
            evalsDir: fixture.evalsDir,
            runsDir: fixture.runsDir,
            librariesDir: fixture.librariesDir,
            workspaceRoot: fixture.root,
            toolAnalysisResultsDir: fixture.root,
            defaultQueueWorkers: 2
          },
          oauthSessionManager: {
            ensureServersAuthorized: async () => ({
              servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
              allReady: true
            }),
            getAuthHeadersForServers: async () => {
              throw new Error('stop test run');
            }
          },
          deps: makeRunsRouteDeps({
            parseBody: async () => ({
              configPath: fixture.configPath,
              runsPerScenario: 1
            }),
            asJson: (target: any, _status: number, body: any) => {
              target.__body = body;
            },
            addJobEvent: (job: any, event: any) => {
              events.push({ jobId: job.id, type: event.type });
            },
            resolveRunSelectedAgents: () => ['mini']
          })
        }),
        oauthSessionManager: {
          ensureServersAuthorized: async () => ({
            servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
            allReady: true
          }),
          getAuthHeadersForServers: async () => {
            throw new Error('stop test run');
          }
        } as any,
        deps: makeRunsRouteDeps({
          parseBody: async () => ({
            configPath: fixture.configPath,
            runsPerScenario: 1
          }),
          asJson: (target: any, _status: number, body: any) => {
            target.__body = body;
          },
          addJobEvent: (job: any, event: any) => {
            events.push({ jobId: job.id, type: event.type });
          },
          resolveRunSelectedAgents: () => ['mini']
        }) as any
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(res.__body.jobId).toBeTypeOf('string');
      expect(res.__body.queued).toBeUndefined();
      expect(
        events.some((event) => event.jobId === res.__body.jobId && event.type === 'started')
      ).toBe(true);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('does not admit a third queued job while two blocked_auth jobs still hold both worker slots', async () => {
    const fixture = createOauthEvalFixture();
    const blockedJobA: any = {
      id: 'blocked-job-a',
      status: 'blocked_auth',
      blockedAuthServers: ['oauth-server'],
      clients: new Set(),
      events: [],
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
    const blockedJobB = { ...blockedJobA, id: 'blocked-job-b' };
    const jobs = new Map([
      [blockedJobA.id, blockedJobA],
      [blockedJobB.id, blockedJobB]
    ]);
    const runQueueState = createRunQueueState({
      queue: [blockedJobA.id, blockedJobB.id],
      blockedJobIds: new Set([blockedJobA.id, blockedJobB.id]),
      queueWorkerCount: 2
    });
    const events: Array<{ jobId: string; type: string }> = [];
    const res = { __body: null } as any;

    try {
      await handleRunsRoutes({
        req: { url: '/api/runs', headers: { host: 'localhost' }, on: () => undefined } as any,
        res,
        pathname: '/api/runs',
        method: 'POST',
        settings: {
          evalsDir: fixture.evalsDir,
          runsDir: fixture.runsDir,
          librariesDir: fixture.librariesDir,
          workspaceRoot: fixture.root,
          toolAnalysisResultsDir: fixture.root,
          defaultQueueWorkers: 2
        } as any,
        runQueueService: createRunQueueServiceForTest({
          jobs,
          runQueueState,
          settings: {
            evalsDir: fixture.evalsDir,
            runsDir: fixture.runsDir,
            librariesDir: fixture.librariesDir,
            workspaceRoot: fixture.root,
            toolAnalysisResultsDir: fixture.root,
            defaultQueueWorkers: 2
          },
          oauthSessionManager: {
            ensureServersAuthorized: async () => ({
              servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
              allReady: true
            }),
            getAuthHeadersForServers: async () => {
              throw new Error('stop test run');
            }
          },
          deps: makeRunsRouteDeps({
            parseBody: async () => ({
              configPath: fixture.configPath,
              runsPerScenario: 1
            }),
            asJson: (target: any, _status: number, body: any) => {
              target.__body = body;
            },
            addJobEvent: (job: any, event: any) => {
              events.push({ jobId: job.id, type: event.type });
            }
          })
        }),
        oauthSessionManager: {
          ensureServersAuthorized: async () => ({
            servers: [{ serverName: 'oauth-server', status: 'ready', debugState: 'reused' }],
            allReady: true
          }),
          getAuthHeadersForServers: async () => {
            throw new Error('stop test run');
          }
        } as any,
        deps: makeRunsRouteDeps({
          parseBody: async () => ({
            configPath: fixture.configPath,
            runsPerScenario: 1
          }),
          asJson: (target: any, _status: number, body: any) => {
            target.__body = body;
          },
          addJobEvent: (job: any, event: any) => {
            events.push({ jobId: job.id, type: event.type });
          }
        }) as any
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(res.__body).toMatchObject({ queued: true, position: 3 });
      expect(events.some((event) => event.type === 'started')).toBe(false);
    } finally {
      cleanupFixtureRoot(fixture.root);
    }
  });

  it('client removed from SSE clients set on request close', async () => {
    const sseEvents: Array<{ target: any; event: any }> = [];
    const runQueueState = createRunQueueState();
    const deps = makeDeps(sseEvents) as any;
    const runQueueService = createRunQueueServiceForTest({ runQueueState, deps });
    let closeHandler: (() => void) | undefined;
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) {
        this.headers[key] = value;
      },
      write() {
        return;
      },
      flushHeaders() {
        return undefined;
      }
    } as any;

    await handleRunsRoutes({
      req: {
        url: '/api/runs/queue/events',
        headers: {},
        on: (evt: string, cb: () => void) => {
          if (evt === 'close') closeHandler = cb;
        }
      } as any,
      res,
      pathname: '/api/runs/queue/events',
      method: 'GET',
      settings: {
        evalsDir: '/tmp',
        runsDir: '/tmp',
        librariesDir: '/tmp',
        workspaceRoot: '/tmp',
        toolAnalysisResultsDir: '/tmp'
      } as any,
      runQueueService,
      oauthSessionManager: {} as any,
      deps
    });

    closeHandler?.();
    expect(runQueueState.clients.size).toBe(0);
  });
});
