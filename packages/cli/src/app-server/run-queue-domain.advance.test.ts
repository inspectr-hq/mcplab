import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupFixtureRoot,
  createOauthEvalFixture,
  createRunQueueServiceForTest
} from './runs-routes.test-helpers.js';
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

describe('Terminal jobs release the shared run queue', () => {
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

  it.each(['error', 'stopped'] as const)(
    'settles unfinished API children on %s and starts the next job',
    async (status) => {
      const fixture = createOauthEvalFixture();
      try {
        const service = createRunQueueServiceForTest({ settings: { runsDir: fixture.runsDir } });
        vi.mocked(executeRunJob).mockImplementationOnce(async ({ job }) => {
          // A fatal connection error occurs before scenario progress events are emitted.
          job.childProgress = [
            { scenarioId: 's1', agentName: 'API', completed: 0, total: 1, status: 'queued' },
            { scenarioId: 's2', agentName: 'API', completed: 1, total: 2, status: 'running' },
            { scenarioId: 's3', agentName: 'API', completed: 1, total: 1, status: 'completed' }
          ];
          return { status };
        });
        const first = service.enqueueRun({
          configPath: fixture.configPath,
          runsPerScenario: 1,
          evaluationRunId: 'evaluation-error'
        });
        const next = service.enqueueRun({ configPath: fixture.configPath, runsPerScenario: 1 });

        await vi.waitFor(() => expect(service.jobs.get(first.jobId)?.status).toBe(status));
        expect(service.jobs.get(first.jobId)?.childProgress).toMatchObject([
          { status, completed: 0 },
          { status, completed: 1 },
          { status: 'completed', completed: 1 }
        ]);
        await vi.waitFor(() => expect(service.jobs.get(next.jobId)?.status).toBe('completed'));
        expect(service.state.activeJobIds.size).toBe(0);
        expect(service.getQueueState().evaluations?.[0]).toMatchObject({
          status: status === 'error' ? 'partial' : 'stopped',
          completedJobs: 1,
          failedJobs: 2
        });
        expect(service.removeEvaluationRun('evaluation-error')).toEqual({ ok: true, removed: 1 });
        expect(service.getQueueState().evaluations).toEqual([]);
      } finally {
        cleanupFixtureRoot(fixture.root);
      }
    }
  );
});
