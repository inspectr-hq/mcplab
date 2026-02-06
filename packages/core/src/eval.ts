import { JSONPath } from 'jsonpath-plus';
import type { EvalRules, ResponseAssertion, ToolConstraints } from './types.js';

export interface EvalResult {
  pass: boolean;
  failures: string[];
}

export function evaluateScenario(
  finalText: string,
  toolSequence: string[],
  evalRules?: EvalRules
): EvalResult {
  const failures: string[] = [];
  if (evalRules?.tool_constraints) {
    failures.push(...evaluateToolConstraints(toolSequence, evalRules.tool_constraints));
  }
  if (evalRules?.tool_sequence?.allow?.length) {
    failures.push(...evaluateToolSequence(toolSequence, evalRules.tool_sequence.allow));
  }
  if (evalRules?.response_assertions?.length) {
    failures.push(...evaluateResponseAssertions(finalText, evalRules.response_assertions));
  }
  return { pass: failures.length === 0, failures };
}

function evaluateToolConstraints(toolSequence: string[], constraints: ToolConstraints): string[] {
  const failures: string[] = [];
  const unique = new Set(toolSequence);
  if (constraints.forbidden_tools) {
    for (const tool of constraints.forbidden_tools) {
      if (unique.has(tool)) {
        failures.push(`Forbidden tool used: ${tool}`);
      }
    }
  }
  if (constraints.required_tools) {
    for (const tool of constraints.required_tools) {
      if (!unique.has(tool)) {
        failures.push(`Required tool not used: ${tool}`);
      }
    }
  }
  return failures;
}

function evaluateToolSequence(actual: string[], allowed: string[][]): string[] {
  const actualKey = JSON.stringify(actual);
  const allowedKeys = new Set(allowed.map((seq) => JSON.stringify(seq)));
  if (!allowedKeys.has(actualKey)) {
    return ['Tool sequence did not match any allowed sequence'];
  }
  return [];
}

function evaluateResponseAssertions(text: string, assertions: ResponseAssertion[]): string[] {
  const failures: string[] = [];
  for (const assertion of assertions) {
    if (assertion.type === 'regex') {
      try {
        const re = new RegExp(assertion.pattern);
        if (!re.test(text)) {
          failures.push(`Regex assertion failed: ${assertion.pattern}`);
        }
      } catch (err) {
        failures.push(`Invalid regex: ${assertion.pattern}`);
      }
    }
    if (assertion.type === 'jsonpath') {
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        failures.push(`JSONPath assertion failed: invalid JSON for path ${assertion.path}`);
        continue;
      }
      const result = JSONPath({ path: assertion.path, json });
      if (assertion.equals !== undefined) {
        const matched = result.some((value: unknown) => value === assertion.equals);
        if (!matched) {
          failures.push(`JSONPath equals assertion failed: ${assertion.path}`);
        }
      } else if (!result || result.length === 0) {
        failures.push(`JSONPath assertion failed: ${assertion.path}`);
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
