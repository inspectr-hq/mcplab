import type { EvalRule, CheckResult } from '@/types/eval';
import { toComparableString } from './value-normalization';
import { normalizeToolExpression, resolveToolNameAlias } from '@inspectr/mcplab-core';

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
      const expected = result.metadata?.expected;
      if (!Array.isArray(expected) || expected.length !== sequence.length) return false;
      try {
        return expected.every(
          (expression, index) =>
            typeof expression === 'string' &&
            normalizeToolExpression(expression) === normalizeToolExpression(sequence[index])
        );
      } catch {
        return false;
      }
    });
    return (
      metadataMatch ??
      checkResults.find(
        (result) =>
          result.type === rule.type &&
          (result.label === formatLabel(rule) ||
            result.label === `Tool sequence · ${sequence.join(' -> ')}`)
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
      const available = [metadata?.available_tool_names, metadata?.available_tools].find(
        (names): names is string[] =>
          Array.isArray(names) && names.every((name) => typeof name === 'string')
      );
      const resolve = available
        ? (name: string) => resolveToolNameAlias(name, available)
        : undefined;
      const equal = (expression: string) => {
        try {
          return (
            normalizeToolExpression(expression, resolve) ===
            normalizeToolExpression(expected, resolve)
          );
        } catch {
          return false;
        }
      };
      const expressions = [metadata?.expression].filter(
        (candidate): candidate is string => typeof candidate === 'string'
      );
      if (expressions.some(equal)) return true;
      const alternatives = metadata?.alternatives;
      if (Array.isArray(alternatives) && alternatives.every((item) => typeof item === 'string')) {
        if (equal(alternatives.join('|'))) return true;
      }
      return false;
    });
    if (metadataMatch) return metadataMatch;
  }

  const expectedLabel = formatLabel(rule);
  if (rule.type === 'required_tool' || rule.type === 'forbidden_tool') {
    const legacyLabel = `${rule.type === 'required_tool' ? 'Required tool' : 'Forbidden tool'} · ${String(rule.value ?? '')}`;
    return (
      checkResults.find((result) => result.type === rule.type && result.label === legacyLabel) ??
      checkResults.find((result) => result.type === rule.type && result.label === expectedLabel)
    );
  }
  return checkResults.find((result) => result.type === rule.type && result.label === expectedLabel);
}
