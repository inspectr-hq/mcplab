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

  if (
    rule.type === 'tool_input_contains' ||
    rule.type === 'tool_input_regex' ||
    rule.type === 'tool_input_jsonpath'
  ) {
    const candidates = checkResults.filter(
      (result) => result.type === rule.type && result.metadata?.tool === rule.tool
    );
    const matchesFields = (result: CheckResult) => {
      if (rule.type === 'tool_input_contains')
        return String(result.metadata?.value ?? '') === String(rule.value ?? '');
      if (rule.type === 'tool_input_regex')
        return String(result.metadata?.pattern ?? '') === String(rule.value ?? '');
      return (
        result.metadata?.path === rule.path &&
        (rule.equals === undefined) === (result.metadata?.equals === undefined) &&
        (rule.equals === undefined || result.metadata?.equals === rule.equals)
      );
    };
    return (
      candidates.find(matchesFields) ??
      checkResults.find((result) => result.type === rule.type && result.label === formatLabel(rule))
    );
  }

  const expectedLabel = formatLabel(rule);
  return checkResults.find((result) => result.type === rule.type && result.label === expectedLabel);
}
