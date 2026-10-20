import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatToolAlternatives,
  normalizeToolExpression,
  parseToolAlternatives,
  validateEvalToolRules
} from './tool-rule-expressions.js';

describe('tool rule expressions', () => {
  it('schema patterns reject empty alternatives and forbidden expressions', () => {
    const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
    const schema = JSON.parse(readFileSync(resolve(root, 'config-schema.json'), 'utf8'));
    const scenario = schema.properties.scenarios.items.oneOf[1];
    const evalSchema = scenario.properties.eval;
    const constraints = evalSchema.properties.tool_constraints.properties;
    const required = new RegExp(constraints.required_tools.items.pattern);
    const forbidden = new RegExp(constraints.forbidden_tools.items.pattern);
    const sequence = new RegExp(evalSchema.properties.tool_sequence.items.pattern);
    for (const valid of ['search', 'search | lookup']) {
      expect(required.test(valid)).toBe(true);
      expect(sequence.test(valid)).toBe(true);
    }
    for (const invalid of [
      '',
      '   ',
      '|search',
      'search|',
      'search||lookup',
      'search|   |lookup'
    ]) {
      expect(required.test(invalid)).toBe(false);
      expect(sequence.test(invalid)).toBe(false);
    }
    expect(forbidden.test('delete')).toBe(true);
    expect(forbidden.test('delete|remove')).toBe(false);
  });
  it('parses and formats trimmed alternatives', () => {
    expect(parseToolAlternatives(' a | b ')).toEqual(['a', 'b']);
    expect(formatToolAlternatives(' a | b ')).toBe('a OR b');
  });
  it('rejects empty, duplicate, and alias-colliding alternatives', () => {
    expect(() => parseToolAlternatives('a||b')).toThrow();
    expect(() => parseToolAlternatives('a|a')).toThrow();
    expect(() =>
      normalizeToolExpression('x|y', (name) => (name === 'x' || name === 'y' ? 'z' : name))
    ).toThrow();
  });
  it('validates forbidden alternatives and warns on partial overlap', () => {
    expect(() =>
      validateEvalToolRules({ tool_constraints: { forbidden_tools: ['a'], required_tools: ['a'] } })
    ).toThrow();
    expect(
      validateEvalToolRules({
        tool_constraints: { forbidden_tools: ['a'], required_tools: ['a|b'] }
      })
    ).toHaveLength(1);
  });

  it('resolves aliases before checking forbidden contradictions', () => {
    expect(() =>
      validateEvalToolRules(
        {
          tool_constraints: { forbidden_tools: ['server:delete'], required_tools: ['delete'] }
        },
        'scenario',
        ['delete']
      )
    ).toThrow(/entirely forbidden/);
    expect(
      validateEvalToolRules(
        {
          tool_constraints: {
            forbidden_tools: ['server:delete'],
            required_tools: ['search|delete']
          }
        },
        'scenario',
        ['delete', 'search']
      )
    ).toHaveLength(1);
    expect(() =>
      validateEvalToolRules(
        {
          tool_constraints: { required_tools: ['server:lookup|lookup'] }
        },
        'scenario',
        ['lookup']
      )
    ).toThrow(/duplicate names/);
  });

  it('reports malformed runtime arrays with rule paths', () => {
    expect(() =>
      validateEvalToolRules({ tool_sequence: ['ok', 3] as unknown as string[] }, 'case')
    ).toThrow(/case: tool_sequence\[1\]/);
    expect(() =>
      validateEvalToolRules(
        { tool_constraints: { required_tools: 'bad' as unknown as string[] } },
        'case'
      )
    ).toThrow(/case: tool_constraints.required_tools must be an array/);
  });
});
