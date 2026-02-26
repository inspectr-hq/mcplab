import { describe, it, expect } from 'vitest';
import { aggregateResults, renderSummaryMarkdown } from './results.js';
import type { ScenarioRunResult, EvalRules } from './types.js';

function makeRun(
  pass: boolean,
  tools: string[] = [],
  toolUsage: Record<string, number> = {},
  durations: number[] = [],
): ScenarioRunResult {
  return {
    run_index: 0,
    pass,
    failures: pass ? [] : ['some failure'],
    tool_calls: tools,
    tool_call_count: tools.length,
    tool_sequence: tools,
    tool_usage: toolUsage,
    tool_durations_ms: durations,
    final_text: 'final answer',
    extracted: {},
  };
}

const BASE = {
  runId: 'run-001',
  timestamp: '2024-01-01T00:00:00Z',
  configHash: 'abc123',
  cliVersion: '1.0.0',
};

describe('aggregateResults', () => {
  it('handles empty scenario runs', () => {
    const result = aggregateResults({ ...BASE, scenarioRuns: [] });
    expect(result.summary.total_scenarios).toBe(0);
    expect(result.summary.total_runs).toBe(0);
    expect(result.summary.pass_rate).toBe(0);
    expect(result.scenarios).toHaveLength(0);
  });

  it('computes pass_rate 1.0 when all runs pass', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [makeRun(true), makeRun(true)] }],
    });
    expect(result.summary.pass_rate).toBe(1);
    expect(result.scenarios[0].pass_rate).toBe(1);
  });

  it('computes fractional pass_rate correctly', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        { scenario_id: 's1', agent: 'gpt-4', runs: [makeRun(true), makeRun(false), makeRun(true)] },
      ],
    });
    expect(result.summary.pass_rate).toBeCloseTo(2 / 3);
    expect(result.scenarios[0].pass_rate).toBeCloseTo(2 / 3);
  });

  it('sets pass_rate to 0 when there are no runs', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [] }],
    });
    expect(result.scenarios[0].pass_rate).toBe(0);
  });

  it('accumulates tool_usage_frequency across runs', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'gpt-4',
          runs: [
            makeRun(true, ['search', 'fetch'], { search: 1, fetch: 1 }),
            makeRun(true, ['search'], { search: 2 }),
          ],
        },
      ],
    });
    expect(result.scenarios[0].tool_usage_frequency).toEqual({ search: 3, fetch: 1 });
  });

  it('counts distinct tool sequences', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'gpt-4',
          runs: [makeRun(true, ['a', 'b']), makeRun(true, ['a', 'b']), makeRun(true, ['c'])],
        },
      ],
    });
    expect(Object.keys(result.scenarios[0].distinct_sequences)).toHaveLength(2);
  });

  it('includes metadata fields', () => {
    const result = aggregateResults({ ...BASE, scenarioRuns: [] });
    expect(result.metadata.run_id).toBe('run-001');
    expect(result.metadata.config_hash).toBe('abc123');
    expect(result.metadata.cli_version).toBe('1.0.0');
    expect(result.metadata.git_commit).toBeUndefined();
  });

  it('includes git_commit when provided', () => {
    const result = aggregateResults({ ...BASE, gitCommit: 'deadbeef', scenarioRuns: [] });
    expect(result.metadata.git_commit).toBe('deadbeef');
  });

  it('computes avg_tool_calls_per_run', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'gpt-4',
          runs: [makeRun(true, ['a', 'b']), makeRun(true, ['c'])],
        },
      ],
    });
    expect(result.summary.avg_tool_calls_per_run).toBe(1.5);
  });

  it('computes avg_tool_latency_ms from durations', () => {
    const run = makeRun(true, ['a', 'b'], {}, [100, 200]);
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [run] }],
    });
    expect(result.summary.avg_tool_latency_ms).toBe(150);
  });

  it('sets avg_tool_latency_ms to null when no tool durations exist', () => {
    const run = makeRun(true, [], {}, []);
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [run] }],
    });
    expect(result.summary.avg_tool_latency_ms).toBeNull();
  });

  it('tracks required and forbidden tool stats when eval rules are present', () => {
    const eval_: EvalRules = {
      tool_constraints: { required_tools: ['search'], forbidden_tools: ['delete'] },
    };
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'gpt-4',
          eval: eval_,
          runs: [makeRun(true, ['search'], { search: 1 }), makeRun(true, [], {})],
        },
      ],
    });
    const stats = result.scenarios[0].tool_constraints_stats!;
    expect(stats.required.search).toBe(1);
    expect(stats.forbidden.delete).toBe(0);
  });
});

describe('renderSummaryMarkdown', () => {
  it('contains the header, run-id, and pass-rate', () => {
    const results = aggregateResults({
      ...BASE,
      scenarioRuns: [
        { scenario_id: 'scenario-1', agent: 'gpt-4', runs: [makeRun(true), makeRun(true)] },
      ],
    });
    const md = renderSummaryMarkdown(results);
    expect(md).toContain('# MCP Eval Summary');
    expect(md).toContain('Run ID: run-001');
    expect(md).toContain('Pass rate: 100.0%');
    expect(md).toContain('scenario-1');
    expect(md).toContain('gpt-4');
  });

  it('includes the Git commit line when a commit hash is present', () => {
    const results = aggregateResults({ ...BASE, gitCommit: 'deadbeef', scenarioRuns: [] });
    expect(renderSummaryMarkdown(results)).toContain('Git commit: deadbeef');
  });

  it('omits the Git commit line when no commit hash is provided', () => {
    const results = aggregateResults({ ...BASE, scenarioRuns: [] });
    expect(renderSummaryMarkdown(results)).not.toContain('Git commit');
  });
});
