import type { EvalRule, Scenario } from '@/types/eval';

const copilotEvalRuleTypes = new Set<EvalRule['type']>([
  'required_tool',
  'forbidden_tool',
  'tool_sequence',
  'response_contains',
  'response_not_contains',
  'response_starts_with',
  'response_ends_with',
  'response_equals',
  'response_regex',
  'response_jsonpath',
  'response_jsonpath_exists',
  'response_jsonpath_not_exists',
  'agent_check'
]);

export function normalizeCopilotEvalRules(value: unknown): EvalRule[] {
  if (!Array.isArray(value)) throw new Error('evalRules must be an array.');
  return value.map((rawRule) => {
    if (!rawRule || typeof rawRule !== 'object')
      throw new Error('evalRules contains an unsupported rule type.');
    const input = rawRule as Record<string, unknown>;
    const type = input.type;
    if (typeof type !== 'string' || !copilotEvalRuleTypes.has(type as EvalRule['type']))
      throw new Error('evalRules contains an unsupported rule type.');
    const rule: EvalRule = { type: type as EvalRule['type'] };
    const copyString = (key: keyof EvalRule, ...aliases: string[]) => {
      const candidate = [key, ...aliases]
        .map((name) => input[name as string])
        .find((item): item is string => typeof item === 'string');
      if (candidate !== undefined) rule[key] = candidate as never;
    };
    if (type === 'required_tool' || type === 'forbidden_tool') copyString('value', 'tool', 'name');
    else if (type === 'tool_sequence') {
      const sequence = input.sequence ?? input.toolSequence;
      if (typeof sequence === 'string') rule.sequence = [sequence];
      else if (Array.isArray(sequence) && sequence.every((item) => typeof item === 'string'))
        rule.sequence = sequence;
      else throw new Error('tool_sequence rules must contain a sequence array.');
    } else if (
      type === 'response_jsonpath' ||
      type === 'response_jsonpath_exists' ||
      type === 'response_jsonpath_not_exists'
    ) {
      copyString('path', 'jsonpath');
      if (
        typeof input.equals === 'string' ||
        typeof input.equals === 'number' ||
        typeof input.equals === 'boolean'
      )
        rule.equals = input.equals;
    } else if (type === 'agent_check') {
      copyString('label');
      copyString('prompt');
    } else copyString('value', 'text', 'contains', 'pattern', 'regex');
    return rule;
  });
}

export function validateCopilotExtractRules(value: unknown): Scenario['extractRules'] {
  if (!Array.isArray(value)) throw new Error('extractRules must be an array.');
  for (const rule of value) {
    if (
      !rule ||
      typeof rule !== 'object' ||
      typeof (rule as { name?: unknown }).name !== 'string' ||
      typeof (rule as { pattern?: unknown }).pattern !== 'string'
    ) {
      throw new Error('extractRules entries require string name and pattern fields.');
    }
  }
  return value as Scenario['extractRules'];
}
