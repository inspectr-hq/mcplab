import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceSource } from './workspace-source';
import { workspaceApiClient } from './workspace-api-client';

vi.mock('./workspace-api-client', () => ({
  workspaceApiClient: {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getRunTrace: vi.fn(),
    updateConfig: vi.fn(),
    testDecisionConnection: vi.fn(),
    testAgentConnection: vi.fn()
  }
}));

describe('workspaceSource.listResults', () => {
  beforeEach(() => {
    vi.mocked(workspaceApiClient.listRuns).mockReset();
    vi.mocked(workspaceApiClient.getRun).mockReset();
    vi.mocked(workspaceApiClient.getRunTrace).mockReset();
  });

  it('loads every page of run summaries before fetching detailed results', async () => {
    vi.mocked(workspaceApiClient.listRuns)
      .mockResolvedValueOnce({
        object: 'list',
        url: '/api/runs?limit=2&offset=0',
        data: [
          {
            runId: 'run-3',
            path: '/tmp/run-3',
            timestamp: '2026-06-12T21:37:26.973Z',
            configHash: 'hash-3',
            totalScenarios: 1,
            totalRuns: 1,
            passRate: 1,
            avgToolCalls: 2,
            avgLatencyMs: 300
          },
          {
            runId: 'run-2',
            path: '/tmp/run-2',
            timestamp: '2026-06-12T18:11:53.922Z',
            configHash: 'hash-2',
            totalScenarios: 1,
            totalRuns: 1,
            passRate: 0.5,
            avgToolCalls: 3,
            avgLatencyMs: 400
          }
        ],
        has_more: true,
        total_count: 3,
        next_offset: 2,
        prev_offset: null
      } as Awaited<ReturnType<typeof workspaceApiClient.listRuns>>)
      .mockResolvedValueOnce({
        object: 'list',
        url: '/api/runs?limit=2&offset=2',
        data: [
          {
            runId: 'run-1',
            path: '/tmp/run-1',
            timestamp: '2026-06-12T12:00:00.000Z',
            configHash: 'hash-1',
            totalScenarios: 1,
            totalRuns: 1,
            passRate: 0,
            avgToolCalls: 1,
            avgLatencyMs: 500
          }
        ],
        has_more: false,
        total_count: 3,
        next_offset: null,
        prev_offset: 0
      } as Awaited<ReturnType<typeof workspaceApiClient.listRuns>>);

    vi.mocked(workspaceApiClient.getRun).mockImplementation(async (runId: string) => ({
      runId,
      results: {
        metadata: {
          run_id: runId,
          timestamp: '2026-06-12T21:37:26.973Z',
          config_hash: `cfg-${runId}`,
          cli_version: '',
          mcp_server_versions: {}
        },
        summary: {
          total_scenarios: 1,
          total_runs: 1,
          pass_rate: 1,
          avg_tool_calls_per_run: 2,
          avg_tool_latency_ms: 300
        },
        scenarios: []
      }
    }));

    vi.mocked(workspaceApiClient.getRunTrace).mockResolvedValue({ runId: 'any', records: [] });

    const results = await workspaceSource.listResults({
      since: '2026-05-13T22:35:47.719Z',
      until: '2026-06-12T22:35:47.719Z'
    });

    expect(workspaceApiClient.listRuns).toHaveBeenNthCalledWith(1, {
      since: '2026-05-13T22:35:47.719Z',
      until: '2026-06-12T22:35:47.719Z',
      limit: 100,
      offset: 0
    });
    expect(workspaceApiClient.listRuns).toHaveBeenNthCalledWith(2, {
      since: '2026-05-13T22:35:47.719Z',
      until: '2026-06-12T22:35:47.719Z',
      limit: 100,
      offset: 2
    });
    expect(results).toHaveLength(3);
    expect(workspaceApiClient.getRun).toHaveBeenCalledTimes(3);
    expect(workspaceApiClient.getRunTrace).toHaveBeenCalledTimes(3);
  });
});

describe('workspaceSource.updateConfig', () => {
  it('preserves the existing YAML filename when the display name changes', async () => {
    vi.mocked(workspaceApiClient.updateConfig).mockResolvedValue({
      id: 'cfg-1',
      name: 'original',
      path: '/workspace/evals/original.yaml',
      relativePath: 'original.yaml',
      mtime: '2026-06-12T00:00:00.000Z',
      hash: 'hash-1',
      config: { name: 'Renamed display name', agents: [], scenarios: [] }
    });

    await workspaceSource.updateConfig({
      id: 'cfg-1',
      name: 'Renamed display name',
      configName: 'Renamed display name',
      sourcePath: '/workspace/evals/original.yaml',
      relativePath: 'original.yaml',
      servers: [],
      agents: [],
      scenarios: [],
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z'
    });

    expect(workspaceApiClient.updateConfig).toHaveBeenCalledWith(
      'cfg-1',
      expect.objectContaining({ name: 'Renamed display name' })
    );
  });
});

describe('workspaceSource.testDecisionConnection', () => {
  it('converts a Foundry editor draft to the core agent contract for inference testing', async () => {
    const result = {
      ok: true,
      provider: 'azure_foundry' as const,
      requestedModel: 'deployment',
      durationMs: 10,
      message: 'Responded'
    };
    vi.mocked(workspaceApiClient.testAgentConnection).mockResolvedValue(result);
    const controller = new AbortController();
    const draft = {
      id: 'foundry',
      name: 'Foundry',
      type: 'llm' as const,
      provider: 'azure_foundry' as const,
      model: 'deployment',
      maxTokens: 512
    };
    expect(await workspaceSource.testAgentConnection(draft, controller.signal)).toEqual(result);
    expect(workspaceApiClient.testAgentConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'azure_foundry', model: 'deployment', max_tokens: 512 }),
      controller.signal
    );
  });
  it('forwards the draft configuration, cancellation signal, and result', async () => {
    const config = {
      provider: 'ollama' as const,
      model: 'tev1:4b',
      passThreshold: 0.9,
      failThreshold: 0.1,
      baseUrl: 'http://ollama:11434'
    };
    const result = {
      ok: true,
      message: 'Connection successful',
      provider: 'ollama' as const,
      requestedModel: config.model,
      probability: 0.5,
      durationMs: 20
    };
    vi.mocked(workspaceApiClient.testDecisionConnection).mockResolvedValue(result);
    const controller = new AbortController();
    expect(await workspaceSource.testDecisionConnection(config, controller.signal)).toEqual(result);
    expect(workspaceApiClient.testDecisionConnection).toHaveBeenCalledWith(
      config,
      controller.signal
    );
  });
});
