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
