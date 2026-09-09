import { describe, expect, it } from 'vitest';
import { aggregateEvaluationGroupResults } from './evaluation-group-results.js';
import type { ResultsJson } from '@inspectr/mcplab-core';

function child(runId: string, passed: number, total: number): ResultsJson {
  return {
    metadata: { run_id: runId, timestamp: '2026-09-09T00:00:00.000Z', config_hash: 'hash', cli_version: 'test', mcp_server_versions: {} },
    summary: { total_scenarios: 1, total_runs: total, pass_rate: passed / total, avg_tool_calls_per_run: 2, avg_tool_latency_ms: 10, outcomes: { passed, failed: total - passed, incomplete: 0, error: 0 } },
    scenarios: []
  };
}

describe('aggregateEvaluationGroupResults', () => {
  it('combines child summaries and scenarios into one parent result', () => {
    const result = aggregateEvaluationGroupResults({ groupId: 'group-1', runId: 'parent-1', children: [child('llm-1', 1, 1), child('rover-1', 0, 1)] });
    expect(result.metadata.run_id).toBe('parent-1');
    expect(result.summary.total_runs).toBe(2);
    expect(result.summary.pass_rate).toBe(0.5);
    expect(result.summary.outcomes).toEqual({ passed: 1, failed: 1, incomplete: 0, error: 0 });
  });
});
