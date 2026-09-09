import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendExecutionEvent } from './execution-journal.js';
import { projectEvaluationJournal } from './evaluation-journal-projection.js';

describe('projectEvaluationJournal', () => {
  it('reduces completed child snapshots into one canonical run', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-projection-'));
    try {
      const result = (runId: string, pass: number) => ({
        metadata: { run_id: runId, timestamp: new Date().toISOString(), config_hash: 'hash', cli_version: 'test', mcp_server_versions: {} },
        summary: { total_scenarios: 1, total_runs: 1, pass_rate: pass, avg_tool_calls_per_run: 0, avg_tool_latency_ms: 1, outcomes: { passed: pass ? 1 : 0, failed: pass ? 0 : 1, incomplete: 0, error: 0 } },
        scenarios: []
      });
      appendExecutionEvent(join(root, 'run-1'), { eventId: 'child-1', type: 'child_result_completed', ts: new Date().toISOString(), results: result('llm-1', 1) });
      appendExecutionEvent(join(root, 'run-1'), { eventId: 'child-2', type: 'child_result_completed', ts: new Date().toISOString(), results: result('rover-1', 0) });
      const projected = projectEvaluationJournal({ runsDir: root, evaluationRunId: 'run-1', evaluationName: 'Batch quality' });
      expect(projected?.metadata.run_id).toBe('run-1');
      expect(projected?.metadata.config_name).toBe('Batch quality');
      expect(projected?.summary.total_runs).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
