export interface CheckCounts {
  passed: number;
  failed: number;
  not_evaluated: number;
  total: number;
}

export function tallyCheckCounts(checks: Iterable<{ status: string }>): CheckCounts {
  const counts: CheckCounts = { passed: 0, failed: 0, not_evaluated: 0, total: 0 };
  for (const check of checks) {
    if (check.status === 'passed') counts.passed += 1;
    else if (check.status === 'failed') counts.failed += 1;
    else if (check.status === 'not_evaluated') counts.not_evaluated += 1;
    else continue;
    counts.total += 1;
  }
  return counts;
}
