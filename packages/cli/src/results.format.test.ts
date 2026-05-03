import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatContext, formatRunList, formatSearchHits, showRun } from './results/format.js';
import { createResultsRunFixture } from './test-results-fixture.js';

describe('results format helpers', () => {
  it('showRun blocks path traversal', () => {
    const { runsDir } = createResultsRunFixture();
    expect(() => showRun(runsDir, '../../etc/passwd', 'json')).toThrow('Invalid run id path');
  });

  it('showRun adds run context on parse error', () => {
    const { runsDir, runId } = createResultsRunFixture();
    writeFileSync(join(runsDir, runId, 'results.json'), '{bad json', 'utf8');
    expect(() => showRun(runsDir, runId, 'json')).toThrow(
      `Could not parse results.json for run ${runId}`
    );
  });

  it('markdown formatter omits next when context_command missing', () => {
    const text = formatSearchHits(
      [
        {
          run_id: 'r1',
          source: 'summary',
          file: 'summary.md',
          snippet: 'x',
          score: 1
        }
      ],
      'markdown'
    );
    expect(text.includes('next:')).toBe(false);
  });

  it('context heading includes identity', () => {
    const text = formatContext(
      {
        run_id: 'r1',
        scenario_id: 's1',
        source: 'mixed',
        excerpt: 'hello'
      },
      'markdown'
    );
    expect(text).toContain('# Context r1/s1');
  });

  it('formatRunList table renders null pass_rate as dash', () => {
    const table = formatRunList(
      [{ run_id: 'r1', timestamp: '2026-01-01T00:00:00.000Z', pass_rate: null, total_runs: 3 }],
      'table'
    );
    const lines = table.split('\n');
    expect(lines[0]).toBe('RUN_ID\tTIMESTAMP\tPASS_RATE\tTOTAL_RUNS');
    expect(lines[1]).toContain('r1\t2026-01-01T00:00:00.000Z\t-\t3');
  });
});
