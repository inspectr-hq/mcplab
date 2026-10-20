import type { EvalRules } from './types.js';

export function parseToolAlternatives(expression: string): string[] {
  const alternatives = expression.split('|').map((name) => name.trim());
  if (alternatives.some((name) => !name)) throw new Error('Tool alternatives cannot be empty.');
  if (new Set(alternatives).size !== alternatives.length) {
    throw new Error(`Duplicate tool alternative in "${expression}".`);
  }
  return alternatives;
}

export function normalizeToolExpression(
  expression: string,
  resolveName: (name: string) => string = (name) => name
): string {
  const alternatives = [...new Set(parseToolAlternatives(expression).map(resolveName))];
  return alternatives.join('|');
}

export function formatToolAlternatives(expression: string): string {
  return parseToolAlternatives(expression).join(' OR ');
}

export function resolveToolNameAlias(name: string, availableToolNames: string[]): string {
  if (availableToolNames.includes(name)) return name;
  const suffix = name.slice(name.lastIndexOf(':') + 1);
  return name.includes(':') && availableToolNames.includes(suffix) ? suffix : name;
}

export function validateEvalToolRules(
  rules: EvalRules | undefined,
  context?: string,
  availableToolNames?: string[]
): string[] {
  const warnings: string[] = [];
  if (!rules) return warnings;
  const requiredRules = rules.tool_constraints?.required_tools ?? [];
  const forbiddenRules = rules.tool_constraints?.forbidden_tools ?? [];
  const sequenceRules = rules.tool_sequence ?? [];
  if (!Array.isArray(requiredRules))
    throw new Error(
      `${context ?? 'Eval rules'}: tool_constraints.required_tools must be an array.`
    );
  if (!Array.isArray(forbiddenRules))
    throw new Error(
      `${context ?? 'Eval rules'}: tool_constraints.forbidden_tools must be an array.`
    );
  if (!Array.isArray(sequenceRules))
    throw new Error(`${context ?? 'Eval rules'}: tool_sequence must be an array.`);
  const resolve = (name: string) =>
    availableToolNames?.length ? resolveToolNameAlias(name, availableToolNames) : name;
  const forbidden = new Set(
    (rules.tool_constraints?.forbidden_tools ?? []).map((name, index) => {
      if (typeof name !== 'string' || name.includes('|') || !name.trim())
        throw new Error(
          `${context ?? 'Eval rules'}: tool_constraints.forbidden_tools[${index}] must be a non-empty single tool name.`
        );
      return resolve(name.trim());
    })
  );
  const validateRequired = (expression: string, path: string) => {
    if (typeof expression !== 'string')
      throw new Error(`${context ?? 'Eval rules'}: ${path} must be a tool expression string.`);
    let normalized: string;
    try {
      normalized = normalizeToolExpression(expression, resolve);
    } catch (error) {
      throw new Error(
        `${context ?? 'Eval rules'}: ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const names = normalized.split('|');
    const blocked = names.filter((name) => forbidden.has(name));
    if (blocked.length === names.length)
      throw new Error(
        `${context ?? 'Eval rules'}: ${path} expression "${expression}" is entirely forbidden.`
      );
    if (blocked.length) {
      const authoredNames = expression.split('|').map((name) => name.trim());
      const blockedNames = authoredNames.filter((_, index) => forbidden.has(names[index]));
      warnings.push(
        `${context ? `${context}: ` : ''}${path} expression "${expression}" includes forbidden alternative${blocked.length > 1 ? 's' : ''}: ${blockedNames.join(', ')}.`
      );
    }
  };
  for (const [index, expression] of requiredRules.entries())
    validateRequired(expression, `tool_constraints.required_tools[${index}]`);
  for (const [index, expression] of sequenceRules.entries())
    validateRequired(expression, `tool_sequence[${index}]`);
  return warnings;
}

export function normalizeEvalToolRules(rules: EvalRules | undefined): EvalRules | undefined {
  if (!rules) return undefined;
  return {
    ...rules,
    ...(rules.tool_constraints
      ? {
          tool_constraints: {
            ...rules.tool_constraints,
            ...(rules.tool_constraints.required_tools
              ? {
                  required_tools: rules.tool_constraints.required_tools.map((x) =>
                    normalizeToolExpression(x)
                  )
                }
              : {}),
            ...(rules.tool_constraints.forbidden_tools
              ? { forbidden_tools: rules.tool_constraints.forbidden_tools.map((x) => x.trim()) }
              : {})
          }
        }
      : {}),
    ...(rules.tool_sequence
      ? { tool_sequence: rules.tool_sequence.map((x) => normalizeToolExpression(x)) }
      : {})
  };
}
