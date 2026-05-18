import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listRuns } from './runs-store.js';

function writeRun(runsDir: string, runId: string, timestamp: string) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'results.json'),
    JSON.stringify({
      metadata: {
        run_id: runId,
        timestamp,
        config_hash: `hash-${runId}`
      },
      summary: {
        total_scenarios: 1,
        total_runs: 1,
        pass_rate: 1,
        avg_tool_calls_per_run: 1,
        avg_tool_latency_ms: 10
      }
    }),
    'utf8'
  );
}

describe('listRuns filters', () => {
  it('filters runs by lastDays', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    const now = Date.now();
    writeRun(runsDir, 'run-old', new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString());
    writeRun(runsDir, 'run-new', new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString());

    const runs = listRuns(runsDir, { lastDays: 30 });
    expect(runs.map((item) => item.runId)).toEqual(['run-new']);
  });

  it('filters runs by since/until range', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    const now = Date.now();
    const tsA = new Date(now - 20 * 60 * 1000).toISOString();
    const tsB = new Date(now - 10 * 60 * 1000).toISOString();
    const tsC = new Date(now - 2 * 60 * 1000).toISOString();
    writeRun(runsDir, 'run-a', tsA);
    writeRun(runsDir, 'run-b', tsB);
    writeRun(runsDir, 'run-c', tsC);

    const since = new Date(now - 15 * 60 * 1000).toISOString();
    const until = new Date(now - 3 * 60 * 1000).toISOString();
    const runs = listRuns(runsDir, { since, until });
    expect(runs.map((item) => item.runId)).toEqual(['run-b']);
  });
});
