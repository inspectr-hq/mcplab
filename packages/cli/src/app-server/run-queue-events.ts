import type { ServerResponse } from 'node:http';
import type { EvaluationGroup, QueueEntry, QueueResponse } from '@inspectr/mcplab-core';
import type { SseEvent } from './jobs.js';
import type { RunJob, RunQueueState } from './run-queue-state.js';

export function toQueueEntry(job: RunJob): QueueEntry {
  return {
    jobId: job.id,
    resultRunId: job.resultRunId,
    evaluationGroupId: job.runParams.evaluationGroupId,
    status: job.status,
    blockedReason:
      job.status === 'blocked_auth'
        ? 'oauth_required'
        : job.status === 'waiting_for_rover'
        ? 'rover_required'
        : job.status === 'paused_rover'
        ? 'rover_interrupted'
        : undefined,
    executionType: job.runParams.executionType ?? 'mcplab',
    roverAgent: job.runParams.roverAgent,
    requiredServers: job.status === 'blocked_auth' ? job.blockedAuthServers ?? [] : undefined,
    runParams: {
      evaluationGroupId: job.runParams.evaluationGroupId,
      configPath: job.runParams.configPath,
      runsPerScenario: job.runParams.runsPerScenario,
      scenarioIds: job.runParams.scenarioIds ?? null,
      agents: job.runParams.requestedAgents ?? null,
      runNote: job.runParams.runNote ?? null,
      serverOverrideAll: job.runParams.serverOverrideAll ?? null,
      scenarioServerOverrides: job.runParams.scenarioServerOverrides ?? null,
      executionType: job.runParams.executionType ?? 'mcplab',
      roverAgent: job.runParams.roverAgent,
      roverNewConversationBetweenScenarios: job.runParams.roverNewConversationBetweenScenarios
    }
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
    .filter((j): j is RunJob =>
      !!j &&
      (j.status === 'queued' ||
        j.status === 'blocked_auth' ||
        j.status === 'waiting_for_rover' ||
        j.status === 'paused_rover')
    )
    .map((job) => toQueueEntry(job));
  const allJobs = Array.from(jobs.values());
  const groups = new Map<string, QueueEntry[]>();
  for (const job of allJobs) {
    const groupId = job.runParams.evaluationGroupId;
    if (!groupId) continue;
    const entries = groups.get(groupId) ?? [];
    entries.push(toQueueEntry(job));
    groups.set(groupId, entries);
  }
  const evaluation_groups: EvaluationGroup[] = Array.from(groups, ([evaluationGroupId, entries]) => {
    const completedJobs = entries.filter((entry) => entry.status === 'completed').length;
    const failedJobs = entries.filter((entry) => entry.status === 'error' || entry.status === 'stopped').length;
    const pausedJobs = entries.filter((entry) => entry.status === 'paused_rover').length;
    const hasPending = entries.some((entry) => ['queued', 'waiting_for_rover', 'blocked_auth', 'running'].includes(entry.status));
    const status: EvaluationGroup['status'] = failedJobs > 0 && !hasPending
      ? completedJobs > 0 ? 'partial' : 'failed'
      : pausedJobs > 0 ? 'paused'
      : hasPending && entries.some((entry) => entry.status === 'running') ? 'running'
      : hasPending ? 'queued'
      : 'completed';
    return {
      evaluationGroupId,
      parentRunId: runQueueState.evaluationGroupResultIds?.get(evaluationGroupId),
      status,
      totalJobs: entries.length,
      completedJobs,
      failedJobs,
      pausedJobs,
      resultRunIds: entries.map((entry) => entry.resultRunId).filter((id): id is string => Boolean(id)),
      jobs: entries
    };
  });
  return {
    active: activeJobs[0] ?? null,
    active_jobs: activeJobs,
    admitting_jobs: admittingJobs,
    queued: queuedEntries,
    evaluation_groups
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
