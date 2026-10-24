import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateResults } from '@inspectr/mcplab-core';
import { describe, expect, it } from 'vitest';
import { appendExecutionEvent } from './execution-journal.js';
import {
  recordEvaluationExecution,
  recordEvaluationTerminalExecution
} from './evaluation-journal-writer.js';

it('preserves the complete plan, effective servers and trace identity in one result', () => {
  const root = mkdtempSync(join(tmpdir(), 'variant-journal-'));
  try {
    const variants = [
      { id: 'A', label: 'Baseline', scenarioServerOverrides: { s: ['dev'] } },
      { id: 'B', serverIds: ['prod'], scenarioServerOverrides: { s: ['prod'] } }
    ];
    appendExecutionEvent(join(root, 'evaluation'), {
      eventId: 'start',
      type: 'evaluation_started',
      ts: '',
      evaluationRequest: {
        server_sets: [
          { id: 'A', label: 'Baseline', scenarioServerOverrides: { s: ['dev'] } },
          { id: 'B', servers: ['prod'], scenarioServerOverrides: { s: ['prod'] } }
        ]
      },
      runsPerScenario: 3
    });
    const results = aggregateResults({
      runId: 'child-A',
      timestamp: '',
      configHash: 'x',
      cliVersion: 'test',
      scenarioRuns: [{ scenario_id: 's', agent: 'agent', runs: [] }]
    });
    recordEvaluationExecution({
      runsDir: root,
      evaluationRunId: 'evaluation',
      executionId: 'child-A',
      executionSource: 'mcplab',
      serverVariant: variants[0],
      results,
      traceRecords: [
        { type: 'scenario_run', scenario_id: 's', agent: 'agent', run_index: 0 } as any
      ]
    });
    const projected = recordEvaluationTerminalExecution({
      runsDir: root,
      evaluationRunId: 'evaluation',
      executionId: 'child-B',
      serverVariant: variants[1],
      status: 'error',
      reason: 'Connection refused'
    });
    expect(projected?.metadata.rerun_server_variants).toEqual(variants);
    expect(projected?.metadata.rerun_runs_per_scenario).toBe(3);
    expect(projected?.metadata.server_variant_errors).toEqual({ B: 'Connection refused' });
    expect(projected?.scenarios[0]).toMatchObject({ server_variant: 'A', servers: ['dev'] });
    expect(readFileSync(join(root, 'evaluation', 'trace.jsonl'), 'utf8')).toContain(
      '"server_variant":"A"'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps an evaluation result when every server set fails before producing a scenario', () => {
  const root = mkdtempSync(join(tmpdir(), 'variant-error-'));
  try {
    appendExecutionEvent(join(root, 'evaluation'), {
      eventId: 'start',
      type: 'evaluation_started',
      ts: '',
      evaluationRequest: { server_sets: [{ id: 'A' }, { id: 'B' }] }
    });
    const result = recordEvaluationTerminalExecution({
      runsDir: root,
      evaluationRunId: 'evaluation',
      executionId: 'child-A',
      serverVariant: { id: 'A' },
      status: 'error',
      reason: 'Offline'
    });
    expect(result?.metadata.server_variants).toHaveLength(2);
    expect(result?.metadata.server_variant_errors).toEqual({ A: 'Offline' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
