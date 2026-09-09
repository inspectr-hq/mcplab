import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendExecutionEvent } from './execution-journal.js';
import { recoverJournalSnapshots } from './app-run-artifacts.js';

describe('recoverJournalSnapshots', () => {
  it('rebuilds missing result projections from the latest snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-recovery-'));
    const runDir = join(root, 'run-1');
    try {
      appendExecutionEvent(runDir, {
        eventId: 'snapshot-1',
        type: 'result_snapshot',
        ts: new Date().toISOString(),
        results: {
          metadata: {
            run_id: 'run-1',
            timestamp: new Date().toISOString(),
            config_hash: 'x',
            cli_version: 'test',
            mcp_server_versions: {}
          },
          summary: {
            total_scenarios: 0,
            total_runs: 0,
            pass_rate: 0,
            avg_tool_calls_per_run: 0,
            avg_tool_latency_ms: null
          },
          scenarios: []
        }
      });
      expect(recoverJournalSnapshots(root)).toBe(1);
      unlinkSync(join(runDir, 'summary.md'));
      expect(recoverJournalSnapshots(root)).toBe(1);
      expect(existsSync(join(runDir, 'summary.md'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
