import type { EvalRule, CheckResult } from '@/types/eval';
import { toComparableString } from './value-normalization';
import { normalizeToolExpressionSafely } from '@/lib/data-sources/types';

function sameExpression(left: string, right: string): boolean {
  return normalizeToolExpressionSafely(left) === normalizeToolExpressionSafely(right);
}

function sameSequence(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((item, index) => typeof item === 'string' && sameExpression(item, right[index]))
  );
}

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

  if (rule.type === 'tool_sequence') {
    const sequence = rule.sequence ?? [];
    const metadataMatch = checkResults.find((result) => {
      if (result.type !== rule.type) return false;
      const sourceExpected = result.metadata?.source_expected;
      return Array.isArray(sourceExpected) && sameSequence(sourceExpected, sequence);
    });
    return (
      metadataMatch ??
      checkResults.find(
        (result) =>
          result.type === rule.type &&
          !Array.isArray(result.metadata?.source_expected) &&
          result.label === `Tool sequence · ${sequence.join(' -> ')}`
      )
    );
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
        return (
          toComparableString(rule.value) !== undefined &&
          toComparableString(result.metadata?.value) === toComparableString(rule.value)
        );
      if (rule.type === 'tool_input_regex')
        return (
          toComparableString(rule.value) !== undefined &&
          toComparableString(result.metadata?.pattern) === toComparableString(rule.value)
        );
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

  if (rule.type === 'required_tool' || rule.type === 'forbidden_tool') {
    const expected = String(rule.value ?? '');
    const metadataMatch = checkResults.find((result) => {
      if (result.type !== rule.type) return false;
      const metadata = result.metadata as Record<string, unknown> | undefined;
      if (
        typeof metadata?.source_expression === 'string' &&
        sameExpression(metadata.source_expression, expected)
      )
        return true;
      return false;
    });
    if (metadataMatch) return metadataMatch;
  }

  const expectedLabel = formatLabel(rule);
  if (rule.type === 'required_tool' || rule.type === 'forbidden_tool') {
    const value = String(rule.value ?? '');
    const legacyLabel = `${rule.type === 'required_tool' ? 'Required tool' : 'Forbidden tool'} · ${value}`;
    return checkResults.find(
      (result) =>
        result.type === rule.type &&
        typeof result.metadata?.source_expression !== 'string' &&
        result.label === legacyLabel
    );
  }
  return checkResults.find((result) => result.type === rule.type && result.label === expectedLabel);
}
