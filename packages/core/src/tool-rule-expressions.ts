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
  const check = (expression: string, path: string) => {
    try {
      parseToolAlternatives(expression);
    } catch (error) {
      throw new Error(`${context}: ${path}: ${(error as Error).message}`);
    }
  };
  rules?.tool_constraints?.required_tools?.forEach((expression, index) =>
    check(expression, `tool_constraints.required_tools[${index}]`)
  );
  rules?.tool_sequence?.forEach((expression, index) =>
    check(expression, `tool_sequence[${index}]`)
  );
  rules?.tool_constraints?.forbidden_tools?.forEach((name, index) => {
    if (typeof name !== 'string' || name.includes('|') || !name.trim())
      throw new Error(
        `${context}: tool_constraints.forbidden_tools[${index}] must be one non-empty tool name.`
      );
  });
}
