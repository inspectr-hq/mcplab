import { matchStructuredCheckResult } from '@/lib/check-result-matching';
import type { CheckResult, EvalRule } from '@/types/eval';
import {
  formatToolInputAssertionFailureReason,
  formatToolInputAssertionLabel,
  formatToolSequenceLabel
} from '@/lib/data-sources/types';
import type { CoreToolInputAssertion } from '@/lib/data-sources/types';
import { toComparableString } from './value-normalization';

export interface CheckPresentationInput {
  evalRules: EvalRule[];
  failureReasons: string[];
  runError?: string;
  checkResults?: CheckResult[];
}

export function buildCheckItems({
  evalRules,
  failureReasons,
  runError,
  checkResults
}: CheckPresentationInput) {
  const scenarioError =
    runError || failureReasons.find((reason) => reason.startsWith('Scenario error:'));
  if (scenarioError) {
    return evalRules.map((rule) => ({
      rule,
      status: 'not_evaluated' as const,
      failureReason: undefined
    }));
  }
  if (checkResults?.length) {
    return evalRules.map((rule) => {
      const match = matchStructuredCheckResult(rule, checkResults, formatEvalRuleLabel);
      return {
        rule,
        status: match?.status ?? ('not_evaluated' as const),
        failureReason: match?.reason
      };
    });
  }
  return evalRules.map((rule) => {
    const failureReason = matchFailureReasonForRule(rule, failureReasons);
    return {
      rule,
      status: failureReason ? ('failed' as const) : ('passed' as const),
      failureReason
    };
  });
}

export function formatEvalRuleLabel(rule: EvalRule): string {
  if (rule.type === 'required_tool') return `Required tool · ${rule.value}`;
  if (rule.type === 'forbidden_tool') return `Forbidden tool · ${rule.value}`;
  if (rule.type === 'tool_sequence') return formatToolSequenceLabel(rule.sequence ?? []);
  if (rule.type === 'tool_input_contains')
    return formatToolInputAssertionLabel({
      type: 'contains',
      tool: String(rule.tool ?? ''),
      value: String(rule.value ?? '')
    });
  if (rule.type === 'tool_input_regex')
    return formatToolInputAssertionLabel({
      type: 'regex',
      tool: String(rule.tool ?? ''),
      pattern: String(rule.value ?? '')
    });
  if (rule.type === 'tool_input_jsonpath') {
    const assertion: CoreToolInputAssertion = {
      type: 'jsonpath',
      tool: String(rule.tool ?? ''),
      path: String(rule.path ?? ''),
      ...(rule.equals !== undefined ? { equals: rule.equals } : {})
    };
    return formatToolInputAssertionLabel(assertion);
  }
  if (rule.type === 'response_contains') return `Text contains · ${rule.value}`;
  if (rule.type === 'response_not_contains') return `Text does not contain · ${rule.value}`;
  if (rule.type === 'response_starts_with') return `Text starts with · ${rule.value}`;
  if (rule.type === 'response_ends_with') return `Text ends with · ${rule.value}`;
  if (rule.type === 'response_equals') return `Text equals · ${rule.value}`;
  if (rule.type === 'response_regex') return `Text matches regex · ${rule.value}`;
  if (rule.type === 'response_jsonpath')
    return rule.equals !== undefined
      ? `JSONPath equals · ${rule.path} == ${String(rule.equals)}`
      : `JSONPath exists · ${rule.path}`;
  if (rule.type === 'response_jsonpath_exists') return `JSONPath exists · ${rule.path}`;
  if (rule.type === 'response_jsonpath_not_exists') return `JSONPath not exists · ${rule.path}`;
  if (rule.type === 'agent_check') return `Agent check · ${rule.label}`;
  return `${rule.type} · ${rule.value}`;
}

function formatToolSequenceText(sequence: string[]): string {
  return formatToolSequenceLabel(sequence).replace(/^Tool sequence · /, '');
}

export function matchFailureReasonForRule(
  rule: EvalRule,
  failureReasons: string[]
): string | undefined {
  if (
    rule.type === 'tool_input_contains' ||
    rule.type === 'tool_input_regex' ||
    rule.type === 'tool_input_jsonpath'
  ) {
    const assertion: CoreToolInputAssertion =
      rule.type === 'tool_input_contains'
        ? { type: 'contains', tool: String(rule.tool ?? ''), value: String(rule.value ?? '') }
        : rule.type === 'tool_input_regex'
        ? { type: 'regex', tool: String(rule.tool ?? ''), pattern: String(rule.value ?? '') }
        : {
            type: 'jsonpath',
            tool: String(rule.tool ?? ''),
            path: String(rule.path ?? ''),
            ...(rule.equals !== undefined ? { equals: rule.equals } : {})
          };
    const expectedReasons = [
      formatToolInputAssertionFailureReason(assertion, 'tool_not_used'),
      formatToolInputAssertionFailureReason(assertion, 'input_mismatch'),
      formatToolInputAssertionFailureReason(assertion, 'invalid_regex'),
      formatToolInputAssertionFailureReason(assertion, 'invalid_jsonpath'),
      formatToolInputAssertionFailureReason(assertion, 'serialization')
    ];
    return failureReasons.find((reason) => expectedReasons.includes(reason));
  }

  if (rule.type === 'response_jsonpath_exists') {
    const path = String(rule.path ?? '').trim();
    if (!path) return undefined;
    return failureReasons.find(
      (reason) =>
        reason.startsWith(`JSONPath assertion failed: ${path}`) ||
        reason.startsWith(`JSONPath assertion failed: invalid JSON for path ${path}`)
    );
  }

  const comparableValue = toComparableString(rule.value);
  if (
    (rule.type === 'response_contains' ||
      rule.type === 'response_not_contains' ||
      rule.type === 'response_starts_with' ||
      rule.type === 'response_ends_with' ||
      rule.type === 'response_equals' ||
      rule.type === 'response_regex') &&
    comparableValue === undefined
  ) {
    return undefined;
  }

  const expectedPrefix = (() => {
    if (rule.type === 'required_tool') return `Required tool not used: ${rule.value}`;
    if (rule.type === 'forbidden_tool') return `Forbidden tool used: ${rule.value}`;
    if (rule.type === 'tool_sequence')
      return `Tool sequence order was not satisfied: ${(rule.sequence ?? []).join(' -> ')}`;
    if (rule.type === 'response_contains') return `Contains assertion failed: ${comparableValue}`;
    if (rule.type === 'response_not_contains')
      return `Not-contains assertion failed: ${comparableValue}`;
    if (rule.type === 'response_starts_with') return `Starts-with assertion failed: ${comparableValue}`;
    if (rule.type === 'response_ends_with') return `Ends-with assertion failed: ${comparableValue}`;
    if (rule.type === 'response_equals') return `Equals assertion failed: ${comparableValue}`;
    if (rule.type === 'response_regex') return `Regex assertion failed: ${comparableValue}`;
    if (rule.type === 'response_jsonpath')
      return rule.equals !== undefined
        ? `JSONPath equals assertion failed: ${rule.path}`
        : `JSONPath assertion failed: ${rule.path}`;
    if (rule.type === 'response_jsonpath_not_exists')
      return `JSONPath not-exists assertion failed: ${rule.path}`;
    if (rule.type === 'agent_check') return String(rule.label ?? '');
    return '';
  })();
  if (!expectedPrefix) return undefined;

  const exact = failureReasons.find((reason) => reason === expectedPrefix);
  if (exact) return exact;

  if (rule.type === 'response_regex') {
    const value = comparableValue ?? '';
    if (!value) return undefined;
    return failureReasons.find(
      (reason) => reason.startsWith('Regex assertion failed:') && reason.includes(value)
    );
  }

  if (rule.type === 'response_jsonpath' || rule.type === 'response_jsonpath_not_exists') {
    return failureReasons.find((reason) => reason.includes(rule.path ?? ''));
  }

  if (rule.type === 'tool_sequence') {
    return failureReasons.find(
      (reason) =>
        reason.startsWith(
          `Tool sequence order was not satisfied: ${formatToolSequenceText(rule.sequence ?? [])}`
        ) || reason.startsWith('Required tool in sequence not used:')
    );
  }

  return failureReasons.find((reason) => reason.startsWith(expectedPrefix));
}
