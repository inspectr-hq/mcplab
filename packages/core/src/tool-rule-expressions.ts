import type { EvalRules } from './types.js';

/** Split a `search | lookup` expression into trimmed tool names. */
export function parseToolAlternatives(expression: string): string[] {
  if (typeof expression !== 'string') throw new Error('Tool expression must be a string.');
  const alternatives = expression.split('|').map((name) => name.trim());
  if (alternatives.some((name) => !name)) throw new Error('Tool alternatives cannot be empty.');
  if (new Set(alternatives).size !== alternatives.length) {
    throw new Error(`Duplicate tool alternative in "${expression}".`);
  }
  return alternatives;
}

/** Canonicalize an expression and deduplicate names after optional alias mapping. */
export function normalizeToolExpression(
  expression: string,
  options: { mapTool?: (name: string) => string } = {}
): string {
  const mapTool = options.mapTool ?? ((name: string) => name);
  return [...new Set(parseToolAlternatives(expression).map(mapTool))].join('|');
}

export function isValidToolExpression(expression: string): boolean {
  try {
    parseToolAlternatives(expression);
    return true;
  } catch {
    return false;
  }
}

/** Display form used in labels and reasons: `search` or `(search OR lookup)`. */
export function formatToolExpression(expression: string): string {
  if (!isValidToolExpression(expression)) return expression;
  const alternatives = parseToolAlternatives(expression);
  return alternatives.length > 1 ? `(${alternatives.join(' OR ')})` : alternatives[0];
}

/** Throw when a required tool or sequence step is malformed, or a forbidden tool is blank or uses `|`. */
export function validateEvalToolRules(rules: EvalRules | undefined, context = 'Eval rules'): void {
  if (rules === undefined) return;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new Error(`${context} must be an object.`);
  }
  const rawRules = rules as unknown as Record<string, unknown>;
  const rawConstraints = rawRules.tool_constraints;
  if (
    rawConstraints !== undefined &&
    (!rawConstraints || typeof rawConstraints !== 'object' || Array.isArray(rawConstraints))
  ) {
    throw new Error(`${context}: tool_constraints must be an object.`);
  }
  const constraints = rawConstraints as Record<string, unknown> | undefined;
  const requiredTools = constraints?.required_tools;
  const sequence = rawRules.tool_sequence;
  const forbiddenTools = constraints?.forbidden_tools;
  const requireArray = (value: unknown, path: string): unknown[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error(`${context}: ${path} must be an array.`);
    return value;
  };
  const requiredToolList = requireArray(requiredTools, 'tool_constraints.required_tools');
  const sequenceList = requireArray(sequence, 'tool_sequence');
  const forbiddenToolList = requireArray(forbiddenTools, 'tool_constraints.forbidden_tools');
  const check = (expression: unknown, path: string) => {
    try {
      parseToolAlternatives(expression as string);
    } catch (error) {
      throw new Error(`${context}: ${path}: ${(error as Error).message}`);
    }
  };
  requiredToolList?.forEach((expression, index) =>
    check(expression, `tool_constraints.required_tools[${index}]`)
  );
  sequenceList?.forEach((expression, index) => check(expression, `tool_sequence[${index}]`));
  forbiddenToolList?.forEach((name, index) => {
    if (typeof name !== 'string' || name.includes('|') || !name.trim())
      throw new Error(
        `${context}: tool_constraints.forbidden_tools[${index}] must be one non-empty tool name.`
      );
  });
}
