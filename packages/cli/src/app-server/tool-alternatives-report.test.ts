import { describe, expect, it } from 'vitest';
import { aggregateResults } from '@inspectr/mcplab-core';
import { renderHtml } from '../../../reporting/src/html.js';

describe('tool alternatives report', () => {
  it('counts and escapes a required alternative group', () => {
    const result = aggregateResults({
      runId: 'report-test',
      timestamp: '2026-10-20T10:00:00Z',
      configHash: 'test',
      cliVersion: 'test',
      scenarioRuns: [
        {
          scenario_id: 'case',
          agent: 'agent',
          eval: { tool_constraints: { required_tools: ['search< | lookup'] } },
          runs: [
            {
              run_index: 0,
              pass: true,
              failures: [],
              tool_calls: ['lookup'],
              tool_call_count: 1,
              tool_sequence: ['lookup'],
              tool_usage: { lookup: 1 },
              tool_durations_ms: [],
              final_text: 'ok',
              extracted: {}
            }
          ]
        }
      ]
    });
    expect(renderHtml(result)).toContain('<td>(search&lt; OR lookup)</td><td>1/1</td>');
  });
});
