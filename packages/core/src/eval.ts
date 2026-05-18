import { JSONPath } from 'jsonpath-plus';
import type {
  CheckSeverity,
  EvalRules,
  FailureEntry,
  ResponseAssertion,
  ToolConstraints
} from './types.js';

export interface EvalResult {
  pass: boolean;
  failures: FailureEntry[];
  error_failures: number;
  warning_failures: number;
}

export function evaluateScenario(
  finalText: string,
  toolSequence: string[],
  evalRules?: EvalRules
): EvalResult {
  const failures: FailureEntry[] = [];
  if (evalRules?.tool_constraints) {
    failures.push(...evaluateToolConstraints(toolSequence, evalRules.tool_constraints));
  }
  if (evalRules?.tool_sequence?.allow?.length) {
    failures.push(...evaluateToolSequence(toolSequence, evalRules.tool_sequence.allow));
  }
  if (evalRules?.response_assertions?.length) {
    failures.push(...evaluateResponseAssertions(finalText, evalRules.response_assertions));
  }
  const errorFailures = failures.filter((failure) => failure.severity === 'error').length;
  const warningFailures = failures.filter((failure) => failure.severity === 'warning').length;
  return {
    pass: errorFailures === 0,
    failures,
    error_failures: errorFailures,
    warning_failures: warningFailures
  };
}

function toFailure(message: string, severity: CheckSeverity = 'error'): FailureEntry {
  return { message, severity };
}

function evaluateToolConstraints(
  toolSequence: string[],
  constraints: ToolConstraints
): FailureEntry[] {
  const failures: FailureEntry[] = [];
  const unique = new Set(toolSequence);
  if (constraints.forbidden_tools) {
    for (const tool of constraints.forbidden_tools) {
      if (unique.has(tool)) {
        failures.push(toFailure(`Forbidden tool used: ${tool}`));
      }
    }
  }
  if (constraints.required_tools) {
    for (const tool of constraints.required_tools) {
      if (!unique.has(tool)) {
        failures.push(toFailure(`Required tool not used: ${tool}`));
      }
    }
  }
  return failures;
}

function evaluateToolSequence(actual: string[], allowed: string[][]): FailureEntry[] {
  const actualKey = JSON.stringify(actual);
  const allowedKeys = new Set(allowed.map((seq) => JSON.stringify(seq)));
  if (!allowedKeys.has(actualKey)) {
    return [toFailure('Tool sequence did not match any allowed sequence')];
  }
  return [];
}

function evaluateResponseAssertions(text: string, assertions: ResponseAssertion[]): FailureEntry[] {
  const failures: FailureEntry[] = [];
  const normalizedText = text.toLowerCase();
  for (const assertion of assertions) {
    const severity: CheckSeverity = assertion.severity ?? 'error';
    if (assertion.type === 'regex') {
      try {
        // Default text pattern checks to case-insensitive to reduce brittle LLM-output casing failures.
        // Strip inline flags like (?i), (?m), (?s) — not valid in JS; 'i' is already applied.
        // Only leading flags (at the very start of the pattern) are stripped; embedded flags mid-pattern are not handled.
        const sanitized = assertion.pattern.replace(/^\(\?[imsx]+\)/, '');
        const re = new RegExp(sanitized, 'i');
        if (!re.test(text)) {
          failures.push(toFailure(`Regex assertion failed: ${assertion.pattern}`, severity));
        }
      } catch (err) {
        failures.push(toFailure(`Invalid regex: ${assertion.pattern}`, severity));
      }
    }

    if (assertion.type === 'contains') {
      if (!normalizedText.includes(assertion.value.toLowerCase())) {
        failures.push(toFailure(`Contains assertion failed: ${assertion.value}`, severity));
      }
    }

    if (assertion.type === 'not_contains') {
      if (normalizedText.includes(assertion.value.toLowerCase())) {
        failures.push(toFailure(`Not-contains assertion failed: ${assertion.value}`, severity));
      }
    }

    if (assertion.type === 'starts_with') {
      if (!normalizedText.startsWith(assertion.value.toLowerCase())) {
        failures.push(toFailure(`Starts-with assertion failed: ${assertion.value}`, severity));
      }
    }

    if (assertion.type === 'ends_with') {
      if (!normalizedText.endsWith(assertion.value.toLowerCase())) {
        failures.push(toFailure(`Ends-with assertion failed: ${assertion.value}`, severity));
      }
    }

    if (assertion.type === 'equals') {
      if (normalizedText !== assertion.value.toLowerCase()) {
        failures.push(toFailure(`Equals assertion failed: ${assertion.value}`, severity));
      }
    }

    if (
      assertion.type === 'jsonpath' ||
      assertion.type === 'jsonpath_exists' ||
      assertion.type === 'jsonpath_not_exists'
    ) {
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        failures.push(
          toFailure(`JSONPath assertion failed: invalid JSON for path ${assertion.path}`, severity)
        );
        continue;
      }
      const result = JSONPath({ path: assertion.path, json });
      if (assertion.type === 'jsonpath' && assertion.equals !== undefined) {
        const matched = result.some((value: unknown) => value === assertion.equals);
        if (!matched) {
          failures.push(toFailure(`JSONPath equals assertion failed: ${assertion.path}`, severity));
        }
      } else if (assertion.type === 'jsonpath_not_exists') {
        if (result && result.length > 0) {
          failures.push(
            toFailure(`JSONPath not-exists assertion failed: ${assertion.path}`, severity)
          );
        }
      } else if (!result || result.length === 0) {
        failures.push(toFailure(`JSONPath assertion failed: ${assertion.path}`, severity));
      }
    }
  }
  return failures;
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
