import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceSource } from './workspace-source';
import { workspaceApiClient } from './workspace-api-client';

vi.mock('./workspace-api-client', () => ({
  workspaceApiClient: {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getRunTrace: vi.fn()
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
      } as any)
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
      } as any);

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
