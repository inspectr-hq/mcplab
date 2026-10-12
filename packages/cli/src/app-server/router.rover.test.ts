import { describe, expect, it, vi } from 'vitest';
import { assignRegisteredRoverJob, roverCompletionReleasedJob } from './router.js';
import type { RoverConnection } from './rover-connection.js';
import { createRunQueueServiceForTest } from './runs-routes.test-helpers.js';

describe('Rover assignment release', () => {
  it('offers work for the current provider after a provider switch mid-run', () => {
    let connection = {
      connectionId: 'rover',
      registrationVersion: 1,
      registration: { provider: 'claude', capabilities: ['assignment_lease'] }
    } as RoverConnection;
    const send = vi.fn(() => true);
    const queue = createRunQueueServiceForTest({
      onRoverJobReleased: () => assignRegisteredRoverJob(queue, connection, send)
    });
    const enqueue = (provider: string) =>
      queue.enqueueRun({
        executionType: 'rover',
        configPath: '/tmp/eval.yaml',
        runsPerScenario: 1,
        roverAgent: { name: provider, provider, url: `https://${provider}.example` },
        roverScenarios: [{ id: 's1', prompt: 'test', agent: provider, servers: [] }]
      });
    const first = enqueue('claude');
    const next = enqueue('polo');
    assignRegisteredRoverJob(queue, connection, send);
    connection = {
      ...connection,
      registrationVersion: 2,
      registration: { ...connection.registration, provider: 'polo' }
    };

    queue.stopJob(first.jobId);

    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'assignment', jobId: next.jobId })
    );
    expect(queue.jobs.get(next.jobId)?.status).toBe('running');
    queue.stopJob(next.jobId);
  });

  it('does not offer work without a connected Rover', () => {
    const queue = { assignRoverJob: vi.fn() };
    expect(assignRegisteredRoverJob(queue, null, () => false)).toBeNull();
    expect(queue.assignRoverJob).not.toHaveBeenCalled();
  });

  it('keeps tracking a reassigned job when an old lease sends completion', () => {
    const queue = createRunQueueServiceForTest();
    const { jobId } = queue.enqueueRun({
      executionType: 'rover',
      configPath: '/tmp/eval.yaml',
      runsPerScenario: 1,
      roverAgent: { name: 'claude', provider: 'claude', url: 'https://claude.example' },
      roverScenarios: [
        { id: 's1', prompt: 'first', agent: 'claude', servers: [] },
        { id: 's2', prompt: 'second', agent: 'claude', servers: [] }
      ]
    });
    const worker = {
      connectionId: 'old',
      registrationVersion: 1,
      provider: 'claude',
      capabilities: ['assignment_lease']
    };
    const send = vi.fn(() => true);
    queue.assignRoverJob('claude', send, worker);
    const oldLease = queue.jobs.get(jobId)!.roverLease!.leaseId;
    queue.pauseRoverJob(jobId);
    queue.stopScenario(jobId, 's1', 'claude');
    const nextWorker = { ...worker, connectionId: 'new' };
    queue.assignRoverJob('claude', send, nextWorker);
    const currentLease = queue.jobs.get(jobId)!.roverLease!.leaseId;

    queue.handleRoverMessage(
      { type: 'complete', jobId, leaseId: oldLease },
      'claude',
      send,
      nextWorker
    );
    expect(roverCompletionReleasedJob(queue.jobs.get(jobId))).toBe(false);
    expect(queue.jobs.get(jobId)?.roverLease?.leaseId).toBe(currentLease);

    queue.handleRoverMessage(
      { type: 'complete', jobId, leaseId: currentLease },
      'claude',
      send,
      nextWorker
    );
    expect(roverCompletionReleasedJob(queue.jobs.get(jobId))).toBe(true);
  });
});
