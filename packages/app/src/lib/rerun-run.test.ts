import { describe, expect, it, vi } from 'vitest';
import { rerunWithSameSettings } from './rerun-run';
import type { EvalConfig, EvalResult } from '@/types/eval';
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
  it('resolves stale stored paths from the current config catalog', async () => {
    const source = {
      getResult: vi.fn().mockResolvedValue({
        ...makeRunResult(),
        configPath: '/old/workspace/mcplab/evals/mpclab/two- scenarios.yaml',
        configName: 'Two scenarios',
        configHash: 'stale-hash'
      }),
      listConfigs: vi.fn().mockResolvedValue([
        {
          id: 'cfg-1',
          name: 'Two scenarios',
          configName: 'Two scenarios',
          configHash: 'current-hash',
          relativePath: 'mpclab/two-scenarios.yaml',
          agents: [],
          scenarios: []
        }
      ]),
      startRun: vi.fn().mockResolvedValue({ jobId: 'job-1' })
    } as unknown as EvalDataSource;

    await rerunWithSameSettings(source, makeRunResult());

    expect(source.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: 'mpclab/two-scenarios.yaml' })
    );
  });

  function sourceWithConfigs(run: EvalResult, configs: Partial<EvalConfig>[]): EvalDataSource {
    return {
      getResult: vi.fn().mockResolvedValue(run),
      listConfigs: vi
        .fn()
        .mockResolvedValue(
          configs.map((config, index) => ({
            id: `cfg-${index}`,
            name: `Config ${index}`,
            ...config
          }))
        ),
      startRun: vi.fn().mockResolvedValue({ jobId: 'job-1' })
    } as unknown as EvalDataSource;
  }

  it('prefers the longest path suffix over a shorter one listed first', async () => {
    const run = {
      ...makeRunResult(),
      configPath: '/old/workspace/mcplab/evals/mpclab/two-scenarios.yaml'
    };
    const source = sourceWithConfigs(run, [
      { relativePath: 'two-scenarios.yaml' },
      { relativePath: 'mpclab/two-scenarios.yaml' }
    ]);

    await rerunWithSameSettings(source, run);

    expect(source.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: 'mpclab/two-scenarios.yaml' })
    );
  });

  it('prefers a unique config hash over a path suffix match', async () => {
    const run = { ...makeRunResult(), configPath: '/old/evals/eval.yaml', configHash: 'h-1' };
    const source = sourceWithConfigs(run, [
      { relativePath: 'eval.yaml', configHash: 'other' },
      { relativePath: 'renamed.yaml', configHash: 'h-1' }
    ]);

    await rerunWithSameSettings(source, run);

    expect(source.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: 'renamed.yaml' })
    );
  });

  it('refuses to guess when several configs share the stored name', async () => {
    const run = { ...makeRunResult(), configPath: 'gone.yaml', configName: 'Shared' };
    const source = sourceWithConfigs(run, [
      { relativePath: 'a.yaml', name: 'Shared' },
      { relativePath: 'b.yaml', name: 'Shared' }
    ]);

    await expect(rerunWithSameSettings(source, run)).rejects.toThrow(
      /2 configs are named "Shared"/
    );
    expect(source.startRun).not.toHaveBeenCalled();
  });

  it('falls back to the stored path when the config catalog cannot be loaded', async () => {
    const run = makeRunResult();
    const source = {
      getResult: vi.fn().mockResolvedValue(run),
      listConfigs: vi.fn().mockRejectedValue(new Error('offline')),
      startRun: vi.fn().mockResolvedValue({ jobId: 'job-1' })
    } as unknown as EvalDataSource;

    await rerunWithSameSettings(source, run);

    expect(source.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: 'eval.yaml' })
    );
  });

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
