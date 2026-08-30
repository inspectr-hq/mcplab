import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
      },
      scenarios: [
        {
          scenario_id: 'scn-default',
          scenario_name: 'Default Scenario',
          runs: [
            {
              check_results: [
                { type: 'required_tool', label: 'Required', status: 'passed' },
                { type: 'response_regex', label: 'Response', status: 'failed' },
                { type: 'agent_check', label: 'Judge', status: 'not_evaluated' }
              ]
            }
          ]
        }
      ]
    }),
    'utf8'
  );
}

describe('listRuns filters', () => {
  it('aggregates check counts for dashboard summaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    writeRun(runsDir, 'run-checks', '2026-03-10T10:00:00.000Z');

    expect(listRuns(runsDir)[0]?.checkCounts).toEqual({
      passed: 1,
      failed: 1,
      not_evaluated: 1,
      total: 3
    });
  });

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

  it('includes runs exactly on since/until boundaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    const since = '2026-03-10T10:00:00.000Z';
    const until = '2026-03-10T11:00:00.000Z';
    writeRun(runsDir, 'run-at-since', since);
    writeRun(runsDir, 'run-at-until', until);
    writeRun(runsDir, 'run-outside', '2026-03-10T11:00:00.001Z');

    const runs = listRuns(runsDir, { since, until });
    expect(runs.map((item) => item.runId)).toEqual(['run-at-until', 'run-at-since']);
  });

  it('uses stricter lower bound when since and lastDays are both set', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    const now = Date.now();
    const olderThanSince = new Date(now - 11 * 24 * 60 * 60 * 1000).toISOString();
    const withinSince = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
    writeRun(runsDir, 'run-old', olderThanSince);
    writeRun(runsDir, 'run-new', withinSince);

    const since = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const runs = listRuns(runsDir, { since, lastDays: 30 });
    expect(runs.map((item) => item.runId)).toEqual(['run-new']);
  });

  it('treats malformed since/until as unset filters', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    writeRun(runsDir, 'run-a', '2026-03-10T10:00:00.000Z');
    writeRun(runsDir, 'run-b', '2026-03-11T10:00:00.000Z');

    const runs = listRuns(runsDir, { since: 'not-a-date', until: 'bad-date' });
    expect(runs.map((item) => item.runId)).toEqual(['run-b', 'run-a']);
  });

  it('filters runs by scenario id or scenario name', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-runs-store-'));
    const runsDir = join(root, 'runs');
    mkdirSync(runsDir, { recursive: true });

    writeRun(runsDir, 'run-a', '2026-03-10T10:00:00.000Z');
    writeRun(runsDir, 'run-b', '2026-03-11T10:00:00.000Z');

    const runBPath = join(runsDir, 'run-b', 'results.json');
    const runB = JSON.parse(readFileSync(runBPath, 'utf8'));
    runB.scenarios = [{ scenario_id: 'scn-target', scenario_name: 'Target Scenario' }];
    writeFileSync(runBPath, JSON.stringify(runB), 'utf8');

    expect(listRuns(runsDir, { scenario: 'scn-target' }).map((item) => item.runId)).toEqual([
      'run-b'
    ]);
    expect(listRuns(runsDir, { scenario: 'Target Scenario' }).map((item) => item.runId)).toEqual([
      'run-b'
    ]);
  });
});
