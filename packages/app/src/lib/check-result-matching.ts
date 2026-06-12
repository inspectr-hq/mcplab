import type { EvalRule, CheckResult } from '@/types/eval';

export function matchStructuredCheckResult(
  rule: EvalRule,
  checkResults: CheckResult[],
  formatLabel: (rule: EvalRule) => string
): CheckResult | undefined {
  if (rule.type === 'agent_check') {
    const label = String(rule.label ?? '').trim();
    if (!label) return undefined;
    return checkResults.find((result) => result.type === 'agent_check' && result.label === label);
  }

  const expectedLabel = formatLabel(rule);
  return checkResults.find((result) => result.type === rule.type && result.label === expectedLabel);
}
