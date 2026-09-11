import { describe, expect, it } from 'vitest';
import { toQueueEntry } from './run-queue-events.js';

describe('queue event projections', () => {
  it('projects scenario progress for an evaluation child', () => {
    const entry = toQueueEntry({
      id: 'job-1',
      status: 'running',
      events: [],
      clients: new Set(),
      abortController: new AbortController(),
      runParams: {
        configPath: '/tmp/eval.yaml',
        runsPerScenario: 2,
        requestedAgents: ['agent-1'],
        scenarioIds: ['scenario-1'],
        evaluationRunId: 'evaluation-1'
      },
      childProgress: [
        {
          scenarioId: 'scenario-1',
          agentName: 'agent-1',
          completed: 1,
          total: 2,
          status: 'running'
        }
      ]
    } as any);

    expect(entry).toMatchObject({
      childProgress: [
        {
          scenarioId: 'scenario-1',
          agentName: 'agent-1',
          completed: 1,
          total: 2,
          status: 'running'
        }
      ]
    });
  });

  it('counts scenario children instead of infrastructure jobs', async () => {
    const { buildQueueState } = await import('./run-queue-events.js');
    const job = {
      id: 'job-1',
      status: 'running',
      events: [],
      clients: new Set(),
      abortController: new AbortController(),
      runParams: { configPath: '/tmp/eval.yaml', evaluationRunId: 'evaluation-1' },
      childProgress: [
        { scenarioId: 's1', agentName: 'a1', completed: 1, total: 1, status: 'completed' },
        { scenarioId: 's2', agentName: 'a1', completed: 0, total: 1, status: 'running' }
      ]
    };
    const state = buildQueueState(new Map([[job.id, job as any]]), {
      activeJobIds: new Set([job.id]),
      admittingJobIds: new Set(),
      blockedJobIds: new Set(),
      queue: [],
      queueWorkerCount: 1,
      isAdvancingQueue: false,
      needsAdvanceQueue: false,
      clients: new Set()
    });
    expect(state.evaluations?.[0]).toMatchObject({ totalJobs: 2, completedJobs: 1 });
  });

  it('omits evaluation groups after every child is terminal', async () => {
    const { buildQueueState } = await import('./run-queue-events.js');
    const job = {
      id: 'job-1',
      status: 'completed',
      events: [],
      clients: new Set(),
      abortController: new AbortController(),
      runParams: { configPath: '/tmp/eval.yaml', evaluationRunId: 'evaluation-done' },
      childProgress: [
        { scenarioId: 's1', agentName: 'a1', completed: 1, total: 1, status: 'completed' }
      ]
    };
    const state = buildQueueState(new Map([[job.id, job as any]]), {
      activeJobIds: new Set(), admittingJobIds: new Set(), blockedJobIds: new Set(), queue: [],
      queueWorkerCount: 1, isAdvancingQueue: false, needsAdvanceQueue: false, clients: new Set()
    });
    expect(state.evaluations).toEqual([]);
  });
});
