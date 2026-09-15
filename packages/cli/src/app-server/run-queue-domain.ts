import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
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
import type { RoverSocketMessage } from './rover-connection.js';
import { ROVER_LEASE_REQUEUE_REASONS, ROVER_LEASE_TERMINAL_REASONS, upsertQueueChildProgress } from '@inspectr/mcplab-core';
import { appendExecutionEvent, readExecutionEvents } from './execution-journal.js';
import { recordEvaluationTerminalExecution } from './evaluation-journal-writer.js';
import { projectEvaluationJournal } from './evaluation-journal-projection.js';

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
  | 'getRunResults'
>;

export type EnqueueResult = { jobId: string; queued?: boolean; position?: number };

export type RoverAssignmentWorker = {
  connectionId: string;
  provider: string;
  providerRevision?: string;
  capabilities?: string[];
};

export interface RunQueueService {
  jobs: Map<string, RunJob>;
  state: RunQueueState;
  enqueueRun(runParams: RunParams, options?: { hostHeader?: string }): EnqueueResult;
  stopJob(jobId: string, options?: { hostHeader?: string }): { ok: boolean; status: string } | null;
  stopEvaluationRun(
    evaluationRunId: string,
    options?: { hostHeader?: string }
  ): { ok: true; stopped: number } | null;
  removeEvaluationRun(
    evaluationRunId: string,
    options?: { hostHeader?: string }
  ): { ok: true; removed: number } | { error: string; statusCode: number } | null;
  removeQueuedJob(
    jobId: string,
    options?: { hostHeader?: string }
  ): { ok: true; jobId: string; status: 'stopped' } | { error: string; statusCode: number } | null;
  resumeBlockedJobs(options?: { hostHeader?: string }): void;
  getQueueState(): ReturnType<typeof buildQueueState>;
  getWaitingRoverJobs(provider: string): Array<{ jobId: string; evaluationName?: string; provider: string; position: number }>;
  subscribeQueue(req: IncomingMessage, res: ServerResponse): void;
  advance(options?: QueueAdvanceOptions): Promise<void>;
  setWorkerCount(workerCount: number, options?: { hostHeader?: string }): void;
  closeSubscribers(): void;
  assignRoverJob(
    provider: string,
    send: (message: RoverSocketMessage) => boolean,
    worker?: RoverAssignmentWorker
  ): RunJob | null;
  rebindRoverLeases(provider: string, worker: RoverAssignmentWorker): void;
  pauseRoverJob(jobId: string, connectionId?: string): void;
  resumeRoverJob(jobId: string): boolean;
  completeRoverJob(jobId: string, payload?: Record<string, unknown>): void;
  stopRoverScenario(
    jobId: string,
    scenarioId: string
  ): { ok: true; status: 'stopped' } | { error: string; statusCode: number } | null;
  stopScenario(
    jobId: string,
    scenarioId: string,
    agentName?: string
  ): { ok: true; status: 'stopped' } | { error: string; statusCode: number } | null;
  handleRoverMessage(
    message: RoverSocketMessage,
    provider: string,
    send: (message: RoverSocketMessage) => boolean,
    worker?: RoverAssignmentWorker
  ): string | null;
}

export function createRunQueueService(params: {
  settings: AppRouteRequestContext['settings'];
  oauthSessionManager: OAuthSessionManager;
  deps: QueueServiceDeps;
  jobs?: Map<string, RunJob>;
  state?: RunQueueState;
  sendRoverMessage?: (message: RoverSocketMessage) => boolean;
  assignRoverJob?: (provider: string, worker?: RoverAssignmentWorker) => RunJob | null;
  onRoverJobReleased?: (provider: string) => void;
}): RunQueueService {
  const jobs = params.jobs ?? new Map<string, RunJob>();
  const state = params.state ?? createRunQueueState(params.settings.defaultQueueWorkers);
  const { settings, oauthSessionManager, deps } = params;
  const leaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function emit(): void {
    emitQueueEvent(jobs, state, deps.sendSseEvent);
  }

  function scheduleLeaseExpiry(job: RunJob): void {
    const lease = job.roverLease;
    if (!lease) return;
    const existing = leaseTimers.get(job.id);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, Date.parse(lease.expiresAt) - Date.now());
    leaseTimers.set(job.id, setTimeout(() => {
      leaseTimers.delete(job.id);
      const current = jobs.get(job.id)?.roverLease;
      if (!current || current.leaseId !== lease.leaseId || Date.parse(current.expiresAt) > Date.now()) return;
      if (job.status === 'running' || job.status === 'paused_rover') {
        finalizeRoverJob(job, { kind: 'requeue', reason: 'lease_expired' });
        return;
      }
      deps.addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: 'Rover assignment lease expired and was requeued.' }
      });
      emit();
      if (job.runParams.executionType === 'rover') params.onRoverJobReleased?.(job.runParams.roverAgent.provider);
    }, delay));
  }

  function addStopEvent(job: RunJob, message: string): void {
    deps.addJobEvent(job, {
      type: 'error',
      ts: new Date().toISOString(),
      payload: { message }
    });
  }

  function markEvaluationStopped(job: RunJob, reason: string): void {
    const evaluationRunId = job.runParams.evaluationRunId;
    if (!evaluationRunId) return;
    appendExecutionEvent(join(settings.runsDir, evaluationRunId), {
      eventId: `evaluation-stopped-${job.id}`,
      type: 'evaluation_stopped',
      ts: new Date().toISOString(),
      executionId: job.id,
      evaluationRunId,
      reason
    });
    projectEvaluationJournal({
      runsDir: settings.runsDir,
      evaluationRunId,
      evaluationName: job.runParams.evaluationName,
      executionStatus: 'stopped'
    });
  }

  function recordTerminalExecution(job: RunJob, status: 'error' | 'stopped', reason: string): void {
    const evaluationRunId = job.runParams.evaluationRunId;
    if (!evaluationRunId) return;
    recordEvaluationTerminalExecution({
      runsDir: settings.runsDir,
      evaluationRunId,
      evaluationName: job.runParams.evaluationName,
      executionId: job.id,
      status,
      reason
    });
  }

  type RoverFinalDisposition =
    | { kind: 'completed'; payload?: Record<string, unknown> }
    | { kind: 'error'; reason: string }
    | { kind: 'stopped'; reason: string }
    | { kind: 'requeue'; reason: string };

  function finalizeRoverJob(job: RunJob, disposition: RoverFinalDisposition): boolean {
    if (job.runParams.executionType !== 'rover') return false;
    state.activeJobIds.delete(job.id);
    state.admittingJobIds.delete(job.id);
    state.blockedJobIds.delete(job.id);
    const timer = leaseTimers.get(job.id);
    if (timer) clearTimeout(timer);
    leaseTimers.delete(job.id);
    job.roverLease = undefined;
    const queueIndex = state.queue.indexOf(job.id);
    if (queueIndex !== -1) state.queue.splice(queueIndex, 1);

    if (disposition.kind === 'requeue') {
      job.status = 'waiting_for_rover';
      state.queue.unshift(job.id);
      deps.addJobEvent(job, { type: 'log', ts: new Date().toISOString(), payload: { message: `Rover assignment requeued: ${disposition.reason}` } });
    } else if (disposition.kind === 'completed') {
      job.status = 'completed';
      deps.addJobEvent(job, { type: 'completed', ts: new Date().toISOString(), payload: { ...disposition.payload, executionType: 'rover' } });
      closeJobClients(job);
    } else if (disposition.kind === 'stopped') {
      job.status = 'stopped';
      addStopEvent(job, disposition.reason);
      markEvaluationStopped(job, disposition.reason);
      closeJobClients(job);
    } else {
      job.status = 'error';
      deps.addJobEvent(job, { type: 'error', ts: new Date().toISOString(), payload: { message: `Rover assignment failed: ${disposition.reason}` } });
      recordTerminalExecution(job, 'error', disposition.reason);
      closeJobClients(job);
    }
    emit();
    if (disposition.kind !== 'completed') params.onRoverJobReleased?.(job.runParams.roverAgent.provider);
    return true;
  }

  function stopQueuedJob(job: RunJob, message = 'Run stopped before it started'): void {
    const idx = state.queue.indexOf(job.id);
    if (idx !== -1) state.queue.splice(idx, 1);
    state.admittingJobIds.delete(job.id);
    state.blockedJobIds.delete(job.id);
    job.status = 'stopped';
    addStopEvent(job, message);
    markEvaluationStopped(job, message);
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
    if (outcome.status === 'error' || outcome.status === 'stopped') {
      recordTerminalExecution(
        job,
        outcome.status,
        outcome.status === 'stopped' ? 'Run stopped by user' : 'Run failed'
      );
    }
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
      job.roverProgress = { completed: 0, total: job.runParams.roverScenarios?.length ?? 0 };
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
        if (
          nextJob.status !== 'queued' &&
          nextJob.status !== 'blocked_auth' &&
          nextJob.status !== 'waiting_for_rover' &&
          nextJob.status !== 'paused_rover'
        ) {
          state.queue.splice(index, 1);
          queueMutated = true;
          index -= 1;
          continue;
        }
        if (nextJob.status === 'waiting_for_rover' || nextJob.status === 'paused_rover') continue;
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
      const isRover = runParams.executionType === 'rover';
      const job: RunJob = {
        id: jobId,
        status: isRover ? 'waiting_for_rover' : 'queued',
        events: [],
        clients: new Set(),
        abortController: new AbortController(),
        runParams,
        ...(runParams.executionType === 'rover'
          ? {
              childProgress: (runParams.roverScenarios ?? []).map((scenario) => ({
                scenarioId: scenario.id,
                agentName: runParams.roverAgent.name,
                completed: 0,
                total: 1,
                status: 'queued' as const
              }))
            }
          : {})
      };
      jobs.set(jobId, job);
      if (runParams.evaluationRunId) {
        const journalDir = join(settings.runsDir, runParams.evaluationRunId);
        if (!readExecutionEvents(journalDir).some((event) => event.type === 'evaluation_started')) {
          appendExecutionEvent(journalDir, {
            eventId: `evaluation-started-${runParams.evaluationRunId}`,
            type: 'evaluation_started',
            ts: new Date().toISOString(),
            evaluationRunId: runParams.evaluationRunId,
            evaluationName: runParams.evaluationName
          });
        }
      }
      state.queue.push(jobId);
      const queuedPosition = state.queue.length;
      const shouldAttemptAdvance = !isRover && currentWorkerUsage(state) < state.queueWorkerCount;
      const shouldStartImmediately = shouldStartQueuedJobImmediately(jobId);

      if (isRover && params.assignRoverJob) {
        params.assignRoverJob(runParams.roverAgent?.provider ?? 'claude');
      }

      if (!shouldStartImmediately || isRover) {
        deps.addJobEvent(job, {
          type: 'queued',
          ts: new Date().toISOString(),
          payload: {
            evaluationRunId: runParams.evaluationRunId,
            configPath: runParams.configPath,
            runsPerScenario: runParams.runsPerScenario,
            scenarioId: runParams.scenarioId ?? null,
            scenarioIds: runParams.scenarioIds ?? null,
            agents: runParams.requestedAgents ?? null,
            runNote: runParams.runNote ?? null,
            serverOverrideAll: runParams.serverOverrideAll ?? null,
            scenarioServerOverrides: runParams.scenarioServerOverrides ?? null,
            position: queuedPosition,
            executionType: runParams.executionType ?? 'mcplab',
            roverAgent: runParams.roverAgent
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
      if (
        job.status === 'queued' ||
        job.status === 'blocked_auth' ||
        job.status === 'waiting_for_rover' ||
        job.status === 'paused_rover'
      ) {
        stopQueuedJob(job);
        void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
        return { ok: true, status: 'stopped' };
      }
      if (job.status !== 'running') {
        return { ok: true, status: job.status };
      }
      job.abortController.abort();
      if (job.runParams.executionType === 'rover') {
        params.sendRoverMessage?.({ type: 'stop', jobId: job.id });
        finalizeRoverJob(job, { kind: 'stopped', reason: 'Run stopped by user' });
        return { ok: true, status: 'stopped' };
      }
      state.activeJobIds.delete(jobId);
      job.status = 'stopped';
      markEvaluationStopped(job, 'Run stopped by user');
      return { ok: true, status: 'stopped' };
    },
    stopEvaluationRun(evaluationRunId, options) {
      const jobsForEvaluation = Array.from(jobs.values()).filter(
        (job) => job.runParams.evaluationRunId === evaluationRunId
      );
      if (jobsForEvaluation.length === 0) return null;
      let stopped = 0;
      for (const job of jobsForEvaluation) {
        if (
          ['queued', 'blocked_auth', 'waiting_for_rover', 'paused_rover', 'running'].includes(
            job.status
          )
        ) {
          if (this.stopJob(job.id, options)?.status === 'stopped') stopped += 1;
        }
      }
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
      return { ok: true, stopped };
    },
    removeEvaluationRun(evaluationRunId, options) {
      const jobsForEvaluation = Array.from(jobs.values()).filter(
        (job) => job.runParams.evaluationRunId === evaluationRunId
      );
      if (jobsForEvaluation.length === 0) return null;
      if (
        jobsForEvaluation.some(
          (job) =>
            job.status !== 'queued' &&
            job.status !== 'blocked_auth' &&
            job.status !== 'waiting_for_rover' &&
            job.status !== 'stopped'
        )
      ) {
        return {
          error: 'Evaluation run has already started. Use the stop action instead.',
          statusCode: 400
        };
      }
      let removed = 0;
      for (const job of jobsForEvaluation) {
        if (job.status === 'stopped') {
          jobs.delete(job.id);
          removed += 1;
        } else if (this.removeQueuedJob(job.id, options)) {
          removed += 1;
        }
      }
      void advance({ emitWhenIdle: true, hostHeader: options?.hostHeader });
      return { ok: true, removed };
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
      if (
        job.status !== 'queued' &&
        job.status !== 'blocked_auth' &&
        job.status !== 'waiting_for_rover'
      ) {
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
    getWaitingRoverJobs(provider) {
      return state.queue.flatMap((jobId, index) => {
        const job = jobs.get(jobId);
        if (job?.status !== 'waiting_for_rover' || job.runParams.roverAgent?.provider !== provider) return [];
        return [{ jobId: job.id, evaluationName: job.runParams.evaluationName, provider, position: index + 1 }];
      });
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
    },
    assignRoverJob(provider, send, worker) {
      const roverAlreadyBusy = Array.from(state.activeJobIds).some(
        (id) => jobs.get(id)?.runParams.executionType === 'rover'
      );
      if (roverAlreadyBusy) return null;
      const job = state.queue
        .map((id) => jobs.get(id))
        .find(
          (candidate) =>
            candidate?.status === 'waiting_for_rover' &&
            candidate.runParams.roverAgent?.provider === provider &&
            (candidate.runParams.roverAgent.providerRevision === undefined ||
              worker?.providerRevision === undefined ||
              candidate.runParams.roverAgent.providerRevision === worker.providerRevision)
        );
      if (!job) return null;
      const assignment: RoverSocketMessage = {
        type: 'assignment',
        jobId: job.id,
        evaluationRunId: job.runParams.evaluationRunId,
        configPath: job.runParams.configPath,
        evaluationName: job.runParams.evaluationName,
        agentName: job.runParams.roverAgent!.name,
        agent: job.runParams.roverAgent,
        scenarios: job.runParams.roverScenarios ?? [],
        newConversationBetweenScenarios:
          job.runParams.roverNewConversationBetweenScenarios !== false
      };
      const leaseCapable = worker?.capabilities?.includes('assignment_lease') === true;
      if (leaseCapable && worker) {
        const now = new Date();
        const leaseId = randomUUID();
        const expiresAt = new Date(now.getTime() + 30_000).toISOString();
        job.roverLease = {
          leaseId,
          connectionId: worker.connectionId,
          state: 'offered',
          expiresAt,
          offeredAt: now.toISOString()
        };
        assignment.leaseId = leaseId;
        assignment.leaseExpiresAt = expiresAt;
        scheduleLeaseExpiry(job);
      }
      const index = state.queue.indexOf(job.id);
      if (index !== -1) state.queue.splice(index, 1);
      job.status = 'running';
      state.activeJobIds.add(job.id);
      if (!send(assignment)) {
        state.activeJobIds.delete(job.id);
        const timer = leaseTimers.get(job.id);
        if (timer) clearTimeout(timer);
        leaseTimers.delete(job.id);
        job.roverLease = undefined;
        job.status = 'waiting_for_rover';
        if (index !== -1) state.queue.splice(index, 0, job.id);
        return null;
      }
      deps.addJobEvent(job, {
        type: 'started',
        ts: new Date().toISOString(),
        payload: {
          executionType: 'rover',
          roverAgent: job.runParams.roverAgent,
          agents: job.runParams.requestedAgents ?? null
        }
      });
      emit();
      return job;
    },
    rebindRoverLeases(provider, worker) {
      const now = Date.now();
      for (const job of jobs.values()) {
        if (
          job.runParams.executionType !== 'rover' ||
          job.runParams.roverAgent.provider !== provider ||
          !job.roverLease ||
          job.status === 'completed' ||
          job.status === 'stopped' ||
          job.status === 'error'
        ) continue;
        job.roverLease.connectionId = worker.connectionId;
        job.roverLease.expiresAt = new Date(now + 30_000).toISOString();
        scheduleLeaseExpiry(job);
      }
    },
    pauseRoverJob(jobId, connectionId) {
      const job = jobs.get(jobId);
      if (!job || job.runParams.executionType !== 'rover' || job.status !== 'running') return;
      if (connectionId && job.roverLease && job.roverLease.connectionId !== connectionId) return;
      state.activeJobIds.delete(jobId);
      job.status = 'paused_rover';
      state.queue.unshift(jobId);
      deps.addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: 'Rover disconnected. Job paused until Rover reconnects.' }
      });
      emit();
    },
    resumeRoverJob(jobId) {
      const job = jobs.get(jobId);
      if (!job || job.runParams.executionType !== 'rover' || job.status !== 'paused_rover')
        return false;
      job.status = 'waiting_for_rover';
      if (!state.queue.includes(jobId)) state.queue.push(jobId);
      deps.addJobEvent(job, {
        type: 'log',
        ts: new Date().toISOString(),
        payload: { message: 'Rover job resumed and waiting for Rover connection.' }
      });
      emit();
      params.assignRoverJob?.(job.runParams.roverAgent.provider);
      return true;
    },
    completeRoverJob(jobId, payload = {}) {
      const job = jobs.get(jobId);
      if (
        !job ||
        job.runParams.executionType !== 'rover' ||
        (job.status !== 'running' && job.status !== 'paused_rover')
      )
        return;
      finalizeRoverJob(job, { kind: 'completed', payload });
    },
    stopRoverScenario(jobId, scenarioId) {
      const job = jobs.get(jobId);
      if (!job || job.runParams.executionType !== 'rover') return null;
      if (!scenarioId.trim()) return { error: 'Scenario ID is required', statusCode: 400 };
      const child = (job.childProgress ?? []).find((entry) => entry.scenarioId === scenarioId);
      if (child?.status === 'completed' || child?.status === 'stopped') {
        return { ok: true, status: 'stopped' };
      }
      const sent = params.sendRoverMessage?.({
        type: 'stop_scenario',
        jobId,
        scenarioId
      });
      if (sent === false) return { error: 'Rover is not connected', statusCode: 409 };
      const progress = job.childProgress ?? [];
      const next = {
        scenarioId,
        agentName: job.runParams.roverAgent.name,
        completed: child?.completed ?? 0,
        total: child?.total ?? 1,
        status: 'stopped' as const
      };
      job.childProgress = upsertQueueChildProgress(progress, { ...next });
      emit();
      return { ok: true, status: 'stopped' };
    },
    stopScenario(jobId, scenarioId, agentName) {
      const job = jobs.get(jobId);
      if (!job || !scenarioId.trim()) return null;
      const matches = (job.childProgress ?? []).filter((entry) => entry.scenarioId === scenarioId);
      if (matches.length > 1 && !agentName) {
        return {
          error: 'Agent name is required when multiple agents run this scenario',
          statusCode: 400
        };
      }
      const child = matches.find((entry) => !agentName || entry.agentName === agentName);
      if (matches.length > 0 && !child)
        return { error: 'Scenario-agent child not found', statusCode: 404 };
      if (child?.status === 'completed' || child?.status === 'stopped') {
        return { ok: true, status: 'stopped' };
      }
      const resolvedAgentName =
        child?.agentName ??
        (job.runParams.executionType === 'rover' ? job.runParams.roverAgent.name : undefined);
      if (job.runParams.executionType === 'rover') {
        return this.stopRoverScenario(jobId, scenarioId);
      }
      if (!resolvedAgentName) return { error: 'Scenario is not initialized', statusCode: 409 };
      const controller = job.childAbortControllers?.get(`${scenarioId}:${resolvedAgentName}`);
      if (!controller) return { error: 'Scenario is not running', statusCode: 409 };
      controller.abort();
      const progress = job.childProgress ?? [];
      job.childProgress = upsertQueueChildProgress(progress, {
        ...child!,
        status: 'stopped'
      });
      emit();
      return { ok: true, status: 'stopped' };
    },
    handleRoverMessage(message, provider, send, worker) {
      const leaseControlMessage = ['assignment_accept', 'assignment_reject', 'lease_renew', 'lease_release', 'complete'].includes(message.type);
      if (leaseControlMessage && typeof message.jobId === 'string' && typeof message.leaseId === 'string') {
        const knownJob = jobs.get(message.jobId);
        const knownLease = knownJob?.roverLease;
        if (!knownJob || !knownLease || knownLease.leaseId !== message.leaseId || (worker && knownLease.connectionId !== worker.connectionId)) {
          send({ type: 'lease_unknown', jobId: message.jobId, leaseId: message.leaseId, reason: 'unknown_lease' });
          return null;
        }
      }
      if (
        (message.type === 'assignment_accept' ||
          message.type === 'assignment_reject' ||
          message.type === 'lease_renew' ||
          message.type === 'lease_release') &&
        typeof message.jobId === 'string' &&
        typeof message.leaseId === 'string'
      ) {
        const job = jobs.get(message.jobId);
        const lease = job?.roverLease;
        if (
          !job ||
          !lease ||
          lease.leaseId !== message.leaseId ||
          (worker && lease.connectionId !== worker.connectionId)
        ) return null;
        if (message.type === 'assignment_accept' && lease.state === 'offered') {
          lease.state = 'accepted';
          lease.acceptedAt = new Date().toISOString();
          if (typeof message.tabId === 'number') lease.tabId = message.tabId;
          scheduleLeaseExpiry(job);
          emit();
          return null;
        }
        if (message.type === 'lease_renew' && lease.state !== 'offered') {
          const requested = Date.parse(String(message.leaseExpiresAt ?? ''));
          if (!Number.isFinite(requested) || requested <= Date.now()) return null;
          lease.expiresAt = new Date(Math.min(requested, Date.now() + 30_000)).toISOString();
          scheduleLeaseExpiry(job);
          emit();
          return null;
        }
        if (message.type === 'assignment_reject' && lease.state === 'offered') {
          job.roverLease = undefined;
          const timer = leaseTimers.get(job.id);
          if (timer) clearTimeout(timer);
          leaseTimers.delete(job.id);
          state.activeJobIds.delete(job.id);
          job.status = 'waiting_for_rover';
          if (!state.queue.includes(job.id)) state.queue.unshift(job.id);
          deps.addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: { message: `Rover rejected assignment: ${String(message.reason ?? 'unknown')}` }
          });
          emit();
          return null;
        }
        if (message.type === 'lease_release') {
          const reason = String(message.reason ?? 'error');
          const shouldRequeue = ROVER_LEASE_REQUEUE_REASONS.includes(reason as (typeof ROVER_LEASE_REQUEUE_REASONS)[number]) || (reason === 'error' && job.status === 'running');
          if (shouldRequeue && job.status === 'running') finalizeRoverJob(job, { kind: 'requeue', reason });
          else if (ROVER_LEASE_TERMINAL_REASONS.includes(reason as (typeof ROVER_LEASE_TERMINAL_REASONS)[number])) finalizeRoverJob(job, { kind: 'error', reason });
          send({ type: 'lease_action_ack', jobId: job.id, leaseId: message.leaseId, action: 'release' });
          return null;
        }
        return null;
      }
      if (
        typeof message.jobId === 'string' &&
        typeof message.leaseId === 'string'
      ) {
        const leasedJob = jobs.get(message.jobId);
        if (leasedJob?.roverLease && leasedJob.roverLease.leaseId !== message.leaseId) return null;
        if (
          leasedJob?.roverLease?.state === 'accepted' &&
          (message.type === 'progress' || message.type === 'stage' || (message.type === 'scenario_status' && message.status === 'running')) &&
          (!worker || leasedJob.roverLease.connectionId === worker.connectionId)
        ) {
          leasedJob.roverLease.state = 'running';
          emit();
        }
      }
      if (message.type === 'scenario_status' && typeof message.jobId === 'string') {
        const job = jobs.get(message.jobId);
        const roverAgent =
          job?.runParams.executionType === 'rover' ? job.runParams.roverAgent : undefined;
        if (
          job?.runParams.executionType === 'rover' &&
          roverAgent &&
          typeof message.scenarioId === 'string'
        ) {
          const status = String(message.status ?? 'running');
          const allowed = new Set(['queued', 'running', 'completed', 'error', 'stopped']);
          if (!allowed.has(status)) return null;
          const existing = job.childProgress ?? [];
          const current = existing.find(
            (child) =>
              child.scenarioId === message.scenarioId && child.agentName === roverAgent.name
          );
          const next = {
            scenarioId: message.scenarioId,
            agentName: roverAgent.name,
            completed: Math.max(0, Number(message.completed ?? 0)),
            total: Math.max(1, Number(message.total ?? 1)),
            status: status as 'queued' | 'running' | 'completed' | 'error' | 'stopped',
            ...(typeof message.lastDurationMs === 'number'
              ? { lastDurationMs: Math.max(0, message.lastDurationMs) }
              : {}),
            ...(typeof message.error === 'string' ? { error: message.error } : {})
          };
          const terminal = new Set(['completed', 'error', 'stopped']);
          if (current && terminal.has(current.status) && !terminal.has(next.status)) {
            return null;
          }
          if (current && next.completed < current.completed) return null;
          job.childProgress = upsertQueueChildProgress(existing, next);
          emit();
        }
        return null;
      }
      if (message.type === 'stage' && typeof message.jobId === 'string') {
        const job = jobs.get(message.jobId);
        const stage = typeof message.stage === 'string' ? message.stage : 'progress';
        const scenario = typeof message.scenarioId === 'string' ? ` (${message.scenarioId})` : '';
        const labels: Record<string, string> = {
          prompt_sent: 'Prompt sent to Rover',
          waiting_for_response: 'Waiting for the agent response',
          response_captured: 'Response captured from Rover',
          evaluating: 'Evaluating response in MCPLab',
          persisted: 'Result persisted in MCPLab'
        };
        if (job?.runParams.executionType === 'rover') {
          deps.addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: `${
                labels[stage] ?? String(message.message ?? 'Rover progress')
              }${scenario} [agent=${
                job.runParams.executionType === 'rover' ? job.runParams.roverAgent.name : 'unknown'
              }]`
            }
          });
          emit();
        }
        return null;
      }
      if (message.type === 'progress' && typeof message.jobId === 'string') {
        const job = jobs.get(message.jobId);
        if (job?.runParams.executionType === 'rover') {
          if (typeof message.completed === 'number' && typeof message.total === 'number') {
            const total = Math.max(0, message.total);
            job.roverProgress = {
              completed: Math.max(0, Math.min(message.completed, total)),
              total,
              ...(typeof message.currentScenarioId === 'string'
                ? { currentScenarioId: message.currentScenarioId }
                : {}),
              ...(typeof message.lastDurationMs === 'number'
                ? { lastDurationMs: Math.max(0, message.lastDurationMs) }
                : {}),
              ...(typeof message.error === 'string' ? { error: message.error } : {})
            };
          }
          deps.addJobEvent(job, {
            type: 'log',
            ts: new Date().toISOString(),
            payload: {
              message: String(
                message.message ??
                  (message.error ? `Rover error: ${message.error}` : 'Rover progress')
              )
            }
          });
          if (typeof message.error === 'string' && job.status === 'running') {
            state.activeJobIds.delete(job.id);
            job.status = 'paused_rover';
            state.queue.unshift(job.id);
          }
          emit();
        }
      }
      if (message.type !== 'complete' || typeof message.jobId !== 'string') return null;
      const completedJob = jobs.get(message.jobId);
      this.completeRoverJob(message.jobId, {
        runId: completedJob?.runParams.evaluationRunId ?? message.runId,
        outcome: message.outcome,
        provider
      });
      if (typeof message.leaseId === 'string') {
        send({ type: 'lease_action_ack', jobId: message.jobId, leaseId: message.leaseId, action: 'complete' });
      }
      const next = this.assignRoverJob(provider, send, worker);
      return next?.id ?? null;
    }
  };
}
