import { describe, expect, it } from 'vitest';
import { buildCheckItems, formatEvalRuleLabel } from './check-presentation';
import type { EvalRule } from '@/types/eval';

describe('formatEvalRuleLabel', () => {
  it('formats agent checks consistently', () => {
    expect(
      formatEvalRuleLabel({
        type: 'agent_check',
        label: 'Logical range',
        prompt: 'Confirm a logical range exists.'
      })
    ).toBe('Agent check · Logical range');
  });
});

describe('buildCheckItems', () => {
  const evalRules: EvalRule[] = [
    {
      type: 'agent_check',
      label: 'Logical range',
      prompt: 'Confirm a logical range exists.'
    },
    { type: 'response_contains', value: 'ready' }
  ];

  it('prefers structured check results when present', () => {
    const result = buildCheckItems({
      evalRules,
      failureReasons: [],
      checkResults: [
        {
          type: 'agent_check',
          label: 'Logical range',
          status: 'failed',
          reason: 'No valid range present.'
        },
        {
          type: 'response_contains',
          label: 'Text contains · ready',
          status: 'passed'
        }
      ]
    });

    expect(result).toEqual([
      {
        rule: evalRules[0],
        status: 'failed',
        failureReason: 'No valid range present.'
      },
      {
        rule: evalRules[1],
        status: 'passed',
        failureReason: undefined
      }
    ]);
  });

  it('marks all checks not evaluated when run fails before evaluation', () => {
    const result = buildCheckItems({
      evalRules,
      failureReasons: ['Scenario error: boom'],
      runError: 'Scenario error: boom'
    });

    expect(result).toEqual([
      { rule: evalRules[0], status: 'not_evaluated', failureReason: undefined },
      { rule: evalRules[1], status: 'not_evaluated', failureReason: undefined }
    ]);
  });
});
