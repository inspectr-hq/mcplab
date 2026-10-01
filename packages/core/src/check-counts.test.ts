import { describe, expect, it } from 'vitest';
import { tallyCheckCounts } from './check-counts.js';

describe('tallyCheckCounts', () => {
  it('counts evaluated and not-evaluated checks without corrupting totals', () => {
    expect(
      tallyCheckCounts([
        { status: 'passed' },
        { status: 'failed' },
        { status: 'not_evaluated' },
        { status: 'not_executed' },
        { status: 'not_applicable' },
        { status: 'legacy_status' }
      ])
    ).toEqual({ passed: 1, failed: 1, not_executed: 1, not_evaluated: 2, total: 5 });
  });
});
