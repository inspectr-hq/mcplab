import { expect, it } from 'vitest';
import { generateHtmlReport } from './generate-html-report';
import type { EvalResult } from '@/types/eval';

it('exports stopped runs separately from failures', () => {
  const run = { runIndex: 0, passed: true, duration: 0, toolCalls: [], failureReasons: [] };
  const result = {
    id: 'test',
    configHash: 'hash',
    timestamp: '2026-10-12T00:00:00Z',
    totalRuns: 2,
    totalScenarios: 1,
    overallPassRate: 1,
    avgToolCalls: 0,
    avgLatency: 0,
    outcomes: { passed: 1, stopped: 1 },
    scenarios: [
      {
        scenarioName: 'Test',
        agentName: 'Agent',
        passRate: 1,
        avgToolCalls: 0,
        runs: [run, { ...run, runIndex: 1, passed: false, outcome: 'stopped' }]
      }
    ]
  } as EvalResult;
  const html = generateHtmlReport(result);
  expect(html).toContain("labels:['Pass','Fail','Stopped']");
  expect(html).toContain('data:[1,0,1]');
  expect(html).toContain('run-status stopped');
  expect(html).not.toContain('run-status fail');
});
