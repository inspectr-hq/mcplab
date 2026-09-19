import type { CheckCounts } from './types.js';

export function tallyCheckCounts(checks: Iterable<{ status: string }>): CheckCounts {
  const counts: CheckCounts = {
    passed: 0,
    failed: 0,
    not_evaluated: 0,
    not_executed: 0,
    total: 0
  };
  for (const check of checks) {
    if (check.status === 'passed') counts.passed += 1;
    else if (check.status === 'failed') counts.failed += 1;
    else if (check.status === 'not_evaluated' || check.status === 'not_applicable') {
      counts.not_evaluated += 1;
    } else if (check.status === 'not_executed')
      counts.not_executed = (counts.not_executed ?? 0) + 1;
    else continue;
    counts.total += 1;
  }
  return counts;
}
