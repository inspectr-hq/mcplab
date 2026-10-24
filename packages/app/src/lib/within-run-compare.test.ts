import { expect, it } from 'vitest';
import { buildWithinRunRows, withinRunOptions } from './within-run-compare';
import type { EvalResult } from '@/types/eval';

const run = {
  server_variants: [
    { id: 'A', label: 'Baseline' },
    { id: 'B', label: 'Candidate' },
    { id: 'offline' }
  ],
  scenarios: [
    { scenarioId: 's', scenarioName: 'Shared', agentId: 'one', server_variant: 'A' },
    { scenarioId: 's', scenarioName: 'Shared', agentId: 'one', server_variant: 'B' },
    { scenarioId: 's', scenarioName: 'Shared', agentId: 'two', server_variant: 'B' }
  ]
} as EvalResult;

it('compares servers while holding the agent constant', () => {
  const rows = buildWithinRunRows(run, 'servers', 'one');
  expect(Object.keys(rows[0].byColumn)).toEqual(['A', 'B']);
  expect(rows[0].byColumn.B.agentId).toBe('one');
  expect(withinRunOptions(run, 'servers').map((option) => option.id)).toContain('offline');
});
it('compares agents while holding the server set constant', () => {
  const rows = buildWithinRunRows(run, 'agents', 'B');
  expect(Object.keys(rows[0].byColumn)).toEqual(['one', 'two']);
  expect(rows[0].byColumn.one.server_variant).toBe('B');
});
