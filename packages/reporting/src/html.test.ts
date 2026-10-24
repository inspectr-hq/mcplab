import { expect, it } from 'vitest';
import { aggregateResults, renderSummaryMarkdown } from '@inspectr/mcplab-core';
import { renderHtml } from './html.js';

it('labels server sets and uses distinct detail anchors for repeated scenarios', () => {
  const result = aggregateResults({
    runId: 'one',
    timestamp: '',
    configHash: '',
    cliVersion: '',
    scenarioRuns: [{ scenario_id: 's', agent: 'a', runs: [] }]
  });
  result.metadata.server_variants = [
    { id: 'A', label: 'Baseline' },
    { id: 'B', label: 'Candidate' }
  ];
  result.scenarios = ['A', 'B'].map((variant) => ({
    ...result.scenarios[0],
    server_variant: variant
  }));
  const html = renderHtml(result);
  expect(html).toContain('Baseline');
  expect(html).toContain('Candidate');
  const anchors = [...html.matchAll(/<section id="([^"]+)" class="scenario">/g)].map(
    (match) => match[1]
  );
  expect(new Set(anchors).size).toBe(2);
  expect(renderSummaryMarkdown(result)).toContain('Server set');
});
