import { JSONPath } from 'jsonpath-plus';
import type {
  AgentAssertion,
  CheckResult,
  EvalRules,
  ResponseAssertion,
  ToolConstraints
} from './types.js';

export interface EvalResult {
  pass: boolean;
  failures: string[];
  check_results: CheckResult[];
}

export interface AgentAssertionJudgeResult {
  pass: boolean;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface EvaluateScenarioWithAgentChecksOptions {
  judgeAgentAssertion?: (assertion: AgentAssertion) => Promise<AgentAssertionJudgeResult>;
}

export function evaluateScenario(
  finalText: string,
  toolSequence: string[],
  evalRules?: EvalRules
): EvalResult {
  const failures: string[] = [];
  const check_results: CheckResult[] = [];
  if (evalRules?.tool_constraints) {
    const results = evaluateToolConstraints(toolSequence, evalRules.tool_constraints);
    failures.push(...results.failures);
    check_results.push(...results.check_results);
  }
  if (evalRules?.tool_sequence?.allow?.length) {
    const results = evaluateToolSequence(toolSequence, evalRules.tool_sequence.allow);
    failures.push(...results.failures);
    check_results.push(...results.check_results);
  }
  if (evalRules?.response_assertions?.length) {
    const results = evaluateResponseAssertions(finalText, evalRules.response_assertions);
    failures.push(...results.failures);
    check_results.push(...results.check_results);
  }
  return { pass: failures.length === 0, failures, check_results };
}

export async function evaluateScenarioWithAgentChecks(
  finalText: string,
  toolSequence: string[],
  evalRules?: EvalRules,
  options?: EvaluateScenarioWithAgentChecksOptions
): Promise<EvalResult> {
  const base = evaluateScenario(finalText, toolSequence, evalRules);
  const failures = [...base.failures];
  const check_results = [...base.check_results];

  for (const assertion of evalRules?.agent_assertions ?? []) {
    if (!options?.judgeAgentAssertion) {
      const reason = `Agent check could not run: no judge configured for "${assertion.label}"`;
      failures.push(reason);
      check_results.push({
        type: 'agent_check',
        label: assertion.label,
        status: 'failed',
        reason
      });
      continue;
    }

    try {
      const judged = await options.judgeAgentAssertion(assertion);
      if (!judged.pass) failures.push(judged.reason);
      check_results.push({
        type: 'agent_check',
        label: assertion.label,
        status: judged.pass ? 'passed' : 'failed',
        reason: judged.reason,
        ...(judged.metadata ? { metadata: judged.metadata } : {})
      });
    } catch (error) {
      const reason = `Agent check failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      failures.push(reason);
      check_results.push({
        type: 'agent_check',
        label: assertion.label,
        status: 'failed',
        reason
      });
    }
  }

  return { pass: failures.length === 0, failures, check_results };
}

function evaluateToolConstraints(
  toolSequence: string[],
  constraints: ToolConstraints
): Pick<EvalResult, 'failures' | 'check_results'> {
  const failures: string[] = [];
  const check_results: CheckResult[] = [];
  const unique = new Set(toolSequence);
  if (constraints.forbidden_tools) {
    for (const tool of constraints.forbidden_tools) {
      const reason = unique.has(tool) ? `Forbidden tool used: ${tool}` : undefined;
      if (reason) failures.push(reason);
      check_results.push({
        type: 'forbidden_tool',
        label: `Forbidden tool · ${tool}`,
        status: reason ? 'failed' : 'passed',
        reason
      });
    }
  }
  if (constraints.required_tools) {
    for (const tool of constraints.required_tools) {
      const reason = !unique.has(tool) ? `Required tool not used: ${tool}` : undefined;
      if (reason) failures.push(reason);
      check_results.push({
        type: 'required_tool',
        label: `Required tool · ${tool}`,
        status: reason ? 'failed' : 'passed',
        reason
      });
    }
  }
  return { failures, check_results };
}

function evaluateToolSequence(
  actual: string[],
  allowed: string[][]
): Pick<EvalResult, 'failures' | 'check_results'> {
  const actualKey = JSON.stringify(actual);
  const allowedKeys = new Set(allowed.map((seq) => JSON.stringify(seq)));
  if (!allowedKeys.has(actualKey)) {
    const reason = 'Tool sequence did not match any allowed sequence';
    return {
      failures: [reason],
      check_results: [
        {
          type: 'tool_sequence',
          label: 'Allowed tool sequence',
          status: 'failed',
          reason,
          metadata: { actual, allowed }
        }
      ]
    };
  }
  return {
    failures: [],
    check_results: [
      {
        type: 'tool_sequence',
        label: 'Allowed tool sequence',
        status: 'passed',
        metadata: { actual, allowed }
      }
    ]
  };
}

function evaluateResponseAssertions(
  text: string,
  assertions: ResponseAssertion[]
): Pick<EvalResult, 'failures' | 'check_results'> {
  const failures: string[] = [];
  const check_results: CheckResult[] = [];
  const normalizedText = text.toLowerCase();
  for (const assertion of assertions) {
    let reason: string | undefined;
    let label: string = assertion.type;
    if (assertion.type === 'regex') {
      label = `Text matches regex · ${assertion.pattern}`;
      try {
        // Default text pattern checks to case-insensitive to reduce brittle LLM-output casing failures.
        // Strip inline flags like (?i), (?m), (?s) — not valid in JS; 'i' is already applied.
        // Only leading flags (at the very start of the pattern) are stripped; embedded flags mid-pattern are not handled.
        const sanitized = assertion.pattern.replace(/^\(\?[imsx]+\)/, '');
        const re = new RegExp(sanitized, 'i');
        if (!re.test(text)) {
          reason = `Regex assertion failed: ${assertion.pattern}`;
        }
      } catch (err) {
        reason = `Invalid regex: ${assertion.pattern}`;
      }
    }

    if (assertion.type === 'contains') {
      label = `Text contains · ${assertion.value}`;
      if (!normalizedText.includes(assertion.value.toLowerCase())) {
        reason = `Contains assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'not_contains') {
      label = `Text does not contain · ${assertion.value}`;
      if (normalizedText.includes(assertion.value.toLowerCase())) {
        reason = `Not-contains assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'starts_with') {
      label = `Text starts with · ${assertion.value}`;
      if (!normalizedText.startsWith(assertion.value.toLowerCase())) {
        reason = `Starts-with assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'ends_with') {
      label = `Text ends with · ${assertion.value}`;
      if (!normalizedText.endsWith(assertion.value.toLowerCase())) {
        reason = `Ends-with assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'equals') {
      label = `Text equals · ${assertion.value}`;
      if (normalizedText !== assertion.value.toLowerCase()) {
        reason = `Equals assertion failed: ${assertion.value}`;
      }
    }

    if (
      assertion.type === 'jsonpath' ||
      assertion.type === 'jsonpath_exists' ||
      assertion.type === 'jsonpath_not_exists'
    ) {
      label =
        assertion.type === 'jsonpath'
          ? assertion.equals !== undefined
            ? `JSONPath equals · ${assertion.path} == ${String(assertion.equals)}`
            : `JSONPath exists · ${assertion.path}`
          : assertion.type === 'jsonpath_exists'
          ? `JSONPath exists · ${assertion.path}`
          : `JSONPath not exists · ${assertion.path}`;
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        reason = `JSONPath assertion failed: invalid JSON for path ${assertion.path}`;
        failures.push(reason);
        check_results.push({
          type: toUiRuleType(assertion.type),
          label,
          status: 'failed',
          reason
        });
        continue;
      }
      const result = JSONPath({ path: assertion.path, json });
      if (assertion.type === 'jsonpath' && assertion.equals !== undefined) {
        const matched = result.some((value: unknown) => value === assertion.equals);
        if (!matched) {
          reason = `JSONPath equals assertion failed: ${assertion.path}`;
        }
      } else if (assertion.type === 'jsonpath_not_exists') {
        if (result && result.length > 0) {
          reason = `JSONPath not-exists assertion failed: ${assertion.path}`;
        }
      } else if (!result || result.length === 0) {
        reason = `JSONPath assertion failed: ${assertion.path}`;
      }
    }
    if (reason) failures.push(reason);
    check_results.push({
      type: toUiRuleType(assertion.type),
      label,
      status: reason ? 'failed' : 'passed',
      reason
    });
  }
  return { failures, check_results };
}

export function extractValues(
  text: string,
  extractRules: { name: string; regex: string }[] = []
): Record<string, string | number | boolean | null> {
  const extracted: Record<string, string | number | boolean | null> = {};
  for (const rule of extractRules) {
    try {
      const re = new RegExp(rule.regex);
      const match = re.exec(text);
      if (!match) {
        extracted[rule.name] = null;
        continue;
      }
      const value = match.groups?.value ?? match[1] ?? match[0];
      extracted[rule.name] = coerceValue(value);
    } catch {
      extracted[rule.name] = null;
    }
  }
  return extracted;
}

function coerceValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    return num;
  }
  return value;
}

function toUiRuleType(assertionType: ResponseAssertion['type']): string {
  switch (assertionType) {
    case 'regex':
      return 'response_regex';
    case 'contains':
      return 'response_contains';
    case 'not_contains':
      return 'response_not_contains';
    case 'starts_with':
      return 'response_starts_with';
    case 'ends_with':
      return 'response_ends_with';
    case 'equals':
      return 'response_equals';
    case 'jsonpath':
      return 'response_jsonpath';
    case 'jsonpath_exists':
      return 'response_jsonpath_exists';
    case 'jsonpath_not_exists':
      return 'response_jsonpath_not_exists';
  }
}
