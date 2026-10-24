import { describe, expect, it, vi } from 'vitest';
import { rerunWithSameSettings } from './rerun-run';
import type { EvalResult } from '@/types/eval';
import type { EvalDataSource } from '@/lib/data-sources/types';

function makeRunResult(): EvalResult {
  return {
    id: 'run-1',
    configId: 'cfg-1',
    configHash: 'hash-1',
    configPath: 'eval.yaml',
    timestamp: '2026-06-08T00:00:00.000Z',
    mcpServerVersions: {},
    scenarios: [
      {
        scenarioId: 'scn-1',
        scenarioName: 'Scenario 1',
        agentId: 'agent-from-scenarios',
        agentName: 'Agent From Scenarios',
        runs: [],
        passRate: 1,
        avgToolCalls: 0,
        avgDuration: 0
      }
    ],
    overallPassRate: 1,
    totalScenarios: 1,
    totalRuns: 1,
    avgToolCalls: 0,
    avgLatency: 0
  };
}

describe('rerunWithSameSettings', () => {
  it('uses stored rerunAgents as the exact replay set when present', async () => {
    const source = {
      getResult: vi.fn(),
      startRun: vi.fn().mockResolvedValue({ jobId: 'job-1' })
    } as unknown as EvalDataSource;
    const summary = makeRunResult();
    const detailed = {
      ...makeRunResult(),
      rerunAgents: ['agent-explicit-a', 'agent-explicit-b'],
      rerunScenarioIds: ['scn-1'],
      rerunServerOverrideAll: ['replacement-server'],
      rerunScenarioServerOverrides: { 'scn-1': ['scenario-server'] },
      rerunNewConversationBeforeStart: false,
      rerunNewConversationBetweenScenarios: false
    };
    vi.mocked(source.getResult).mockResolvedValue(detailed);

    await rerunWithSameSettings(source, summary);

    expect(source.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: 'eval.yaml',
        scenarioIds: ['scn-1'],
        agents: ['agent-explicit-a', 'agent-explicit-b'],
        servers: ['replacement-server'],
        scenarioServerOverrides: { 'scn-1': ['scenario-server'] },
        newConversationBeforeStart: false,
        newConversationBetweenScenarios: false
      })
    );
  });
});

it('replays all sets and the original repetition count without legacy overrides', async () => {
  const run = makeRunResult();
  run.rerun_server_variants = [
    { id: 'A', scenarioServerOverrides: { 'scn-1': ['baseline'] } },
    { id: 'B', serverIds: ['candidate'] }
  ];
  run.rerun_runs_per_scenario = 3;
  run.rerunServerOverrideAll = ['stale'];
  const source = {
    getResult: vi.fn().mockResolvedValue(run),
    startRun: vi.fn()
  } as unknown as EvalDataSource;
  await rerunWithSameSettings(source, run);
  expect(source.startRun).toHaveBeenCalledWith(
    expect.objectContaining({
      server_sets: [
        { id: 'A', scenarioServerOverrides: { 'scn-1': ['baseline'] } },
        { id: 'B', servers: ['candidate'] }
      ],
      runsPerScenario: 3
    })
  );
  expect(vi.mocked(source.startRun).mock.calls[0][0].servers).toBeUndefined();
});
