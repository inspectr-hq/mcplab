import { describe, it, expect } from 'vitest';
import { aggregateResults, normalizeResultsJson, renderSummaryMarkdown } from './results.js';
import type { ScenarioRunResult, EvalRules } from './types.js';

function makeRun(
  pass: boolean,
  tools: string[] = [],
  toolUsage: Record<string, number> = {},
  durations: number[] = []
): ScenarioRunResult {
  return {
    run_index: 0,
    pass,
    failures: pass ? [] : [{ message: 'some failure', severity: 'error' as const }],
    error_failures: pass ? 0 : 1,
    warning_failures: 0,
    tool_calls: tools,
    tool_call_count: tools.length,
    tool_sequence: tools,
    tool_usage: toolUsage,
    tool_durations_ms: durations,
    final_text: 'final answer',
    extracted: {}
  };
}

const BASE = {
  runId: 'run-001',
  timestamp: '2024-01-01T00:00:00Z',
  configHash: 'abc123',
  cliVersion: '1.0.0'
};

describe('aggregateResults', () => {
  it('handles empty scenario runs', () => {
    const result = aggregateResults({ ...BASE, scenarioRuns: [] });
    expect(result.summary.total_scenarios).toBe(0);
    expect(result.summary.total_runs).toBe(0);
    expect(result.summary.pass_rate).toBe(0);
    expect(result.scenarios).toHaveLength(0);
  });

  it('passes provider and model through to scenario aggregate', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'claude',
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          runs: [makeRun(true)]
        }
      ]
    });
    expect(result.scenarios[0].provider).toBe('anthropic');
    expect(result.scenarios[0].model).toBe('claude-haiku-4-5-20251001');
  });

  it('leaves provider and model undefined when not supplied', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [makeRun(true)] }]
    });
    expect(result.scenarios[0].provider).toBeUndefined();
    expect(result.scenarios[0].model).toBeUndefined();
  });

  it('computes pass_rate 1.0 when all runs pass', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [makeRun(true), makeRun(true)] }]
    });
    expect(result.summary.pass_rate).toBe(1);
    expect(result.scenarios[0].pass_rate).toBe(1);
  });

  it('computes fractional pass_rate correctly', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        { scenario_id: 's1', agent: 'gpt-4', runs: [makeRun(true), makeRun(false), makeRun(true)] }
      ]
    });
    expect(result.summary.pass_rate).toBeCloseTo(2 / 3);
    expect(result.scenarios[0].pass_rate).toBeCloseTo(2 / 3);
  });

  it('sets pass_rate to 0 when there are no runs', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [] }]
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
            makeRun(true, ['search'], { search: 2 })
          ]
        }
      ]
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
          runs: [makeRun(true, ['a', 'b']), makeRun(true, ['a', 'b']), makeRun(true, ['c'])]
        }
      ]
    });
    expect(Object.keys(result.scenarios[0].distinct_sequences)).toHaveLength(2);
  });

  it('includes metadata fields', () => {
    const result = aggregateResults({ ...BASE, scenarioRuns: [] });
    expect(result.metadata.run_id).toBe('run-001');
    expect(result.metadata.config_hash).toBe('abc123');
    expect(result.metadata.cli_version).toBe('1.0.0');
    expect(result.metadata.mcp_server_versions).toEqual({});
    expect(result.metadata.git_commit).toBeUndefined();
    expect(result.metadata.run_note).toBeUndefined();
  });

  it('includes git_commit when provided', () => {
    const result = aggregateResults({ ...BASE, gitCommit: 'deadbeef', scenarioRuns: [] });
    expect(result.metadata.git_commit).toBe('deadbeef');
  });

  it('includes run_note when provided', () => {
    const result = aggregateResults({
      ...BASE,
      runNote: 'mcp-server v1.8.2 #staging',
      scenarioRuns: []
    });
    expect(result.metadata.run_note).toBe('mcp-server v1.8.2 #staging');
  });

  it('includes mcp_server_versions when provided', () => {
    const result = aggregateResults({
      ...BASE,
      mcpServerVersions: { api: '1.2.3', docs: null },
      scenarioRuns: []
    });
    expect(result.metadata.mcp_server_versions).toEqual({ api: '1.2.3', docs: null });
  });

  it('computes avg_tool_calls_per_run', () => {
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'gpt-4',
          runs: [makeRun(true, ['a', 'b']), makeRun(true, ['c'])]
        }
      ]
    });
    expect(result.summary.avg_tool_calls_per_run).toBe(1.5);
  });

  it('computes avg_tool_latency_ms from durations', () => {
    const run = makeRun(true, ['a', 'b'], {}, [100, 200]);
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [run] }]
    });
    expect(result.summary.avg_tool_latency_ms).toBe(150);
  });

  it('sets avg_tool_latency_ms to null when no tool durations exist', () => {
    const run = makeRun(true, [], {}, []);
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [{ scenario_id: 's1', agent: 'gpt-4', runs: [run] }]
    });
    expect(result.summary.avg_tool_latency_ms).toBeNull();
  });

  it('tracks required and forbidden tool stats when eval rules are present', () => {
    const eval_: EvalRules = {
      tool_constraints: { required_tools: ['search'], forbidden_tools: ['delete'] }
    };
    const result = aggregateResults({
      ...BASE,
      scenarioRuns: [
        {
          scenario_id: 's1',
          agent: 'gpt-4',
          eval: eval_,
          runs: [makeRun(true, ['search'], { search: 1 }), makeRun(true, [], {})]
        }
      ]
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
        { scenario_id: 'scenario-1', agent: 'gpt-4', runs: [makeRun(true), makeRun(true)] }
      ]
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

  it('includes the Run note line when a run note is present', () => {
    const results = aggregateResults({
      ...BASE,
      runNote: 'mcp-server v1.8.2 #staging',
      scenarioRuns: []
    });
    expect(renderSummaryMarkdown(results)).toContain('Run note: mcp-server v1.8.2 #staging');
  });

  it('omits the Git commit line when no commit hash is provided', () => {
    const results = aggregateResults({ ...BASE, scenarioRuns: [] });
    expect(renderSummaryMarkdown(results)).not.toContain('Git commit');
  });

  it('includes MCP server versions section only when versions exist', () => {
    const withVersions = aggregateResults({
      ...BASE,
      mcpServerVersions: { api: '1.2.3', docs: null },
      scenarioRuns: []
    });
    const withoutVersions = aggregateResults({ ...BASE, scenarioRuns: [] });

    const withVersionsMd = renderSummaryMarkdown(withVersions);
    expect(withVersionsMd).toContain('MCP server versions:');
    expect(withVersionsMd).toContain('- api: 1.2.3');
    expect(withVersionsMd).toContain('- docs: unknown');
    expect(renderSummaryMarkdown(withoutVersions)).not.toContain('MCP server versions:');
  });
});

describe('normalizeResultsJson', () => {
  it('forces pass=false when run.error exists even if error_failures is 0', () => {
    const normalized = normalizeResultsJson({
      metadata: {
        run_id: 'run-err',
        timestamp: '2024-01-01T00:00:00Z',
        config_hash: 'hash',
        cli_version: '1.0.0',
        mcp_server_versions: {}
      },
      summary: {
        total_scenarios: 1,
        total_runs: 1,
        pass_rate: 1,
        avg_tool_calls_per_run: 0,
        avg_tool_latency_ms: null
      },
      scenarios: [
        {
          scenario_id: 's1',
          agent: 'a1',
          runs: [
            {
              run_index: 0,
              pass: true,
              error: 'boom',
              failures: [],
              error_failures: 0,
              warning_failures: 0,
              tool_calls: [],
              tool_call_count: 0,
              tool_sequence: [],
              tool_usage: {},
              tool_durations_ms: [],
              final_text: '',
              extracted: {}
            }
          ],
          pass_rate: 1,
          distinct_sequences: {},
          tool_usage_frequency: {},
          extracted_values: {},
          last_final_answer: ''
        }
      ]
    });
    expect(normalized.scenarios[0]?.runs[0]?.pass).toBe(false);
    expect(normalized.summary.pass_rate).toBe(0);
  });
});
