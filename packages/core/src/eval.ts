import { JSONPath } from 'jsonpath-plus';
import { isAbortError } from './abort.js';
import type {
  AgentAssertion,
  AgentJudgeContext,
  CheckResult,
  EvalRules,
  ResponseAssertion,
  ToolConstraints,
  ToolCall,
  ToolInputAssertion
} from './types.js';

export interface EvalResult {
  pass: boolean;
  failures: string[];
  check_results: CheckResult[];
}

export interface AgentAssertionJudgeResult {
  label: string;
  pass: boolean;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface JudgeAgentAssertionsInput {
  assertions: AgentAssertion[];
  context?: AgentJudgeContext;
}

export interface EvaluateScenarioWithAgentChecksOptions {
  toolCalls?: ToolCall[];
  judgeAgentAssertions?: (input: JudgeAgentAssertionsInput) => Promise<AgentAssertionJudgeResult[]>;
  scenarioPrompt?: string;
}

export function buildNotEvaluatedCheckResults(evalRules?: EvalRules): CheckResult[] {
  if (!evalRules) return [];
  const results: CheckResult[] = [];
  for (const rule of buildToolConstraintCheckResults(evalRules.tool_constraints ?? {})) {
    results.push({
      type: rule.type,
      label: rule.label,
      status: 'not_evaluated',
      reason: undefined
    });
  }
  const sequence = evalRules.tool_sequence ?? [];
  if (sequence.length > 0) {
    results.push({
      type: 'tool_sequence',
      label: formatToolSequenceLabel(sequence),
      status: 'not_evaluated',
      metadata: { actual: [], expected: sequence }
    });
  }
  for (const rule of (evalRules.response_assertions ?? []).map(
    toCheckResultTemplateForResponseAssertion
  )) {
    results.push({ ...rule, status: 'not_evaluated', reason: undefined });
  }
  for (const rule of evalRules.tool_input_assertions ?? []) {
    results.push({
      type: toolInputAssertionType(rule),
      label: formatToolInputAssertionLabel(rule),
      status: 'not_evaluated',
      metadata: {
        tool: rule.tool,
        ...(rule.type === 'jsonpath' ? { path: rule.path } : {})
      }
    });
  }
  for (const assertion of evalRules.agent_assertions ?? []) {
    results.push({
      type: 'agent_check',
      label: assertion.label,
      status: 'not_evaluated'
    });
  }
  return results;
}

export function evaluateScenario(
  finalText: string,
  toolSequence: string[],
  evalRules?: EvalRules,
  toolCalls: ToolCall[] = []
): EvalResult {
  const failures: string[] = [];
  const check_results: CheckResult[] = [];
  if (evalRules?.tool_constraints) {
    const results = evaluateToolConstraints(toolSequence, evalRules.tool_constraints);
    failures.push(...results.failures);
    check_results.push(...results.check_results);
  }
  if (evalRules?.tool_sequence?.length) {
    const results = evaluateToolSequence(toolSequence, evalRules.tool_sequence);
    failures.push(...results.failures);
    check_results.push(...results.check_results);
  }
  if (evalRules?.tool_input_assertions?.length) {
    const results = evaluateToolInputAssertions(toolCalls, evalRules.tool_input_assertions);
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
  const base = evaluateScenario(finalText, toolSequence, evalRules, options?.toolCalls ?? []);
  const failures = [...base.failures];
  const check_results = [...base.check_results];

  const agentAssertions = evalRules?.agent_assertions ?? [];
  if (agentAssertions.length === 0) {
    return { pass: failures.length === 0, failures, check_results };
  }

  if (!options?.judgeAgentAssertions) {
    for (const assertion of agentAssertions) {
      const reason = `Agent check could not run: no judge configured for "${assertion.label}"`;
      failures.push(reason);
      check_results.push({
        type: 'agent_check',
        label: assertion.label,
        status: 'failed',
        reason
      });
    }
    return { pass: failures.length === 0, failures, check_results };
  }

  try {
    const cfg = evalRules?.agent_context;
    const builtContext: AgentJudgeContext = cfg
      ? {
          ...(cfg.include_prompt && options.scenarioPrompt != null && options.scenarioPrompt !== ''
            ? { scenario_prompt: options.scenarioPrompt }
            : {}),
          ...(cfg.include_tool_sequence ? { tool_sequence: toolSequence } : {}),
          ...(cfg.include_tool_inputs
            ? {
                tool_inputs: (options.toolCalls ?? []).map(({ name, arguments: args }) => ({
                  tool: name,
                  arguments: args as Record<string, unknown>
                }))
              }
            : {})
        }
      : {};
    const context: AgentJudgeContext | undefined =
      Object.keys(builtContext).length > 0 ? builtContext : undefined;
    const judgedResults = await options.judgeAgentAssertions({
      assertions: agentAssertions,
      context
    });
    for (const [index, assertion] of agentAssertions.entries()) {
      const judged = judgedResults[index];
      if (!judged) {
        const reason = `Judge did not return a result for "${assertion.label}"`;
        failures.push(reason);
        check_results.push({
          type: 'agent_check',
          label: assertion.label,
          status: 'failed',
          reason
        });
        continue;
      }
      if (!judged.pass) failures.push(judged.reason);
      check_results.push({
        type: 'agent_check',
        label: assertion.label,
        status: judged.pass ? 'passed' : 'failed',
        reason: judged.reason,
        ...(judged.metadata ? { metadata: judged.metadata } : {})
      });
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    const reason = `Agent check failed: ${error instanceof Error ? error.message : String(error)}`;
    for (const assertion of agentAssertions) {
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
  const unique = new Set(toolSequence);
  const check_results: CheckResult[] = buildToolConstraintCheckResults(constraints).map(
    (template): CheckResult => {
      const reason =
        template.type === 'forbidden_tool'
          ? unique.has(template.tool)
            ? `Forbidden tool used: ${template.tool}`
            : undefined
          : !unique.has(template.tool)
          ? `Required tool not used: ${template.tool}`
          : undefined;
      if (reason) failures.push(reason);
      return {
        type: template.type,
        label: template.label,
        status: reason ? 'failed' : 'passed',
        reason
      };
    }
  );
  return { failures, check_results };
}

function evaluateToolSequence(
  actual: string[],
  expected: string[]
): Pick<EvalResult, 'failures' | 'check_results'> {
  const label = formatToolSequenceLabel(expected);
  if (expected.length === 0) {
    return {
      failures: [],
      check_results: [
        {
          type: 'tool_sequence',
          label,
          status: 'passed',
          metadata: { actual, expected }
        }
      ]
    };
  }

  let cursor = 0;
  for (const tool of expected) {
    const index = actual.indexOf(tool, cursor);
    if (index < 0) {
      const reason = actual.includes(tool)
        ? `Tool sequence order was not satisfied: ${expected.join(' -> ')}`
        : `Required tool in sequence not used: ${tool}`;
      return {
        failures: [reason],
        check_results: [
          {
            type: 'tool_sequence',
            label,
            status: 'failed',
            reason,
            metadata: { actual, expected }
          }
        ]
      };
    }
    cursor = index + 1;
  }

  return {
    failures: [],
    check_results: [
      {
        type: 'tool_sequence',
        label,
        status: 'passed',
        metadata: { actual, expected }
      }
    ]
  };
}

function toolInputAssertionType(assertion: ToolInputAssertion): string {
  return `tool_input_${assertion.type}`;
}

export function formatToolInputAssertionLabel(assertion: ToolInputAssertion): string {
  const operator =
    assertion.type === 'contains'
      ? `contains ${assertion.value}`
      : assertion.type === 'regex'
      ? `matches regex ${assertion.pattern}`
      : assertion.equals !== undefined
      ? `JSONPath ${assertion.path} == ${String(assertion.equals)}`
      : `JSONPath ${assertion.path} exists`;
  return `Tool input · ${assertion.tool} ${operator}`;
}

export type ToolInputAssertionFailureKind =
  | 'tool_not_used'
  | 'input_mismatch'
  | 'invalid_regex'
  | 'invalid_jsonpath'
  | 'serialization';

export function formatToolInputAssertionFailureReason(
  assertion: ToolInputAssertion,
  kind: ToolInputAssertionFailureKind
): string {
  if (kind === 'tool_not_used') {
    return `Tool input assertion failed: tool not used: ${assertion.tool}`;
  }
  if (kind === 'invalid_regex' && assertion.type === 'regex') {
    return `Tool input assertion failed: invalid regex ${assertion.pattern}`;
  }
  const expectation =
    assertion.type === 'contains'
      ? `contains ${assertion.value}`
      : assertion.type === 'regex'
      ? `regex ${assertion.pattern}`
      : assertion.equals !== undefined
      ? `JSONPath ${assertion.path} == ${String(assertion.equals)}`
      : `JSONPath ${assertion.path} exists`;
  if (kind === 'invalid_jsonpath' && assertion.type === 'jsonpath') {
    return `Tool input assertion failed: invalid JSONPath ${assertion.path} (expected: ${expectation})`;
  }
  if (kind === 'serialization' && (assertion.type === 'contains' || assertion.type === 'regex')) {
    return `Tool input assertion failed: could not serialize tool input for ${assertion.tool} (expected: ${expectation})`;
  }
  return `Tool input assertion failed: ${assertion.tool} input did not match (expected: ${expectation})`;
}

function usesSerializedToolInput(
  assertion: ToolInputAssertion
): assertion is Extract<ToolInputAssertion, { type: 'contains' | 'regex' }> {
  return assertion.type === 'contains' || assertion.type === 'regex';
}

function evaluateToolInputAssertions(
  toolCalls: ToolCall[],
  assertions: ToolInputAssertion[]
): Pick<EvalResult, 'failures' | 'check_results'> {
  const failures: string[] = [];
  const check_results: CheckResult[] = assertions.map((assertion) => {
    const matchingCalls = toolCalls.filter((call) => call.name === assertion.tool);
    let reason: string | undefined;
    let matchedCallCount = 0;
    let inputErrorCount = 0;

    if (assertion.type === 'regex') {
      try {
        new RegExp(assertion.pattern);
      } catch {
        reason = formatToolInputAssertionFailureReason(assertion, 'invalid_regex');
      }
    }

    if (!reason) {
      for (const call of matchingCalls) {
        try {
          const values = usesSerializedToolInput(assertion)
            ? [JSON.stringify(call.arguments)]
            : (JSONPath({ path: assertion.path, json: call.arguments as any }) as unknown[]);
          if (matchesToolInputAssertion(assertion, values)) matchedCallCount += 1;
        } catch {
          inputErrorCount += 1;
          continue;
        }
      }
    }
    if (matchedCallCount === 0 && !reason) {
      reason =
        matchingCalls.length === 0
          ? formatToolInputAssertionFailureReason(assertion, 'tool_not_used')
          : inputErrorCount === matchingCalls.length && assertion.type === 'jsonpath'
          ? formatToolInputAssertionFailureReason(assertion, 'invalid_jsonpath')
          : inputErrorCount === matchingCalls.length &&
            (assertion.type === 'contains' || assertion.type === 'regex')
          ? formatToolInputAssertionFailureReason(assertion, 'serialization')
          : formatToolInputAssertionFailureReason(assertion, 'input_mismatch');
    }
    if (reason) failures.push(reason);
    return {
      type: toolInputAssertionType(assertion),
      label: formatToolInputAssertionLabel(assertion),
      status: reason ? 'failed' : 'passed',
      reason,
      metadata: {
        tool: assertion.tool,
        ...(assertion.type === 'contains' ? { value: assertion.value } : {}),
        ...(assertion.type === 'regex' ? { pattern: assertion.pattern } : {}),
        ...(assertion.type === 'jsonpath'
          ? {
              path: assertion.path,
              ...(assertion.equals !== undefined ? { equals: assertion.equals } : {})
            }
          : {}),
        matched_call_count: matchedCallCount,
        observed_call_count: matchingCalls.length
      }
    };
  });
  return { failures, check_results };
}

function matchesToolInputAssertion(assertion: ToolInputAssertion, values: unknown[]): boolean {
  if (assertion.type === 'contains') {
    return values.some((value) =>
      String(value ?? '')
        .toLowerCase()
        .includes(assertion.value.toLowerCase())
    );
  }
  if (assertion.type === 'regex') {
    return new RegExp(assertion.pattern).test(String(values[0] ?? ''));
  }
  return assertion.equals === undefined
    ? values.length > 0
    : values.some((value) => value === assertion.equals);
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
    const template = toCheckResultTemplateForResponseAssertion(assertion);
    if (assertion.type === 'regex') {
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
      if (!normalizedText.includes(assertion.value.toLowerCase())) {
        reason = `Contains assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'not_contains') {
      if (normalizedText.includes(assertion.value.toLowerCase())) {
        reason = `Not-contains assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'starts_with') {
      if (!normalizedText.startsWith(assertion.value.toLowerCase())) {
        reason = `Starts-with assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'ends_with') {
      if (!normalizedText.endsWith(assertion.value.toLowerCase())) {
        reason = `Ends-with assertion failed: ${assertion.value}`;
      }
    }

    if (assertion.type === 'equals') {
      if (normalizedText !== assertion.value.toLowerCase()) {
        reason = `Equals assertion failed: ${assertion.value}`;
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
        reason = `JSONPath assertion failed: invalid JSON for path ${assertion.path}`;
        failures.push(reason);
        check_results.push({ ...template, status: 'failed', reason });
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
    check_results.push({ ...template, status: reason ? 'failed' : 'passed', reason });
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
    default:
      return assertNever(assertionType);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled response assertion type: ${String(value)}`);
}

function buildToolConstraintCheckResults(
  constraints: ToolConstraints
): Array<{ type: 'forbidden_tool' | 'required_tool'; tool: string; label: string }> {
  const results: Array<{ type: 'forbidden_tool' | 'required_tool'; tool: string; label: string }> =
    [];
  for (const tool of constraints.forbidden_tools ?? []) {
    results.push({
      type: 'forbidden_tool',
      tool,
      label: `Forbidden tool · ${tool}`
    });
  }
  for (const tool of constraints.required_tools ?? []) {
    results.push({
      type: 'required_tool',
      tool,
      label: `Required tool · ${tool}`
    });
  }
  return results;
}

function toCheckResultTemplateForResponseAssertion(assertion: ResponseAssertion): CheckResult {
  if (assertion.type === 'regex') {
    return {
      type: toUiRuleType(assertion.type),
      label: `Text matches regex · ${assertion.pattern}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'contains') {
    return {
      type: toUiRuleType(assertion.type),
      label: `Text contains · ${assertion.value}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'not_contains') {
    return {
      type: toUiRuleType(assertion.type),
      label: `Text does not contain · ${assertion.value}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'starts_with') {
    return {
      type: toUiRuleType(assertion.type),
      label: `Text starts with · ${assertion.value}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'ends_with') {
    return {
      type: toUiRuleType(assertion.type),
      label: `Text ends with · ${assertion.value}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'equals') {
    return {
      type: toUiRuleType(assertion.type),
      label: `Text equals · ${assertion.value}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'jsonpath') {
    return {
      type: toUiRuleType(assertion.type),
      label:
        assertion.equals !== undefined
          ? `JSONPath equals · ${assertion.path} == ${String(assertion.equals)}`
          : `JSONPath exists · ${assertion.path}`,
      status: 'passed'
    };
  }
  if (assertion.type === 'jsonpath_exists') {
    return {
      type: toUiRuleType(assertion.type),
      label: `JSONPath exists · ${assertion.path}`,
      status: 'passed'
    };
  }
  return {
    type: toUiRuleType(assertion.type),
    label: `JSONPath not exists · ${assertion.path}`,
    status: 'passed'
  };
}

export function formatToolSequenceLabel(sequence: string[]): string {
  return sequence.length > 0 ? `Tool sequence · ${sequence.join(' -> ')}` : 'Tool sequence';
}
