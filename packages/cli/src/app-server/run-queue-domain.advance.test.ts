import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunQueueServiceForTest } from './runs-routes.test-helpers.js';
import { admitQueuedJob, executeRunJob } from './run-queue-executor.js';

vi.mock('./run-queue-executor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./run-queue-executor.js')>()),
  admitQueuedJob: vi.fn(),
  executeRunJob: vi.fn()
}));

const roverParams = {
  executionType: 'rover' as const,
  configPath: '/tmp/eval.yaml',
  runsPerScenario: 1,
  roverAgent: { name: 'Browser', provider: 'polo', url: 'https://polo.example' },
  roverScenarios: [{ id: 's1', prompt: 'test', servers: [] }]
};

describe('Rover releases wake the shared run queue', () => {
  beforeEach(() => {
    vi.mocked(admitQueuedJob).mockReset().mockResolvedValue({ status: 'ready', readyServers: [] });
    vi.mocked(executeRunJob).mockReset().mockResolvedValue({ status: 'completed' });
  });

  it.each(['completed', 'stopped', 'error'] as const)(
    'starts a waiting API run after a Rover job is %s',
    async (status) => {
      const service = createRunQueueServiceForTest();
      const rover = service.enqueueRun(roverParams);
      service.assignRoverJob('polo', () => true);
      const api = service.enqueueRun({ configPath: '/tmp/eval.yaml', runsPerScenario: 1 });
      expect(service.jobs.get(api.jobId)?.status).toBe('queued');
      expect(executeRunJob).not.toHaveBeenCalled();

      if (status === 'completed') service.completeRoverJob(rover.jobId);
      else if (status === 'stopped') service.stopJob(rover.jobId);
      else
        service.handleRoverMessage(
          { type: 'progress', jobId: rover.jobId, error: 'Failed' },
          'polo',
          () => true
        );

      expect(service.jobs.get(rover.jobId)?.status).toBe(status);
      await vi.waitFor(() => expect(service.jobs.get(api.jobId)?.status).toBe('completed'));
      expect(executeRunJob).toHaveBeenCalledOnce();
      expect(service.state.queue).not.toContain(api.jobId);
    }
  );

  it('waits for the next Rover assignment to release the occupied slot', async () => {
    const service = createRunQueueServiceForTest();
    const first = service.enqueueRun(roverParams);
    service.assignRoverJob('polo', () => true);
    const second = service.enqueueRun(roverParams);
    const api = service.enqueueRun({ configPath: '/tmp/eval.yaml', runsPerScenario: 1 });

    expect(
      service.handleRoverMessage({ type: 'complete', jobId: first.jobId }, 'polo', () => true)
    ).toBe(second.jobId);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(service.jobs.get(second.jobId)?.status).toBe('running');
    expect(service.jobs.get(api.jobId)?.status).toBe('queued');
    expect(executeRunJob).not.toHaveBeenCalled();

    service.handleRoverMessage({ type: 'complete', jobId: second.jobId }, 'polo', () => true);
    await vi.waitFor(() => expect(service.jobs.get(api.jobId)?.status).toBe('completed'));
    expect(executeRunJob).toHaveBeenCalledOnce();
  });
});
