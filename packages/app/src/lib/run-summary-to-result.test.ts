import { describe, expect, it } from 'vitest';
import type { WorkspaceRunSummary } from '@/lib/data-sources/types';
import { summaryToResult } from './run-summary-to-result';

describe('summaryToResult', () => {
  it('preserves MCP server versions', () => {
    const summary: WorkspaceRunSummary = {
      runId: 'run-1',
      path: '/tmp/run-1',
      timestamp: '2026-03-10T10:00:00.000Z',
      configHash: 'hash',
      totalScenarios: 1,
      totalRuns: 1,
      passRate: 1,
      avgToolCalls: 1,
      avgLatencyMs: 100,
      mcpServerVersions: { api: '1.2.3', docs: null }
    };

    expect(summaryToResult(summary).mcpServerVersions).toEqual({ api: '1.2.3', docs: null });
  });
});
