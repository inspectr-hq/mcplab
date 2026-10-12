import { expect, it } from 'vitest';
import { generateHtmlReport } from './generate-html-report';
import type { EvalResult } from '@/types/eval';

it.each([false, true])(
  'exports stopped runs separately from failures, stopped only: %s',
  (stoppedOnly) => {
    const run = { runIndex: 0, passed: true, duration: 0, toolCalls: [], failureReasons: [] };
    const result = {
      id: 'test',
      configHash: 'hash',
      timestamp: '2026-10-12T00:00:00Z',
      totalRuns: 2,
      totalScenarios: 1,
      overallPassRate: stoppedOnly ? 0 : 1,
      avgToolCalls: 0,
      avgLatency: 0,
      outcomes: stoppedOnly ? { stopped: 2 } : { passed: 1, stopped: 1 },
      scenarios: [
        {
          scenarioName: 'Test',
          agentName: 'Agent',
          passRate: stoppedOnly ? 0 : 1,
          avgToolCalls: 0,
          runs: [
            stoppedOnly ? { ...run, passed: false, outcome: 'stopped' } : run,
            { ...run, runIndex: 1, passed: false, outcome: 'stopped' }
          ]
        }
      ]
    } as EvalResult;
    const html = generateHtmlReport(result);
    expect(html).toContain("labels:['Pass','Fail','Stopped']");
    expect(html).toContain(stoppedOnly ? 'data:[0,0,2]' : 'data:[1,0,1]');
    expect(html).toContain('run-status stopped');
    expect(html).not.toContain('run-status fail');
    if (stoppedOnly) {
      expect(html).toContain('badge-neutral');
      expect(html).not.toContain('class="badge badge-fail"');
      expect(html).not.toMatch(/>0%(?:<| pass)/);
    }
  }
);
