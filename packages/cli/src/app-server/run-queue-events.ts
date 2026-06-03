import type { ServerResponse } from 'node:http';
import type { QueueEntry, QueueResponse } from '@inspectr/mcplab-core';
import type { SseEvent } from './jobs.js';
import type { RunJob, RunQueueState } from './run-queue-state.js';

export function toQueueEntry(job: RunJob): QueueEntry {
  return {
    jobId: job.id,
    status: job.status,
    blockedReason: job.status === 'blocked_auth' ? 'oauth_required' : undefined,
    requiredServers: job.status === 'blocked_auth' ? job.blockedAuthServers ?? [] : undefined,
    runParams: {
      configPath: job.runParams.configPath,
      runsPerScenario: job.runParams.runsPerScenario,
      scenarioIds: job.runParams.scenarioIds ?? null,
      agents: job.runParams.requestedAgents ?? null,
      runNote: job.runParams.runNote ?? null,
      serverOverrideAll: job.runParams.serverOverrideAll ?? null,
      scenarioServerOverrides: job.runParams.scenarioServerOverrides ?? null
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
    .filter((j): j is RunJob => !!j && (j.status === 'queued' || j.status === 'blocked_auth'))
    .map((job) => toQueueEntry(job));
  return {
    active: activeJobs[0] ?? null,
    active_jobs: activeJobs,
    admitting_jobs: admittingJobs,
    queued: queuedEntries
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
