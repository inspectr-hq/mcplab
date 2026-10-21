import { describe, expect, it } from 'vitest';
import { aggregateResults, type ScenarioRunResult } from '@inspectr/mcplab-core';
import { renderHtml } from '../../../reporting/src/html.js';

describe('tool alternatives report', () => {
  it('renders malformed historical expressions safely', () => {
    const result = aggregateResults({
      runId: 'malformed-report',
      timestamp: '2026-10-20T10:00:00Z',
      configHash: 'test',
      cliVersion: 'test',
      scenarioRuns: [{ scenario_id: 'case', agent: 'agent', runs: [] }]
    });
    result.scenarios[0]!.eval = {
      tool_constraints: { required_tools: ['search|'] },
      tool_sequence: ['a|a']
    };
    expect(() => renderHtml(result)).not.toThrow();
    expect(renderHtml(result)).toContain('search|');
    expect(renderHtml(result)).toContain('a|a');
  });

  it.each(['search | lookup', 'search< | lookup>'])(
    'looks up canonical group counts and escapes %s',
    (expression) => {
      const alternatives = expression.split('|').map((name) => name.trim());
      const matched = alternatives[1];
      const run: ScenarioRunResult = {
        run_index: 0,
        pass: true,
        failures: [],
        tool_calls: [matched],
        tool_call_count: 1,
        tool_sequence: [matched],
        tool_usage: { [matched]: 1 },
        tool_durations_ms: [],
        final_text: 'ok',
        extracted: {}
      };
      const result = aggregateResults({
        runId: 'report-test',
        timestamp: '2026-10-20T10:00:00Z',
        configHash: 'test',
        cliVersion: 'test',
        scenarioRuns: [
          {
            scenario_id: 'case',
            agent: 'agent',
            eval: {
              tool_constraints: { required_tools: [expression] },
              tool_sequence: [expression]
            },
            runs: [run]
          }
        ]
      });
      const html = renderHtml(result);
      const display = alternatives.join(' OR ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      expect(html).toContain(`<td>${display}</td><td>1/1</td>`);
      expect(html).not.toContain('<td>search< OR lookup></td>');
    }
  );
});
