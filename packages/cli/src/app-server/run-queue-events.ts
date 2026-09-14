import type { ServerResponse } from 'node:http';
import type { EvaluationQueueItem, QueueEntry, QueueResponse } from '@inspectr/mcplab-core';
import type { SseEvent } from './jobs.js';
import type { RunJob, RunQueueState } from './run-queue-state.js';

export function toQueueEntry(job: RunJob): QueueEntry {
  const commonRunParams = {
    evaluationRunId: job.runParams.evaluationRunId,
    evaluationName: job.runParams.evaluationName,
    configPath: job.runParams.configPath,
    runsPerScenario: job.runParams.runsPerScenario,
    scenarioIds: job.runParams.scenarioIds ?? null,
    agents: job.runParams.requestedAgents ?? null,
    runNote: job.runParams.runNote ?? null,
    serverOverrideAll: job.runParams.serverOverrideAll ?? null,
    scenarioServerOverrides: job.runParams.scenarioServerOverrides ?? null
  };
  const common = {
    jobId: job.id,
    roverProgress: job.roverProgress,
    childProgress: job.childProgress,
    evaluationRunId: job.runParams.evaluationRunId,
    evaluationName: job.runParams.evaluationName,
    status: job.status,
    blockedReason: (job.status === 'blocked_auth'
      ? 'oauth_required'
      : job.status === 'waiting_for_rover'
        ? 'rover_required'
        : job.status === 'paused_rover'
          ? 'rover_interrupted'
          : undefined) as 'oauth_required' | 'rover_required' | 'rover_interrupted' | undefined,
    requiredServers: job.status === 'blocked_auth' ? (job.blockedAuthServers ?? []) : undefined
  };
  if (job.runParams.executionType === 'rover') {
    return {
      ...common,
      executionType: 'rover',
      roverAgent: job.runParams.roverAgent!,
      runParams: {
        ...commonRunParams,
        executionType: 'rover',
        roverAgent: job.runParams.roverAgent!,
        roverNewConversationBetweenScenarios: job.runParams.roverNewConversationBetweenScenarios
      }
    };
  }
  return {
    ...common,
    executionType: 'mcplab',
    runParams: { ...commonRunParams, executionType: 'mcplab' }
  };
}

export function buildQueueState(
  jobs: Map<string, RunJob>,
  runQueueState: RunQueueState
): QueueResponse {
  const activeJobs = Array.from(runQueueState.activeJobIds)
    .map((id) => jobs.get(id))
    .filter((job): job is RunJob => !!job && job.status === 'running')
    .map((job) => toQueueEntry(job));
  const admittingJobs = Array.from(runQueueState.admittingJobIds)
    .map((id) => jobs.get(id))
    .filter((job): job is RunJob => !!job)
    .map((job) => toQueueEntry(job));
  // Invariant: a job ID appears in exactly one bucket. Queue members already in admittingJobIds
  // must be excluded from queued so retrying blocked jobs and fresh admissions never duplicate.
  const queuedEntries = runQueueState.queue
    .filter((id) => !runQueueState.admittingJobIds.has(id))
    .map((id) => jobs.get(id))
    .filter(
      (j): j is RunJob =>
        !!j &&
        (j.status === 'queued' ||
          j.status === 'blocked_auth' ||
          j.status === 'waiting_for_rover' ||
          j.status === 'paused_rover')
    )
    .map((job) => toQueueEntry(job));
  const allJobs = Array.from(jobs.values());
  const evaluations = new Map<string, QueueEntry[]>();
  for (const job of allJobs) {
    const evaluationRunId = job.runParams.evaluationRunId;
    if (!evaluationRunId) continue;
    const entries = evaluations.get(evaluationRunId) ?? [];
    entries.push(toQueueEntry(job));
    evaluations.set(evaluationRunId, entries);
  }
  const evaluationItems: EvaluationQueueItem[] = Array.from(
    evaluations,
    ([evaluationRunId, entries]) => {
      const children = entries.flatMap((entry) =>
        entry.childProgress?.length
          ? entry.childProgress
          : [
              {
                scenarioId: entry.runParams.scenarioIds?.[0] ?? entry.jobId,
                agentName: entry.roverAgent?.name ?? entry.runParams.agents?.[0] ?? 'Agent',
                completed: entry.status === 'completed' ? 1 : 0,
                total: 1,
                status:
                  entry.status === 'completed'
                    ? ('completed' as const)
                    : entry.status === 'error'
                      ? ('error' as const)
                      : entry.status === 'stopped'
                        ? ('stopped' as const)
                        : ('running' as const)
              }
            ]
      );
      const completedJobs = children.filter((child) => child.status === 'completed').length;
      const stoppedJobs = children.filter((child) => child.status === 'stopped').length;
      const errorJobs = children.filter((child) => child.status === 'error').length;
      const failedJobs = children.filter(
        (child) => child.status === 'error' || child.status === 'stopped'
      ).length;
      const pausedJobs = entries.filter((entry) => entry.status === 'paused_rover').length;
      const hasPending =
        children.some((child) => ['queued', 'running'].includes(child.status)) ||
        entries.some((entry) =>
          ['waiting_for_rover', 'blocked_auth', 'paused_rover'].includes(entry.status)
        );
      const status: EvaluationQueueItem['status'] =
        stoppedJobs > 0 && errorJobs === 0 && !hasPending
          ? 'stopped'
          : failedJobs > 0 && !hasPending
          ? completedJobs > 0
            ? 'partial'
            : 'failed'
          : pausedJobs > 0
            ? 'paused'
            : hasPending && entries.some((entry) => entry.status === 'running')
              ? 'running'
              : hasPending
                ? 'queued'
                : 'completed';
      return {
        evaluationRunId,
        evaluationName: entries.find((entry) => entry.evaluationName)?.evaluationName,
        status,
        totalJobs: children.length,
        completedJobs,
        failedJobs,
        stoppedJobs,
        pausedJobs,
        jobs: entries
      };
    }
  );
  return {
    active: activeJobs[0] ?? null,
    active_jobs: activeJobs,
    admitting_jobs: admittingJobs,
    queued: queuedEntries,
    evaluations: evaluationItems.filter(
      (item) =>
        item.status === 'queued' ||
        item.status === 'running' ||
        item.status === 'paused' ||
        item.status === 'stopped'
    )
  };
}

export function emitQueueEvent(
  jobs: Map<string, RunJob>,
  runQueueState: RunQueueState,
  sendSseEvent: (target: ServerResponse, event: SseEvent) => void
) {
  const event: SseEvent = {
    type: 'queue_event',
    ts: new Date().toISOString(),
    payload: { event: buildQueueState(jobs, runQueueState) }
  };
  for (const client of Array.from(runQueueState.clients)) {
    if (client.destroyed || client.writableEnded) {
      runQueueState.clients.delete(client);
      continue;
    }
    try {
      sendSseEvent(client, event);
    } catch {
      runQueueState.clients.delete(client);
    }
  }
}

export function closeJobClients(job: RunJob): void {
  for (const client of job.clients) client.end();
  job.clients.clear();
}
