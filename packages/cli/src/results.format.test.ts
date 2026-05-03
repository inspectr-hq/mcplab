import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { formatContext, formatSearchHits, showRun } from './results/format.js';

function setupRun() {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-format-'));
  const runsDir = join(root, 'runs');
  const runId = '20260206-212239';
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'results.json'),
    JSON.stringify({ metadata: { run_id: runId }, summary: { pass_rate: 1 }, scenarios: [] }),
    'utf8'
  );
  writeFileSync(join(runDir, 'summary.md'), '# ok\n', 'utf8');
  return { runsDir, runId };
}

describe('results format helpers', () => {
  it('showRun blocks path traversal', () => {
    const { runsDir } = setupRun();
    expect(() => showRun(runsDir, '../../etc/passwd', 'json')).toThrow('Invalid run id path');
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
});
