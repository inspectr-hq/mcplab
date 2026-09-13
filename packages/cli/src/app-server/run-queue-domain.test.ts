import { describe, expect, it, vi } from 'vitest';
import { createRunQueueServiceForTest, createQueuedJob } from './runs-routes.test-helpers.js';

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
  it('stops every unfinished child when stopping an evaluation run', () => {
    const first = createQueuedJob('/tmp/eval.yaml', 'job-1');
    const second = createQueuedJob('/tmp/eval.yaml', 'job-2');
    first.runParams.evaluationRunId = 'evaluation-1';
    second.runParams.evaluationRunId = 'evaluation-1';
    const service = createRunQueueServiceForTest({
      jobs: new Map([
        [first.id, first],
        [second.id, second]
      ]),
      runQueueState: {
        queue: [first.id, second.id],
        activeJobIds: new Set(),
        admittingJobIds: new Set(),
        blockedJobIds: new Set(),
        queueWorkerCount: 1,
        isAdvancingQueue: false,
        needsAdvanceQueue: false,
        clients: new Set()
      }
    });

    expect(service.stopEvaluationRun('evaluation-1')).toMatchObject({ ok: true, stopped: 2 });
    expect(first.status).toBe('stopped');
    expect(second.status).toBe('stopped');
  });

  it('removes an evaluation run only when every child is still queued', () => {
    const first = createQueuedJob('/tmp/eval.yaml', 'job-1');
    const second = createQueuedJob('/tmp/eval.yaml', 'job-2');
    first.runParams.evaluationRunId = 'evaluation-2';
    second.runParams.evaluationRunId = 'evaluation-2';
    const service = createRunQueueServiceForTest({
      jobs: new Map([
        [first.id, first],
        [second.id, second]
      ]),
      runQueueState: {
        queue: [first.id, second.id],
        activeJobIds: new Set(),
        admittingJobIds: new Set(),
        blockedJobIds: new Set(),
        queueWorkerCount: 1,
        isAdvancingQueue: false,
        needsAdvanceQueue: false,
        clients: new Set()
      }
    });

    expect(service.removeEvaluationRun('evaluation-2')).toMatchObject({ ok: true, removed: 2 });
    expect(first.status).toBe('stopped');
    expect(second.status).toBe('stopped');
  });

  it('removes an evaluation containing a Rover job that is waiting for Rover', () => {
    const service = createRunQueueServiceForTest();
    const queued = service.enqueueRun({
      ...roverParams(),
      evaluationRunId: 'evaluation-waiting-rover'
    });

    expect(service.removeEvaluationRun('evaluation-waiting-rover')).toMatchObject({
      ok: true,
      removed: 1
    });
    expect(service.jobs.get(queued.jobId)?.status).toBe('stopped');
  });

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

  it('initializes Rover child progress before the assignment starts', () => {
    const service = createRunQueueServiceForTest();
    const { jobId } = service.enqueueRun({
      ...roverParams(),
      evaluationRunId: 'evaluation-children'
    });
    expect(service.jobs.get(jobId)?.childProgress).toEqual([
      expect.objectContaining({
        scenarioId: 's1',
        agentName: 'claude',
        completed: 0,
        total: 1,
        status: 'queued'
      })
    ]);
  });

  it('includes only the provider revision on a Rover assignment', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const { jobId } = service.enqueueRun({
      ...roverParams('custom' as 'claude'),
      roverAgent: {
        name: 'custom',
        provider: 'custom',
        url: 'https://custom.example',
        providerRevision: 'rev-1'
      }
    });
    service.assignRoverJob('custom', send);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'assignment',
        jobId,
        agent: expect.objectContaining({ providerRevision: 'rev-1' })
      })
    );
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
    const assignRoverJob = vi.fn(() => null);
    const service = createRunQueueServiceForTest({ assignRoverJob });
    const send = vi.fn(() => true);
    const { jobId } = service.enqueueRun(roverParams());
    service.assignRoverJob('claude', send);

    service.pauseRoverJob(jobId);
    expect(service.jobs.get(jobId)?.status).toBe('paused_rover');
    expect(service.assignRoverJob('claude', send)).toBeNull();

    expect(service.resumeRoverJob(jobId)).toBe(true);
    expect(service.jobs.get(jobId)?.status).toBe('waiting_for_rover');
    expect(assignRoverJob).toHaveBeenCalledWith('claude');
    expect(service.assignRoverJob('claude', send)?.id).toBe(jobId);
  });

  it('releases a running Rover job when it is stopped', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const { jobId } = service.enqueueRun(roverParams());
    service.assignRoverJob('claude', send);

    expect(service.state.activeJobIds.has(jobId)).toBe(true);
    expect(service.stopJob(jobId)).toMatchObject({ ok: true, status: 'stopped' });
    expect(service.jobs.get(jobId)?.status).toBe('stopped');
    expect(service.state.activeJobIds.has(jobId)).toBe(false);
  });

  it('clamps Rover progress and completes the job before assigning the next one', () => {
    const events: any[] = [];
    const service = createRunQueueServiceForTest({
      deps: { addJobEvent: (_job: any, event: any) => events.push(event) }
    });
    const send = vi.fn(() => true);
    const first = service.enqueueRun({ ...roverParams(), evaluationRunId: 'evaluation-rover' });
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
    expect(events.find((event) => event.type === 'completed')).toMatchObject({
      type: 'completed',
      payload: { runId: 'evaluation-rover' }
    });
    expect(service.jobs.get(second.jobId)?.status).toBe('running');
  });

  it('pauses a running Rover job when Rover reports an assignment error', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const queued = service.enqueueRun(roverParams());
    service.assignRoverJob('claude', send);

    service.handleRoverMessage(
      {
        type: 'progress',
        jobId: queued.jobId,
        completed: 0,
        total: 1,
        error: 'Provider is unavailable',
        message: 'Rover could not start the assignment'
      },
      'claude',
      send
    );

    expect(service.jobs.get(queued.jobId)?.status).toBe('paused_rover');
    expect(service.state.queue).toContain(queued.jobId);
  });

  it('tracks scenario-level Rover status updates', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const queued = service.enqueueRun({
      ...roverParams(),
      evaluationRunId: 'evaluation-rover'
    });
    service.assignRoverJob('claude', send);

    service.handleRoverMessage(
      {
        type: 'scenario_status',
        jobId: queued.jobId,
        scenarioId: 's1',
        status: 'running',
        completed: 0,
        total: 1
      },
      'claude',
      send
    );

    expect(service.jobs.get(queued.jobId)?.childProgress).toEqual([
      expect.objectContaining({ scenarioId: 's1', agentName: 'claude', status: 'running' })
    ]);
  });

  it('does not let a stale Rover status move a completed child backwards', () => {
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const queued = service.enqueueRun({ ...roverParams(), evaluationRunId: 'evaluation-stale' });
    service.assignRoverJob('claude', send);

    service.handleRoverMessage(
      {
        type: 'scenario_status',
        jobId: queued.jobId,
        scenarioId: 's1',
        status: 'completed',
        completed: 1,
        total: 1
      },
      'claude',
      send
    );
    service.handleRoverMessage(
      {
        type: 'scenario_status',
        jobId: queued.jobId,
        scenarioId: 's1',
        status: 'running',
        completed: 0,
        total: 1
      },
      'claude',
      send
    );

    expect(service.jobs.get(queued.jobId)?.childProgress?.[0]?.status).toBe('completed');
  });

  it('labels Rover progress logs with the agent name', () => {
    const events: any[] = [];
    const service = createRunQueueServiceForTest({
      deps: { addJobEvent: (_job: any, event: any) => events.push(event) }
    });
    const send = vi.fn(() => true);
    const queued = service.enqueueRun({ ...roverParams(), evaluationRunId: 'evaluation-logs' });
    service.assignRoverJob('claude', send);

    service.handleRoverMessage(
      { type: 'stage', jobId: queued.jobId, scenarioId: 's1', stage: 'prompt_sent' },
      'claude',
      send
    );

    expect(events.at(-1)).toMatchObject({
      payload: { message: expect.stringContaining('[agent=claude]') }
    });
  });

  it('sends a scenario-specific stop command for a Rover child', () => {
    const sendRoverMessage = vi.fn(() => true);
    const service = createRunQueueServiceForTest();
    const send = vi.fn(() => true);
    const { jobId } = service.enqueueRun({
      ...roverParams(),
      evaluationRunId: 'evaluation-rover-2'
    });
    service.assignRoverJob('claude', send);
    expect(service.stopRoverScenario(jobId, 's1')).toMatchObject({ ok: true, status: 'stopped' });
  });

  it('aborts only the selected LLM child', () => {
    const service = createRunQueueServiceForTest();
    const job = createQueuedJob('/tmp/eval.yaml', 'llm-job');
    job.childProgress = [
      { scenarioId: 's1', agentName: 'agent', completed: 0, total: 1, status: 'running' },
      { scenarioId: 's2', agentName: 'agent', completed: 0, total: 1, status: 'queued' }
    ];
    const controller = new AbortController();
    job.childAbortControllers = new Map([['s1:agent', controller]]);
    service.jobs.set(job.id, job);

    expect(service.stopScenario(job.id, 's1', 'agent')).toMatchObject({
      ok: true,
      status: 'stopped'
    });
    expect(controller.signal.aborted).toBe(true);
    expect(job.childProgress?.[0]?.status).toBe('stopped');
    expect(job.childProgress?.[1]?.status).toBe('queued');
  });

  it('stops the requested agent when two agents share a scenario id', () => {
    const service = createRunQueueServiceForTest();
    const job = createQueuedJob('/tmp/eval.yaml', 'multi-agent-job');
    const firstController = new AbortController();
    const secondController = new AbortController();
    job.childProgress = [
      { scenarioId: 's1', agentName: 'agent-a', completed: 0, total: 1, status: 'running' },
      { scenarioId: 's1', agentName: 'agent-b', completed: 0, total: 1, status: 'running' }
    ];
    job.childAbortControllers = new Map([
      ['s1:agent-a', firstController],
      ['s1:agent-b', secondController]
    ]);
    service.jobs.set(job.id, job);

    expect(service.stopScenario(job.id, 's1', 'agent-b')).toMatchObject({
      ok: true,
      status: 'stopped'
    });
    expect(firstController.signal.aborted).toBe(false);
    expect(secondController.signal.aborted).toBe(true);
    expect(job.childProgress?.[0]?.status).toBe('running');
    expect(job.childProgress?.[1]?.status).toBe('stopped');
  });
});
