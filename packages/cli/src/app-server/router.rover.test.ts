import { describe, expect, it, vi } from 'vitest';
import {
  assignRegisteredRoverJob,
  releaseRegisteredRoverJob,
  roverCompletionReleasedJob
} from './router.js';
import type { RoverConnection } from './rover-connection.js';
import { createRunQueueServiceForTest } from './runs-routes.test-helpers.js';

describe('Rover assignment release', () => {
  it.each(['queued', 'waiting_for_rover'] as const)(
    'keeps the running job tracked when stopping a %s job, so disconnect can pause it',
    (status) => {
      let connection: RoverConnection | null = {
        connectionId: 'rover',
        registrationVersion: 1,
        registration: { provider: 'polo', capabilities: [] }
      } as RoverConnection;
      const send = vi.fn(() => true);
      let activeJobId: string | null = null;
      const queue = createRunQueueServiceForTest({
        onRoverJobReleased: (_provider, jobId) => {
          activeJobId = releaseRegisteredRoverJob(queue, connection, send, activeJobId, jobId);
        }
      });
      const enqueue = () =>
        queue.enqueueRun({
          executionType: 'rover',
          configPath: '/tmp/eval.yaml',
          runsPerScenario: 1,
          roverAgent: {
            name: 'polo',
            provider: 'polo',
            url: 'https://polo.example'
          },
          roverScenarios: [{ id: 's1', prompt: 'test', agent: 'polo', servers: [] }]
        });
      const first = enqueue();
      const next = enqueue();
      activeJobId = assignRegisteredRoverJob(queue, connection, send)!.id;
      queue.jobs.get(next.jobId)!.status = status;

      queue.stopScenario(next.jobId, 's1', 'polo');

      expect(activeJobId).toBe(first.jobId);
      expect(send).toHaveBeenCalledTimes(1);
      expect(queue.jobs.get(first.jobId)?.status).toBe('running');

      connection = null;
      if (activeJobId) queue.pauseRoverJob(activeJobId, 'rover');
      expect(queue.jobs.get(first.jobId)?.status).toBe('paused_rover');
      expect(queue.state.activeJobIds.size).toBe(0);
    }
  );

  it('offers waiting work when a non-active job is released and no job is tracked', () => {
    const connection = {
      connectionId: 'rover',
      registrationVersion: 1,
      registration: { provider: 'polo', capabilities: [] }
    } as RoverConnection;
    const next = { id: 'next' };
    const queue = { assignRoverJob: vi.fn(() => next) } as any;
    expect(releaseRegisteredRoverJob(queue, connection, () => true, null, 'stopped')).toBe('next');
    expect(queue.assignRoverJob).toHaveBeenCalledWith(
      'polo',
      expect.any(Function),
      expect.anything()
    );
  });

  it('offers work for the current provider after a provider switch mid-run', () => {
    let connection = {
      connectionId: 'rover',
      registrationVersion: 1,
      registration: { provider: 'claude', capabilities: ['assignment_lease'] }
    } as RoverConnection;
    const send = vi.fn(() => true);
    let activeJobId: string | null = null;
    const queue = createRunQueueServiceForTest({
      onRoverJobReleased: (_provider, jobId) => {
        activeJobId = releaseRegisteredRoverJob(queue, connection, send, activeJobId, jobId);
      }
    });
    const enqueue = (provider: string) =>
      queue.enqueueRun({
        executionType: 'rover',
        configPath: '/tmp/eval.yaml',
        runsPerScenario: 1,
        roverAgent: {
          name: provider,
          provider,
          url: `https://${provider}.example`
        },
        roverScenarios: [{ id: 's1', prompt: 'test', agent: provider, servers: [] }]
      });
    const first = enqueue('claude');
    const next = enqueue('polo');
    activeJobId = assignRegisteredRoverJob(queue, connection, send)!.id;
    connection = {
      ...connection,
      registrationVersion: 2,
      registration: { ...connection.registration, provider: 'polo' }
    };

    queue.stopJob(first.jobId);

    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'assignment', jobId: next.jobId })
    );
    expect(activeJobId).toBe(next.jobId);
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
      roverAgent: {
        name: 'claude',
        provider: 'claude',
        url: 'https://claude.example'
      },
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
