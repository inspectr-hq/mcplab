import { matchStructuredCheckResult } from '@/lib/check-result-matching';
import type { CheckResult, EvalRule } from '@/types/eval';
import {
  formatToolAssertionFailureReason,
  formatToolAssertionLabel,
  formatToolExpression,
  formatToolSequenceLabel
} from '@/lib/data-sources/types';
import type { CoreToolInputAssertion } from '@/lib/data-sources/types';
import { toComparableString } from './value-normalization';

const evaluatorProviderLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure_openai: 'Azure OpenAI',
  azure_foundry: 'Azure Foundry'
};

export interface CheckPresentationInput {
  evalRules: EvalRule[];
  failureReasons: string[];
  runError?: string;
  checkResults?: CheckResult[];
}

interface CheckPresentationItem {
  rule: EvalRule;
  status: CheckResult['status'];
  failureReason?: string;
  decisionDetails?: string;
  decisionInput?: string;
}

export function formatEvaluatorDetails(metadata?: CheckResult['metadata']): string | undefined {
  if (
    typeof metadata?.decision_provider === 'string' &&
    (typeof metadata.decision_fallback === 'string' || metadata.evaluator === 'judge')
  ) {
    const details = ['Evaluated by LLM judge'];
    if (typeof metadata.judge_provider === 'string') {
      details.push(evaluatorProviderLabels[metadata.judge_provider] ?? metadata.judge_provider);
    }
    if (typeof metadata.judge_model === 'string') details.push(metadata.judge_model);
    return details.join(' · ');
  }
  if (typeof metadata?.decision_provider !== 'string') {
    if (typeof metadata?.judge_provider !== 'string') return undefined;
    const details = [
      'Evaluation Judge',
      evaluatorProviderLabels[metadata.judge_provider] ?? metadata.judge_provider
    ];
    if (typeof metadata.judge_model === 'string') details.push(metadata.judge_model);
    return details.join(' · ');
  }
  const details = [`Decision Engine · ${metadata.decision_provider}`];
  const model = metadata.decision_requested_model ?? metadata.decision_model;
  if (typeof model === 'string') details.push(model);
  for (const [key, label] of [
    ['decision_probability', 'probability'],
    ['decision_pass_threshold', 'pass ≥'],
    ['decision_fail_threshold', 'fail ≤']
  ]) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
      details.push(`${label} ${value.toFixed(3)}`);
    }
  }
  if (
    typeof metadata.decision_duration_ms === 'number' &&
    Number.isFinite(metadata.decision_duration_ms)
  ) {
    details.push(`${Math.round(metadata.decision_duration_ms)} ms`);
  }
  return details.join(' · ');
}

export function formatCheckStatusLabel(
  status: 'passed' | 'failed' | 'not_evaluated' | 'not_executed'
): string {
  if (status === 'not_evaluated') return 'Not evaluated';
  if (status === 'not_executed') return 'Not executed';
  return status === 'passed' ? 'Passed' : 'Failed';
}

export function buildCheckItems({
  evalRules,
  failureReasons,
  runError,
  checkResults
}: CheckPresentationInput): CheckPresentationItem[] {
  const scenarioError =
    runError || failureReasons.find((reason) => reason.startsWith('Scenario error:'));
  if (scenarioError) {
    return evalRules.map((rule) => ({
      rule,
      status: 'not_executed' as const,
      failureReason: undefined
    }));
  }
  if (checkResults?.length) {
    return evalRules.map((rule) => {
      const match = matchStructuredCheckResult(rule, checkResults, formatEvalRuleLabel);
      const decisionDetails =
        rule.type === 'agent_check' ? formatEvaluatorDetails(match?.metadata) : undefined;
      const decisionInput =
        rule.type === 'agent_check' && match?.metadata?.evaluator === 'decision'
          ? (typeof match.metadata.decision_prompt === 'string'
              ? match.metadata.decision_prompt
              : rule.prompt
            )?.trim()
          : undefined;
      return {
        rule,
        status: match?.status ?? ('not_executed' as const),
        failureReason: match?.reason,
        ...(decisionInput ? { decisionInput } : {}),
        ...(decisionDetails ? { decisionDetails } : {})
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

function toToolAssertion(
  rule: EvalRule
): { assertion: CoreToolInputAssertion; target: 'input' | 'output' } | undefined {
  const match = /^tool_(input|output)_(contains|regex|jsonpath)$/.exec(rule.type);
  if (!match) return undefined;
  const target = match[1] as 'input' | 'output';
  const tool = String(rule.tool ?? '');
  if (match[2] === 'contains')
    return { target, assertion: { type: 'contains', tool, value: String(rule.value ?? '') } };
  if (match[2] === 'regex')
    return { target, assertion: { type: 'regex', tool, pattern: String(rule.value ?? '') } };
  return {
    target,
    assertion: {
      type: 'jsonpath',
      tool,
      path: String(rule.path ?? ''),
      ...(rule.equals !== undefined ? { equals: rule.equals } : {})
    }
  };
}

export function formatEvalRuleLabel(rule: EvalRule): string {
  if (rule.type === 'required_tool')
    return `Required tool · ${formatToolExpression(String(rule.value ?? ''))}`;
  if (rule.type === 'forbidden_tool') return `Forbidden tool · ${rule.value}`;
  if (rule.type === 'tool_sequence') return formatToolSequenceLabel(rule.sequence ?? []);
  const toolAssertion = toToolAssertion(rule);
  if (toolAssertion) return formatToolAssertionLabel(toolAssertion.assertion, toolAssertion.target);
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
  const toolAssertion = toToolAssertion(rule);
  if (toolAssertion) {
    const { assertion, target } = toolAssertion;
    const expectedReasons = [
      formatToolAssertionFailureReason(assertion, 'tool_not_used', target),
      formatToolAssertionFailureReason(assertion, 'input_mismatch', target),
      formatToolAssertionFailureReason(assertion, 'invalid_regex', target),
      formatToolAssertionFailureReason(assertion, 'invalid_jsonpath', target),
      formatToolAssertionFailureReason(assertion, 'serialization', target),
      ...(target === 'output'
        ? [formatToolAssertionFailureReason(assertion, 'output_unavailable', target)]
        : [])
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
    if (rule.type === 'response_starts_with')
      return `Starts-with assertion failed: ${comparableValue}`;
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
