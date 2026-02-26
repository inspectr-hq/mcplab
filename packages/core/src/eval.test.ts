import { describe, it, expect } from 'vitest';
import { evaluateScenario, extractValues } from './eval.js';

describe('evaluateScenario — no rules', () => {
  it('passes when there are no eval rules', () => {
    const result = evaluateScenario('some response', ['tool1']);
    expect(result.pass).toBe(true);
    expect(result.failures).toHaveLength(0);
  });
});

describe('evaluateScenario — tool_constraints', () => {
  it('passes when required tool is used', () => {
    const result = evaluateScenario('response', ['search', 'fetch'], {
      tool_constraints: { required_tools: ['search'] },
    });
    expect(result.pass).toBe(true);
  });

  it('fails when required tool is missing', () => {
    const result = evaluateScenario('response', ['fetch'], {
      tool_constraints: { required_tools: ['search'] },
    });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('Required tool not used: search');
  });

  it('fails when a forbidden tool is used', () => {
    const result = evaluateScenario('response', ['delete', 'fetch'], {
      tool_constraints: { forbidden_tools: ['delete'] },
    });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('Forbidden tool used: delete');
  });

  it('passes when a forbidden tool is not used', () => {
    const result = evaluateScenario('response', ['fetch'], {
      tool_constraints: { forbidden_tools: ['delete'] },
    });
    expect(result.pass).toBe(true);
  });

  it('reports one failure per missing required tool', () => {
    const result = evaluateScenario('response', [], {
      tool_constraints: { required_tools: ['search', 'fetch', 'store'] },
    });
    expect(result.failures).toHaveLength(3);
  });

  it('deduplicates repeated tools — forbidden check fires only once', () => {
    const result = evaluateScenario('response', ['search', 'search', 'search'], {
      tool_constraints: { forbidden_tools: ['search'] },
    });
    expect(result.failures).toHaveLength(1);
  });
});

describe('evaluateScenario — tool_sequence', () => {
  it('passes when sequence matches an allowed sequence', () => {
    const result = evaluateScenario('response', ['search', 'fetch'], {
      tool_sequence: { allow: [['search', 'fetch'], ['fetch']] },
    });
    expect(result.pass).toBe(true);
  });

  it('fails when sequence matches none of the allowed sequences', () => {
    const result = evaluateScenario('response', ['fetch', 'search'], {
      tool_sequence: { allow: [['search', 'fetch']] },
    });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('Tool sequence did not match any allowed sequence');
  });

  it('passes when empty sequence is explicitly allowed', () => {
    const result = evaluateScenario('response', [], {
      tool_sequence: { allow: [[]] },
    });
    expect(result.pass).toBe(true);
  });

  it('skips sequence check when allow list is empty', () => {
    const result = evaluateScenario('response', ['search', 'fetch'], {
      tool_sequence: { allow: [] },
    });
    expect(result.pass).toBe(true);
  });
});

describe('evaluateScenario — response_assertions regex', () => {
  it('passes when response matches the pattern', () => {
    const result = evaluateScenario('The price is $42.00', [], {
      response_assertions: [{ type: 'regex', pattern: '\\$\\d+\\.\\d+' }],
    });
    expect(result.pass).toBe(true);
  });

  it('fails when response does not match the pattern', () => {
    const result = evaluateScenario('No price here', [], {
      response_assertions: [{ type: 'regex', pattern: '\\$\\d+\\.\\d+' }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatch(/Regex assertion failed/);
  });

  it('is case-insensitive by default', () => {
    const result = evaluateScenario('HELLO WORLD', [], {
      response_assertions: [{ type: 'regex', pattern: 'hello world' }],
    });
    expect(result.pass).toBe(true);
  });

  it('fails gracefully with "Invalid regex" for a broken pattern', () => {
    const result = evaluateScenario('response', [], {
      response_assertions: [{ type: 'regex', pattern: '[invalid(' }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatch(/Invalid regex/);
  });
});

describe('evaluateScenario — response_assertions jsonpath', () => {
  it('passes when the path matches a value', () => {
    const result = evaluateScenario('{"name": "Alice"}', [], {
      response_assertions: [{ type: 'jsonpath', path: '$.name' }],
    });
    expect(result.pass).toBe(true);
  });

  it('fails when the path matches nothing', () => {
    const result = evaluateScenario('{"name": "Alice"}', [], {
      response_assertions: [{ type: 'jsonpath', path: '$.missing' }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatch(/JSONPath assertion failed/);
  });

  it('fails with "invalid JSON" when response is not JSON', () => {
    const result = evaluateScenario('not json', [], {
      response_assertions: [{ type: 'jsonpath', path: '$.name' }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatch(/invalid JSON/);
  });

  it('passes when equals assertion matches', () => {
    const result = evaluateScenario('{"status": "active"}', [], {
      response_assertions: [{ type: 'jsonpath', path: '$.status', equals: 'active' }],
    });
    expect(result.pass).toBe(true);
  });

  it('fails when equals assertion does not match', () => {
    const result = evaluateScenario('{"status": "inactive"}', [], {
      response_assertions: [{ type: 'jsonpath', path: '$.status', equals: 'active' }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatch(/JSONPath equals assertion failed/);
  });
});

describe('extractValues', () => {
  it('returns empty object when no rules are given', () => {
    expect(extractValues('some text')).toEqual({});
  });

  it('coerces a numeric capture group to a number', () => {
    const result = extractValues('price is 42 dollars', [
      { name: 'price', regex: 'price is (\\d+)' },
    ]);
    expect(result.price).toBe(42);
  });

  it('keeps a non-numeric capture group as a string', () => {
    const result = extractValues('status: active', [
      { name: 'status', regex: 'status: (\\w+)' },
    ]);
    expect(result.status).toBe('active');
  });

  it('coerces "true" to boolean true', () => {
    const result = extractValues('flag: true', [
      { name: 'flag', regex: 'flag: (true|false)' },
    ]);
    expect(result.flag).toBe(true);
  });

  it('coerces "false" to boolean false', () => {
    const result = extractValues('enabled: false', [
      { name: 'enabled', regex: 'enabled: (true|false)' },
    ]);
    expect(result.enabled).toBe(false);
  });

  it('returns null when the pattern does not match', () => {
    const result = extractValues('no match here', [
      { name: 'price', regex: 'price: (\\d+)' },
    ]);
    expect(result.price).toBeNull();
  });

  it('returns null for an invalid regex', () => {
    const result = extractValues('some text', [{ name: 'bad', regex: '[invalid(' }]);
    expect(result.bad).toBeNull();
  });

  it('prefers the named capture group "value" over positional', () => {
    const result = extractValues('result=99', [
      { name: 'num', regex: 'result=(?<value>\\d+)' },
    ]);
    expect(result.num).toBe(99);
  });

  it('handles multiple rules independently', () => {
    const text = 'count: 5, status: done';
    const result = extractValues(text, [
      { name: 'count', regex: 'count: (\\d+)' },
      { name: 'status', regex: 'status: (\\w+)' },
    ]);
    expect(result.count).toBe(5);
    expect(result.status).toBe('done');
  });
});
