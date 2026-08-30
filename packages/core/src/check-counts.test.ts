import { describe, expect, it } from 'vitest';
import { tallyCheckCounts } from './check-counts.js';

describe('tallyCheckCounts', () => {
  it('counts evaluated and not-evaluated checks without corrupting totals', () => {
    expect(
      tallyCheckCounts([
        { status: 'passed' },
        { status: 'failed' },
        { status: 'not_evaluated' },
        { status: 'legacy_status' }
      ])
    ).toEqual({ passed: 1, failed: 1, not_evaluated: 1, total: 3 });
  });
});
