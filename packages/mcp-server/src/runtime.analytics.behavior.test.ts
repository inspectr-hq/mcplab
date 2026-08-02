import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type RegisteredTool = {
  cb: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

type MetricSummary = {
  total_runs: number;
  passed_runs: number;
  failed_runs: number;
  pass_rate: number;
  avg_tool_calls_per_run: number;
  avg_tool_latency_ms: number | null;
};

type AggregateRow = {
  key: string;
  scenario_id?: string;
  summary: MetricSummary;
};

type CompareRow = {
  key: string;
  classification: 'regressed' | 'improved' | 'unchanged' | 'new' | 'missing';
  left: MetricSummary | null;
  right: MetricSummary | null;
  deltas: {
    pass_rate: number | null;
    failed_runs: number | null;
    avg_tool_calls_per_run: number | null;
    avg_tool_latency_ms: number | null;
  };
};

type AggregateReport = {
  top_worst: AggregateRow[];
  top_best: AggregateRow[];
  details?: AggregateRow[];
};

type CompareReport = {
  regressions: CompareRow[];
  improvements: CompareRow[];
  new_items: CompareRow[];
  missing_items: CompareRow[];
  details?: CompareRow[];
};

function toolResult<T>(value: unknown): { isError?: boolean; structuredContent: T } {
  return value as { isError?: boolean; structuredContent: T };
}

const originalEnvironment = { ...process.env };
const originalCwd = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

async function setupTools(
  bundleRoot: string,
  runsDir: string
): Promise<Map<string, RegisteredTool>> {
  process.chdir(join(bundleRoot, '..'));
  process.env.MCPLAB_BUNDLE_ROOT = bundleRoot;
  process.env.MCPLAB_RUNS_DIR = runsDir;
  vi.resetModules();
  const { registerTools } = await import('./runtime.js');
  const tools = new Map<string, RegisteredTool>();
  registerTools({
    registerTool: (name: string, _config: unknown, cb: RegisteredTool['cb']) => {
      tools.set(name, { cb });
      return { name };
    }
  } as any);
  return tools;
}

function writeRun(
  runsDir: string,
  runId: string,
  timestamp: string,
  configHash: string,
  scenarios: Array<{
    scenario_id: string;
    agent: string;
    runs: Array<{ pass: boolean; tool_call_count: number; tool_durations_ms: number[] }>;
  }>
) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'results.json'),
    JSON.stringify({
      metadata: {
        run_id: runId,
        timestamp,
        config_hash: configHash,
        cli_version: 'test',
        mcp_server_versions: {}
      },
      summary: {},
      scenarios
    }),
    'utf8'
  );
}

const scenario = (
  scenario_id: string,
  agent: string,
  ...runs: Array<{ pass: boolean; tool_call_count: number; tool_durations_ms: number[] }>
) => ({ scenario_id, agent, runs });

describe('mcp analytics tool behavior', () => {
  it('aggregates selected runs with scenario and agent filters into grouped summaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-analytics-'));
    temporaryRoots.push(root);
    const runsDir = 'runs';
    const runsPath = join(root, runsDir);
    mkdirSync(join(root, 'library'), { recursive: true });
    writeRun(runsPath, 'run-old', '2026-08-01T10:00:00.000Z', 'old-hash', [
      scenario('checkout', 'agent-a', { pass: false, tool_call_count: 4, tool_durations_ms: [300] }),
      scenario('checkout', 'agent-b', { pass: true, tool_call_count: 1, tool_durations_ms: [10] }),
      scenario('search', 'agent-a', { pass: true, tool_call_count: 1, tool_durations_ms: [50] })
    ]);
    writeRun(runsPath, 'run-middle', '2026-08-01T11:00:00.000Z', 'middle-hash', [
      scenario('checkout', 'agent-a', { pass: true, tool_call_count: 9, tool_durations_ms: [900] })
    ]);
    writeRun(runsPath, 'run-new', '2026-08-01T12:00:00.000Z', 'new-hash', [
      scenario('checkout', 'agent-a', { pass: true, tool_call_count: 2, tool_durations_ms: [100] }),
      scenario('search', 'agent-a', { pass: true, tool_call_count: 7, tool_durations_ms: [700] })
    ]);

    const tools = await setupTools(join(root, 'library'), runsDir);
    const result = toolResult<AggregateReport>(await tools.get('mcplab_aggregate_runs')!.cb({
      run_ids: ['run-new', 'run-old'],
      scenario_ids: ['checkout', 'search'],
      agents: ['agent-a'],
      group_by: 'scenario',
      top_n: 1,
      include_details: true
    }));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      runs: [
        { run_id: 'run-new', timestamp: '2026-08-01T12:00:00.000Z', config_hash: 'new-hash' },
        { run_id: 'run-old', timestamp: '2026-08-01T10:00:00.000Z', config_hash: 'old-hash' }
      ],
      group_by: 'scenario',
      filters: { scenario_ids: ['checkout', 'search'], agents: ['agent-a'] },
      summary: {
        total_runs: 4,
        passed_runs: 3,
        failed_runs: 1,
        pass_rate: 0.75,
        avg_tool_calls_per_run: 3.5,
        avg_tool_latency_ms: 287.5,
        selected_run_count: 2
      },
      top_worst: [
        {
          key: 'checkout',
          scenario_id: 'checkout',
          run_count: 2,
          summary: {
            total_runs: 2,
            passed_runs: 1,
            failed_runs: 1,
            pass_rate: 0.5,
            avg_tool_calls_per_run: 3,
            avg_tool_latency_ms: 200
          }
        }
      ],
      top_best: [
        {
          key: 'search',
          scenario_id: 'search',
          run_count: 2,
          summary: {
            total_runs: 2,
            passed_runs: 2,
            failed_runs: 0,
            pass_rate: 1,
            avg_tool_calls_per_run: 4,
            avg_tool_latency_ms: 375
          }
        }
      ],
      details: expect.arrayContaining([
        expect.objectContaining({
          key: 'checkout',
          summary: expect.objectContaining({
            avg_tool_calls_per_run: 3,
            avg_tool_latency_ms: 200
          })
        }),
        expect.objectContaining({
          key: 'search',
          summary: expect.objectContaining({
            avg_tool_calls_per_run: 4,
            avg_tool_latency_ms: 375
          })
        })
      ])
    });
    expect(result.structuredContent.top_worst.map((row) => row.key)).toEqual(['checkout']);
    expect(result.structuredContent.top_best.map((row) => row.key)).toEqual(['search']);
    expect(result.structuredContent.details?.map((row) => row.key)).toEqual([
      'checkout',
      'search'
    ]);
  });

  it('compares filtered runs with metric deltas and regression classifications', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-mcp-compare-'));
    temporaryRoots.push(root);
    const runsDir = 'runs';
    const runsPath = join(root, runsDir);
    mkdirSync(join(root, 'library'), { recursive: true });
    writeRun(runsPath, 'left', '2026-08-01T10:00:00.000Z', 'left-hash', [
      scenario('checkout', 'agent-a', { pass: false, tool_call_count: 4, tool_durations_ms: [100] }),
      scenario('search', 'agent-a', { pass: true, tool_call_count: 1, tool_durations_ms: [50] }),
      scenario('stable', 'agent-a', { pass: true, tool_call_count: 2, tool_durations_ms: [60] }),
      scenario('removed', 'agent-a', { pass: false, tool_call_count: 3, tool_durations_ms: [70] }),
      scenario('unrelated-left', 'agent-a', { pass: true, tool_call_count: 20, tool_durations_ms: [2000] }),
      scenario('checkout', 'agent-b', { pass: true, tool_call_count: 1, tool_durations_ms: [1] })
    ]);
    writeRun(runsPath, 'right', '2026-08-01T12:00:00.000Z', 'right-hash', [
      scenario('checkout', 'agent-a', { pass: true, tool_call_count: 2, tool_durations_ms: [50] }),
      scenario('search', 'agent-a', { pass: false, tool_call_count: 3, tool_durations_ms: [150] }),
      scenario('stable', 'agent-a', { pass: true, tool_call_count: 2, tool_durations_ms: [60] }),
      scenario('added', 'agent-a', { pass: true, tool_call_count: 1, tool_durations_ms: [40] }),
      scenario('unrelated-right', 'agent-a', { pass: false, tool_call_count: 20, tool_durations_ms: [2000] }),
      scenario('checkout', 'agent-b', { pass: false, tool_call_count: 9, tool_durations_ms: [900] })
    ]);

    const tools = await setupTools(join(root, 'library'), runsDir);
    const result = toolResult<CompareReport>(await tools.get('mcplab_compare_runs')!.cb({
      left_run_id: 'left',
      right_run_id: 'right',
      scenario_ids: ['checkout', 'search', 'stable', 'removed', 'added'],
      agents: ['agent-a'],
      top_n: 1,
      include_details: true
    }));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      left_run: { run_id: 'left', config_hash: 'left-hash' },
      right_run: { run_id: 'right', config_hash: 'right-hash' },
      filters: {
        scenario_ids: ['checkout', 'search', 'stable', 'removed', 'added'],
        agents: ['agent-a']
      },
      summary: {
        left: { total_runs: 4, passed_runs: 2, failed_runs: 2, pass_rate: 0.5, avg_tool_calls_per_run: 2.5 },
        right: { total_runs: 4, passed_runs: 3, failed_runs: 1, pass_rate: 0.75, avg_tool_calls_per_run: 2 },
        deltas: { pass_rate: 0.25, failed_runs: -1, avg_tool_calls_per_run: -0.5, avg_tool_latency_ms: 5 },
        classification_counts: { regressed: 1, improved: 1, unchanged: 1, new: 1, missing: 1 }
      },
      regressions: expect.arrayContaining([
        expect.objectContaining({
          key: 'search::agent-a',
          classification: 'regressed',
          left: {
            total_runs: 1,
            passed_runs: 1,
            failed_runs: 0,
            pass_rate: 1,
            avg_tool_calls_per_run: 1,
            avg_tool_latency_ms: 50
          },
          right: {
            total_runs: 1,
            passed_runs: 0,
            failed_runs: 1,
            pass_rate: 0,
            avg_tool_calls_per_run: 3,
            avg_tool_latency_ms: 150
          },
          deltas: {
            pass_rate: -1,
            failed_runs: 1,
            avg_tool_calls_per_run: 2,
            avg_tool_latency_ms: 100
          }
        })
      ]),
      improvements: expect.arrayContaining([
        expect.objectContaining({
          key: 'checkout::agent-a',
          classification: 'improved',
          left: {
            total_runs: 1,
            passed_runs: 0,
            failed_runs: 1,
            pass_rate: 0,
            avg_tool_calls_per_run: 4,
            avg_tool_latency_ms: 100
          },
          right: {
            total_runs: 1,
            passed_runs: 1,
            failed_runs: 0,
            pass_rate: 1,
            avg_tool_calls_per_run: 2,
            avg_tool_latency_ms: 50
          },
          deltas: {
            pass_rate: 1,
            failed_runs: -1,
            avg_tool_calls_per_run: -2,
            avg_tool_latency_ms: -50
          }
        })
      ]),
      new_items: expect.arrayContaining([
        expect.objectContaining({ key: 'added::agent-a', classification: 'new' })
      ]),
      missing_items: expect.arrayContaining([
        expect.objectContaining({ key: 'removed::agent-a', classification: 'missing' })
      ]),
      details: expect.arrayContaining([
        expect.objectContaining({
          key: 'stable::agent-a',
          classification: 'unchanged',
          deltas: {
            pass_rate: 0,
            failed_runs: 0,
            avg_tool_calls_per_run: 0,
            avg_tool_latency_ms: 0
          }
        })
      ])
    });
    const detailKeys = result.structuredContent.details?.map((row) => row.key).sort();
    expect(detailKeys).toEqual([
      'added::agent-a',
      'checkout::agent-a',
      'removed::agent-a',
      'search::agent-a',
      'stable::agent-a'
    ]);
    expect(detailKeys).not.toContain('unrelated-left::agent-a');
    expect(detailKeys).not.toContain('unrelated-right::agent-a');
    expect(detailKeys).not.toContain('checkout::agent-b');
  });
});
