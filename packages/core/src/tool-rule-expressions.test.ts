import { describe, expect, it } from 'vitest';
import {
  formatToolExpression,
  isValidToolExpression,
  parseToolAlternatives,
  validateEvalToolRules
} from './tool-rule-expressions.js';

describe('tool rule expressions', () => {
  it('parses and formats trimmed alternatives', () => {
    expect(parseToolAlternatives(' search | lookup ')).toEqual(['search', 'lookup']);
    expect(formatToolExpression('search | lookup')).toBe('(search OR lookup)');
    expect(formatToolExpression('search')).toBe('search');
  });

  it('rejects empty and duplicate alternatives', () => {
    expect(isValidToolExpression('search|')).toBe(false);
    expect(isValidToolExpression('search|search')).toBe(false);
    expect(formatToolExpression('search|')).toBe('search|');
  });

  it('validates required tools, sequence steps and forbidden tools with rule paths', () => {
    expect(() =>
      validateEvalToolRules({ tool_constraints: { required_tools: ['a', 'b|'] } }, 'S')
    ).toThrow('S: tool_constraints.required_tools[1]');
    expect(() => validateEvalToolRules({ tool_sequence: ['a|a'] })).toThrow('tool_sequence[0]');
    expect(() => validateEvalToolRules({ tool_constraints: { forbidden_tools: ['a|b'] } })).toThrow(
      'forbidden_tools[0]'
    );
    expect(() => validateEvalToolRules({ tool_constraints: { forbidden_tools: [' '] } })).toThrow(
      'forbidden_tools[0]'
    );
    expect(() =>
      validateEvalToolRules({
        tool_constraints: { required_tools: ['a | b'], forbidden_tools: ['c'] },
        tool_sequence: ['a', 'b | c']
      })
    ).not.toThrow();
  });

  it.each([
    [
      { tool_constraints: { required_tools: 'search' } },
      'tool_constraints.required_tools must be an array'
    ],
    [{ tool_sequence: 'search' }, 'tool_sequence must be an array'],
    [
      { tool_constraints: { forbidden_tools: 'delete' } },
      'tool_constraints.forbidden_tools must be an array'
    ]
  ])('reports malformed tool rule collections with paths', (rules, message) => {
    expect(() => validateEvalToolRules(rules as never, 'Config')).toThrow(`Config: ${message}`);
  });
});
