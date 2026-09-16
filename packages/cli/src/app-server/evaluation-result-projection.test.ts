import { describe, expect, it } from 'vitest';
import { projectEvaluationResult } from './evaluation-result-projection.js';
import type { ResultsJson } from '@inspectr/mcplab-core';

function execution(runId: string, passed: number, total: number): ResultsJson {
  return {
    metadata: {
      run_id: runId,
      timestamp: '2026-09-09T00:00:00.000Z',
      config_hash: 'hash',
      cli_version: 'test',
      mcp_server_versions: {}
    },
    summary: {
      total_scenarios: 1,
      total_runs: total,
      pass_rate: passed / total,
      avg_tool_calls_per_run: 2,
      avg_tool_latency_ms: 10,
      outcomes: { passed, failed: total - passed, incomplete: 0, error: 0 }
    },
    scenarios: []
  };
}

describe('projectEvaluationResult', () => {
  it('combines execution summaries into one canonical result', () => {
    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-1',
      runId: 'run-1',
      executions: [execution('llm-1', 1, 1), execution('rover-1', 0, 1)]
    });
    expect(result.metadata.run_id).toBe('run-1');
    expect(result.summary.total_runs).toBe(2);
    expect(result.summary.pass_rate).toBe(0.5);
    expect(result.summary.outcomes).toEqual({ passed: 1, failed: 1, incomplete: 0, error: 0 });
    expect(result.metadata).not.toHaveProperty('child_run_ids');
  });

  it('aggregates tool metadata and MCP server versions across executions', () => {
    const first = execution('llm-1', 1, 1);
    const second = execution('rover-1', 1, 1);
    first.metadata.mcp_server_versions = { trendminer: '0.7.0' };
    second.metadata.mcp_server_versions = { other: '1.2.3', trendminer: '0.7.0' };
    Object.assign(first.metadata, {
      total_duration_ms: 10_000,
      total_tool_duration_ms: 1_200,
      tool_tokens_total: 100
    });
    Object.assign(second.metadata, {
      total_duration_ms: 20_000,
      total_tool_duration_ms: 2_300,
      tool_tokens_total: 250
    });

    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-1',
      runId: 'evaluation-1',
      executions: [first, second]
    });

    expect(result.metadata).toMatchObject({
      total_duration_ms: 30_000,
      total_tool_duration_ms: 3_500,
      tool_tokens_total: 350,
      mcp_server_versions: { other: '1.2.3', trendminer: '0.7.0' }
    });
  });

  it('omits numeric aggregates when an execution has no metric', () => {
    const first = execution('llm-1', 1, 1);
    Object.assign(first.metadata, {
      total_duration_ms: 10_000,
      total_tool_duration_ms: 1_200,
      tool_tokens_total: 100
    });

    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-1',
      runId: 'evaluation-1',
      executions: [first, execution('rover-1', 1, 1)]
    });

    expect(result.metadata).not.toHaveProperty('total_duration_ms');
    expect(result.metadata).not.toHaveProperty('total_tool_duration_ms');
    expect(result.metadata).not.toHaveProperty('tool_tokens_total');
  });

  it('omits execution client when grouped executions provide no client metadata', () => {
    const first = execution('llm-1', 1, 1);
    const second = execution('rover-1', 1, 1);
    second.metadata.execution_client = 'claude';

    const withOneClient = projectEvaluationResult({
      evaluationRunId: 'evaluation-1',
      runId: 'evaluation-1',
      executions: [first, second]
    });
    expect(withOneClient.metadata.execution_client).toBe('claude');

    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-1',
      runId: 'evaluation-1',
      executions: [first]
    });

    expect(result.metadata).not.toHaveProperty('execution_client');
  });

  it('preserves rerun metadata needed to identify and rerun a queued Rover execution', () => {
    const source = execution('rover-1', 1, 1);
    source.metadata.config_path = 'evals/hi-there.yaml';
    source.metadata.config_name = 'Hi There';
    source.metadata.rerun_agents = ['m365.cloud.microsoft'];
    source.metadata.rerun_scenario_ids = ['scn-1'];
    source.metadata.execution_source = 'rover';
    source.metadata.execution_client = 'm365.cloud.microsoft';

    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-rover',
      runId: 'evaluation-rover',
      executions: [source]
    });

    expect(result.metadata).toMatchObject({
      config_path: 'evals/hi-there.yaml',
      config_name: 'Hi There',
      rerun_agents: ['m365.cloud.microsoft'],
      rerun_scenario_ids: ['scn-1'],
      execution_source: 'rover',
      execution_client: 'm365.cloud.microsoft'
    });
  });

  it('creates an empty result when executions fail before producing snapshots', () => {
    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-failed',
      runId: 'run-failed',
      executions: []
    });
    expect(result.metadata.run_id).toBe('run-failed');
    expect(result.summary.total_runs).toBe(0);
  });

  it('keeps stopped executions distinct from failures', () => {
    const result = projectEvaluationResult({
      evaluationRunId: 'evaluation-stopped',
      runId: 'run-stopped',
      executions: [],
      stoppedExecutions: 1
    });
    expect(result.summary.total_runs).toBe(1);
    expect(result.summary.outcomes).toEqual({ passed: 0, failed: 0, incomplete: 0, error: 1 });
  });
});
