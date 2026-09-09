import { describe, expect, it, vi } from 'vitest';
import { createRunQueueServiceForTest } from './runs-routes.test-helpers.js';

function roverParams(provider: 'claude' | 'trendminer' = 'claude') {
  return {
    executionType: 'rover' as const,
    configPath: '/tmp/eval.yaml',
    runsPerScenario: 1,
    roverAgent: { name: provider, provider, url: `https://${provider}.example` },
    roverScenarios: [{ id: 's1', prompt: 'test', agent: provider, servers: [] }]
  };
}

describe('Rover run queue domain', () => {
  it('keeps Rover jobs waiting until a matching provider connects, then assigns them', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const { jobId } = service.enqueueRun(roverParams());
    expect(service.jobs.get(jobId)?.status).toBe('waiting_for_rover');

    const assigned = service.assignRoverJob('trendminer', send);
    expect(assigned).toBeNull();
    expect(service.jobs.get(jobId)?.status).toBe('waiting_for_rover');

    expect(service.assignRoverJob('claude', send)?.id).toBe(jobId);
    expect(service.jobs.get(jobId)?.status).toBe('running');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'assignment', jobId }));
  });

  it('does not consume a waiting job when the Rover assignment cannot be delivered', () => {
    const service = createRunQueueServiceForTest();
    const { jobId } = service.enqueueRun(roverParams());

    expect(service.assignRoverJob('claude', () => false)).toBeNull();
    expect(service.jobs.get(jobId)?.status).toBe('waiting_for_rover');
    expect(service.state.queue).toContain(jobId);
    expect(service.state.activeJobIds.has(jobId)).toBe(false);
    expect(service.jobs.get(jobId)?.events).toHaveLength(0);
  });

  it('pauses disconnected jobs and requires an explicit resume before reassignment', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const { jobId } = service.enqueueRun(roverParams());
    service.assignRoverJob('claude', send);

    service.pauseRoverJob(jobId);
    expect(service.jobs.get(jobId)?.status).toBe('paused_rover');
    expect(service.assignRoverJob('claude', send)).toBeNull();

    expect(service.resumeRoverJob(jobId)).toBe(true);
    expect(service.jobs.get(jobId)?.status).toBe('waiting_for_rover');
    expect(service.assignRoverJob('claude', send)?.id).toBe(jobId);
  });

  it('clamps Rover progress and completes the job before assigning the next one', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const first = service.enqueueRun(roverParams());
    const second = service.enqueueRun(roverParams());
    service.assignRoverJob('claude', send);

    expect(
      service.handleRoverMessage(
        {
          type: 'progress',
          jobId: first.jobId,
          completed: 9,
          total: 2,
          message: 'progress'
        },
        'claude',
        send
      )
    ).toBeNull();
    expect(service.jobs.get(first.jobId)?.roverProgress).toMatchObject({ completed: 2, total: 2 });

    expect(
      service.handleRoverMessage(
        { type: 'complete', jobId: first.jobId, runId: 'run-1', outcome: 'passed' },
        'claude',
        send
      )
    ).toBe(second.jobId);
    expect(service.jobs.get(first.jobId)?.status).toBe('completed');
    expect(service.jobs.get(second.jobId)?.status).toBe('running');
  });
});
