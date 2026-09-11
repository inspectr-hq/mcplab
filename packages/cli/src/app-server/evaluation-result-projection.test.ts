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
