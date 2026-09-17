import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendExecutionEvent } from './execution-journal.js';
import { projectEvaluationJournal } from './evaluation-journal-projection.js';

describe('projectEvaluationJournal', () => {
  it('reduces completed child snapshots into one canonical run', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-projection-'));
    try {
      const result = (runId: string, pass: number) => ({
        metadata: {
          run_id: runId,
          timestamp: new Date().toISOString(),
          config_hash: 'hash',
          cli_version: 'test',
          mcp_server_versions: {}
        },
        summary: {
          total_scenarios: 1,
          total_runs: 1,
          pass_rate: pass,
          avg_tool_calls_per_run: 0,
          avg_tool_latency_ms: 1,
          outcomes: { passed: pass ? 1 : 0, failed: pass ? 0 : 1, incomplete: 0, error: 0 }
        },
        scenarios: []
      });
      appendExecutionEvent(join(root, 'run-1'), {
        eventId: 'execution-1',
        type: 'execution_completed',
        ts: new Date().toISOString(),
        results: result('llm-1', 1)
      });
      appendExecutionEvent(join(root, 'run-1'), {
        eventId: 'execution-2',
        type: 'execution_completed',
        ts: new Date().toISOString(),
        results: result('rover-1', 0)
      });
      appendExecutionEvent(join(root, 'run-1'), {
        eventId: 'rover-event-1',
        type: 'rover_event',
        ts: new Date().toISOString(),
        executionId: 'rover-1',
        roverType: 'stage',
        stage: 'response_captured'
      });
      const projected = projectEvaluationJournal({
        runsDir: root,
        evaluationRunId: 'run-1',
        evaluationName: 'Batch quality'
      });
      expect(projected?.metadata.run_id).toBe('run-1');
      expect(projected?.metadata.config_name).toBe('Batch quality');
      expect(projected?.summary.total_runs).toBe(2);
      expect(readFileSync(join(root, 'run-1', 'trace.jsonl'), 'utf8')).toContain(
        '"roverType":"stage"'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks a partial canonical result as stopped', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-projection-stopped-'));
    try {
      const result = {
        metadata: {
          run_id: 'llm-1',
          timestamp: new Date().toISOString(),
          config_hash: 'hash',
          cli_version: 'test',
          mcp_server_versions: {}
        },
        summary: {
          total_scenarios: 1,
          total_runs: 1,
          pass_rate: 1,
          avg_tool_calls_per_run: 0,
          avg_tool_latency_ms: 1,
          outcomes: { passed: 1, failed: 0, incomplete: 0, error: 0 }
        },
        scenarios: []
      };
      appendExecutionEvent(join(root, 'run-1'), {
        eventId: 'execution-1',
        type: 'execution_completed',
        ts: new Date().toISOString(),
        results: result
      });
      const projected = projectEvaluationJournal({
        runsDir: root,
        evaluationRunId: 'run-1',
        executionStatus: 'stopped'
      });
      expect(projected?.metadata.execution_status).toBe('stopped');
      expect(
        JSON.parse(readFileSync(join(root, 'run-1', 'results.json'), 'utf8')).metadata
          .execution_status
      ).toBe('stopped');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts failed executions that produced no result snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-projection-failed-'));
    try {
      const result = {
        metadata: {
          run_id: 'llm-1',
          timestamp: new Date().toISOString(),
          config_hash: 'hash',
          cli_version: 'test',
          mcp_server_versions: {}
        },
        summary: {
          total_scenarios: 1,
          total_runs: 1,
          pass_rate: 1,
          avg_tool_calls_per_run: 0,
          avg_tool_latency_ms: 1,
          outcomes: { passed: 1, failed: 0, incomplete: 0, error: 0 }
        },
        scenarios: []
      };
      appendExecutionEvent(join(root, 'run-1'), {
        eventId: 'execution-1',
        type: 'execution_completed',
        ts: new Date().toISOString(),
        executionId: 'llm-1',
        results: result
      });
      appendExecutionEvent(join(root, 'run-1'), {
        eventId: 'execution-2',
        type: 'execution_failed',
        ts: new Date().toISOString(),
        executionId: 'rover-1'
      });
      const projected = projectEvaluationJournal({ runsDir: root, evaluationRunId: 'run-1' });
      expect(projected?.summary.outcomes).toMatchObject({ passed: 1, failed: 1 });
      expect(projected?.summary.total_runs).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
