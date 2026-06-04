import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppRouteDeps, AppRouteRequestContext } from './app-context.js';
import { emitQueueEvent, buildQueueState, closeJobClients } from './run-queue-events.js';
import { admitQueuedJob, executeRunJob, resolveOAuthServersForJob } from './run-queue-executor.js';
import {
  createRunQueueState,
  currentWorkerUsage,
  type ExecutionOutcome,
  type QueueAdvanceOptions,
  type RunJob,
  type RunParams,
  type RunQueueState
} from './run-queue-state.js';
import type { OAuthSessionManager } from './oauth-session-manager.js';

export type QueueServiceDeps = Pick<
  AppRouteDeps,
  | 'addJobEvent'
  | 'sendSseEvent'
  | 'getScenarioRunTraceRecords'
  | 'selectScenarioIds'
  | 'expandConfigForAgents'
  | 'resolveRunSelectedAgents'
  | 'readLibraries'
  | 'pkgVersion'
>;

export type EnqueueResult = { jobId: string; queued?: boolean; position?: number };

export interface RunQueueService {
  jobs: Map<string, RunJob>;
  state: RunQueueState;
  enqueueRun(runParams: RunParams, options?: { hostHeader?: string }): EnqueueResult;
  stopJob(jobId: string, options?: { hostHeader?: string }): { ok: boolean; status: string } | null;
  removeQueuedJob(
    jobId: string,
    options?: { hostHeader?: string }
  ): { ok: true; jobId: string; status: 'stopped' } | { error: string; statusCode: number } | null;
  resumeBlockedJobs(options?: { hostHeader?: string }): void;
  getQueueState(): ReturnType<typeof buildQueueState>;
  subscribeQueue(req: IncomingMessage, res: ServerResponse): void;
  advance(options?: QueueAdvanceOptions): Promise<void>;
  setWorkerCount(workerCount: number, options?: { hostHeader?: string }): void;
  closeSubscribers(): void;
}

export function createRunQueueService(params: {
  settings: AppRouteRequestContext['settings'];
  oauthSessionManager: OAuthSessionManager;
  deps: QueueServiceDeps;
  jobs?: Map<string, RunJob>;
  state?: RunQueueState;
}): RunQueueService {
  const jobs = params.jobs ?? new Map<string, RunJob>();
  const state = params.state ?? createRunQueueState(params.settings.defaultQueueWorkers);
  const { settings, oauthSessionManager, deps } = params;

  function emit(): void {
    emitQueueEvent(jobs, state, deps.sendSseEvent);
  }

  function addStopEvent(job: RunJob, message: string): void {
    deps.addJobEvent(job, {
      type: 'error',
      ts: new Date().toISOString(),
      payload: { message }
    });
  }

  function stopQueuedJob(job: RunJob, message = 'Run stopped before it started'): void {
    const idx = state.queue.indexOf(job.id);
    if (idx !== -1) state.queue.splice(idx, 1);
    state.admittingJobIds.delete(job.id);
    state.blockedJobIds.delete(job.id);
    job.status = 'stopped';
    addStopEvent(job, message);
    closeJobClients(job);
  }

  function shouldStartQueuedJobImmediately(jobId: string): boolean {
    if (currentWorkerUsage(state) >= state.queueWorkerCount) return false;
    for (const queuedJobId of state.queue) {
      if (queuedJobId === jobId) return true;
      const queuedJob = jobs.get(queuedJobId);
      if (queuedJob?.status === 'queued' && !state.admittingJobIds.has(queuedJobId)) {
        return false;
      }
    }
    return false;
  }

  function pruneOldJobs(): void {
    const maxAgeMs = 30 * 60_000;
    const now = Date.now();
    const activeIds = new Set([
      ...state.activeJobIds,
      ...state.admittingJobIds,
      ...state.blockedJobIds,
      ...state.queue
    ]);
    for (const [id, job] of jobs) {
      if (activeIds.has(id)) continue;
      if (job.status !== 'completed' && job.status !== 'error' && job.status !== 'stopped')
        continue;
      const lastEvent = job.events[job.events.length - 1];
      if (!lastEvent) continue;
      if (now - new Date(lastEvent.ts).getTime() > maxAgeMs) {
        jobs.delete(id);
      }
    }
  }

  function finalizeClaimedJobError(job: RunJob, error: unknown): void {
    state.admittingJobIds.delete(job.id);
    state.blockedJobIds.delete(job.id);
    const queueIndex = state.queue.indexOf(job.id);
    if (queueIndex !== -1) {
      state.queue.splice(queueIndex, 1);
    }
    if (job.status !== 'stopped') {
      job.status = 'error';
      deps.addJobEvent(job, {
        type: 'error',
        ts: new Date().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
    closeJobClients(job);
    pruneOldJobs();
  }

  async function handleExecutionOutcome(
    job: RunJob,
    outcome: ExecutionOutcome,
    options?: { hostHeader?: string }
  ): Promise<void> {
    state.activeJobIds.delete(job.id);
    state.admittingJobIds.delete(job.id);
    if (outcome.status === 'blocked_auth') {
      job.blockedAuthServers = outcome.blockedServers;
      job.status = 'blocked_auth';
      state.blockedJobIds.add(job.id);
      if (!state.queue.includes(job.id)) {
        state.queue.unshift(job.id);
      }
      deps.addJobEvent(job, {
        type: 'oauth_required',
        ts: new Date().toISOString(),
        payload: {
          jobId: job.id,
          servers: outcome.blockedServers,
          message: `OAuth login required for server(s): ${outcome.blockedServers.join(', ')}.`
        }
      });
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
      return;
    }
    state.blockedJobIds.delete(job.id);
    job.status = outcome.status;
    closeJobClients(job);
    emit();
    pruneOldJobs();
    void advance({
      emitWhenIdle: true,
      hostHeader: options?.hostHeader,
      retryBlockedAuth: true
    });
  }

  async function executeRunningJob(job: RunJob, options?: { hostHeader?: string }): Promise<void> {
    const outcome = await executeRunJob({
      job,
      settings,
      oauthSessionManager,
      deps: deps as any
    });
    await handleExecutionOutcome(job, outcome, options);
  }

  async function processClaimedJob(job: RunJob, options?: QueueAdvanceOptions): Promise<void> {
    try {
      const admission = await admitQueuedJob({
        job,
        librariesDir: settings.librariesDir,
        oauthSessionManager,
        hostHeader: options?.hostHeader
      });

      if (job.status === 'stopped') {
        state.admittingJobIds.delete(job.id);
        state.blockedJobIds.delete(job.id);
        emit();
        void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
        return;
      }

      if (admission.status === 'blocked_auth') {
        const wasBlocked = job.status === 'blocked_auth';
        const prevBlockedServers = job.blockedAuthServers ?? [];
        const prevKey = [...prevBlockedServers].sort().join('|');
        const nextKey = [...admission.blockedServers].sort().join('|');
        const blockedSetChanged = prevKey !== nextKey;
        job.blockedAuthServers = admission.blockedServers;
        job.status = 'blocked_auth';
        state.admittingJobIds.delete(job.id);
        state.blockedJobIds.add(job.id);
        if (!wasBlocked || blockedSetChanged) {
          deps.addJobEvent(job, {
            type: 'oauth_required',
            ts: new Date().toISOString(),
            payload: {
              jobId: job.id,
              servers: admission.blockedServers,
              message: `OAuth login required for server(s): ${admission.blockedServers.join(', ')}.`
            }
          });
        } else if (options?.retryBlockedAuth) {
          deps.addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: `OAuth retry attempted; still waiting for server(s): ${admission.blockedServers.join(
                ', '
              )}`
            }
          });
        }
        void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
        return;
      }

      if (admission.readyServers.length > 0) {
        deps.addJobEvent(job, {
          type: 'log',
          ts: new Date().toISOString(),
          payload: {
            message: `OAuth credentials ready for queued run: ${admission.readyServers.join(', ')}`
          }
        });
      }

      state.admittingJobIds.delete(job.id);
      state.blockedJobIds.delete(job.id);
      const queueIndex = state.queue.indexOf(job.id);
      if (queueIndex !== -1) {
        state.queue.splice(queueIndex, 1);
      }
      job.status = 'running';
      state.activeJobIds.add(job.id);
      deps.addJobEvent(job, {
        type: 'started',
        ts: new Date().toISOString(),
        payload: {
          configPath: job.runParams.configPath,
          runsPerScenario: job.runParams.runsPerScenario,
          scenarioId: job.runParams.scenarioId ?? null,
          scenarioIds: job.runParams.scenarioIds ?? null,
          agents: job.runParams.requestedAgents ?? null,
          runNote: job.runParams.runNote ?? null,
          serverOverrideAll: job.runParams.serverOverrideAll ?? null,
          scenarioServerOverrides: job.runParams.scenarioServerOverrides ?? null
        }
      });
      emit();
      void executeRunningJob(job, { hostHeader: options?.hostHeader });
    } catch (error) {
      finalizeClaimedJobError(job, error);
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
    }
  }

  async function advance(options?: QueueAdvanceOptions): Promise<void> {
    if (state.isAdvancingQueue) {
      state.needsAdvanceQueue = true;
      if (options?.emitWhenIdle) emit();
      return;
    }
    state.isAdvancingQueue = true;
    state.needsAdvanceQueue = false;
    let queueMutated = false;
    const claimedJobs: RunJob[] = [];
    const claimNextJob = (allowBlockedAuth: boolean): boolean => {
      for (let index = 0; index < state.queue.length; index += 1) {
        const nextId = state.queue[index];
        const nextJob = jobs.get(nextId);
        if (!nextJob) {
          state.queue.splice(index, 1);
          queueMutated = true;
          index -= 1;
          continue;
        }
        if (nextJob.status === 'stopped') {
          state.queue.splice(index, 1);
          state.admittingJobIds.delete(nextId);
          queueMutated = true;
          index -= 1;
          continue;
        }
        if (nextJob.status !== 'queued' && nextJob.status !== 'blocked_auth') {
          state.queue.splice(index, 1);
          queueMutated = true;
          index -= 1;
          continue;
        }
        if (nextJob.status === 'blocked_auth' && !allowBlockedAuth) {
          continue;
        }
        if (nextJob.status === 'queued' && currentWorkerUsage(state) >= state.queueWorkerCount) {
          continue;
        }
        if (state.admittingJobIds.has(nextId)) continue;
        if (nextJob.status === 'blocked_auth') {
          state.blockedJobIds.delete(nextId);
        }
        state.admittingJobIds.add(nextId);
        claimedJobs.push(nextJob);
        queueMutated = true;
        return true;
      }
      return false;
    };
    try {
      while (options?.retryBlockedAuth || currentWorkerUsage(state) < state.queueWorkerCount) {
        const claimedJob = claimNextJob(Boolean(options?.retryBlockedAuth));
        if (!claimedJob) break;
      }
      if (queueMutated || options?.emitWhenIdle) emit();
    } finally {
      state.isAdvancingQueue = false;
      const shouldAdvanceAgain = state.needsAdvanceQueue;
      state.needsAdvanceQueue = false;
      if (shouldAdvanceAgain) {
        void advance(options).catch((error) => {
          console.warn(
            `[mcplab] Failed to continue advancing run queue: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
    }
    for (const job of claimedJobs) {
      void processClaimedJob(job, options);
    }
  }

  return {
    jobs,
    state,
    enqueueRun(runParams: RunParams, options) {
      const jobId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const job: RunJob = {
        id: jobId,
        status: 'queued',
        events: [],
        clients: new Set(),
        abortController: new AbortController(),
        runParams
      };
      jobs.set(jobId, job);
      state.queue.push(jobId);
      const queuedPosition = state.queue.length;
      const shouldAttemptAdvance = currentWorkerUsage(state) < state.queueWorkerCount;
      const shouldStartImmediately = shouldStartQueuedJobImmediately(jobId);

      if (!shouldStartImmediately) {
        deps.addJobEvent(job, {
          type: 'queued',
          ts: new Date().toISOString(),
          payload: {
            configPath: runParams.configPath,
            runsPerScenario: runParams.runsPerScenario,
            scenarioId: runParams.scenarioId ?? null,
            scenarioIds: runParams.scenarioIds ?? null,
            agents: runParams.requestedAgents ?? null,
            runNote: runParams.runNote ?? null,
            serverOverrideAll: runParams.serverOverrideAll ?? null,
            scenarioServerOverrides: runParams.scenarioServerOverrides ?? null,
            position: queuedPosition
          }
        });
        emit();
        if (shouldAttemptAdvance) {
          void advance({ hostHeader: options?.hostHeader });
        }
        return { jobId, queued: true, position: queuedPosition };
      }

      void advance({ hostHeader: options?.hostHeader });
      return { jobId };
    },
    stopJob(jobId, options) {
      const job = jobs.get(jobId);
      if (!job) return null;
      if (job.status === 'queued' || job.status === 'blocked_auth') {
        stopQueuedJob(job);
        void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
        return { ok: true, status: 'stopped' };
      }
      if (job.status !== 'running') {
        return { ok: true, status: job.status };
      }
      job.abortController.abort();
      job.status = 'stopped';
      return { ok: true, status: 'stopped' };
    },
    removeQueuedJob(jobId, options) {
      const job = jobs.get(jobId);
      if (!job) return null;
      if (state.activeJobIds.has(jobId)) {
        return {
          error: 'Cannot remove a running job. Use the /stop endpoint instead.',
          statusCode: 400
        };
      }
      if (job.status !== 'queued' && job.status !== 'blocked_auth') {
        return { error: 'Job is not queued', statusCode: 404 };
      }
      stopQueuedJob(job, 'Removed from queue by user');
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
      return { ok: true, jobId, status: 'stopped' };
    },
    resumeBlockedJobs(options) {
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader, retryBlockedAuth: true });
    },
    getQueueState() {
      return buildQueueState(jobs, state);
    },
    subscribeQueue(req, res) {
      if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      deps.sendSseEvent(res, {
        type: 'queue_event',
        ts: new Date().toISOString(),
        payload: { event: buildQueueState(jobs, state) }
      });
      state.clients.add(res);
      req.on('close', () => {
        state.clients.delete(res);
      });
    },
    advance,
    setWorkerCount(workerCount, options) {
      state.queueWorkerCount = workerCount;
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
    },
    closeSubscribers() {
      for (const client of state.clients) client.end();
      state.clients.clear();
    }
  };
}
