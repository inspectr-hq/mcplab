import { describe, expect, it } from 'vitest';
import { matchStructuredCheckResult } from './check-result-matching';
import type { CheckResult, EvalRule } from '@/types/eval';

describe('matchStructuredCheckResult', () => {
  it('does not match a stale sole candidate when assertion fields changed', () => {
    const rule: EvalRule = { type: 'tool_input_contains', tool: 'search', value: 'Paris' };
    const staleResult: CheckResult = {
      type: 'tool_input_contains',
      label: 'Tool input · search contains London',
      status: 'passed',
      metadata: { tool: 'search', value: 'London' }
    };

    expect(matchStructuredCheckResult(rule, [staleResult], () => String(rule.value ?? ''))).toBeUndefined();
  });
});
