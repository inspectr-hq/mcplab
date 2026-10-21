import { describe, expect, it } from 'vitest';
import {
  buildCheckItems,
  formatCheckStatusLabel,
  formatEvaluatorDetails,
  formatEvalRuleLabel,
  matchFailureReasonForRule
} from './check-presentation';
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

  it('formats tool sequences consistently', () => {
    expect(
      formatEvalRuleLabel({
        type: 'tool_sequence',
        sequence: ['search', 'fetch']
      })
    ).toBe('Tool sequence · search -> fetch');
  });

  it('formats tool input assertions consistently', () => {
    expect(
      formatEvalRuleLabel({
        type: 'tool_input_contains',
        tool: 'stats',
        value: 'MEAN'
      })
    ).toBe('Tool input · stats contains MEAN');
  });

  it('uses core formatting for tool input JSONPath assertions', () => {
    expect(
      formatEvalRuleLabel({
        type: 'tool_input_jsonpath',
        tool: 'stats',
        path: '$.city',
        equals: 'Paris'
      })
    ).toBe('Tool input · stats JSONPath $.city == Paris');
  });
});

describe('matchFailureReasonForRule tool failures', () => {
  it('matches core required-tool alternative reasons', () => {
    const rule: EvalRule = { type: 'required_tool', value: 'search | lookup' };
    expect(matchFailureReasonForRule(rule, ['Required tool not used: search OR lookup'])).toBe(
      'Required tool not used: search OR lookup'
    );
  });

  it('matches canonical tool sequence failure reasons', () => {
    const rule: EvalRule = { type: 'tool_sequence', sequence: ['search | lookup', 'fetch'] };
    expect(
      matchFailureReasonForRule(rule, [
        'Tool sequence order was not satisfied: (search OR lookup) -> fetch'
      ])
    ).toBe('Tool sequence order was not satisfied: (search OR lookup) -> fetch');
    expect(
      matchFailureReasonForRule(rule, [
        'Tool sequence order was not satisfied: (search OR lookup) -> fetch'
      ])
    ).toBe('Tool sequence order was not satisfied: (search OR lookup) -> fetch');
  });

  it('matches only missing-step failures for the sequence rule', () => {
    const rule: EvalRule = { type: 'tool_sequence', sequence: ['search', 'fetch'] };
    expect(matchFailureReasonForRule(rule, ['Required tool in sequence not used: fetch'])).toBe(
      'Required tool in sequence not used: fetch'
    );
    expect(
      matchFailureReasonForRule(rule, ['Required tool in sequence not used: unrelated'])
    ).toBeUndefined();
  });

  it('matches legacy missing-step failures through a server alias', () => {
    const rule: EvalRule = { type: 'tool_sequence', sequence: ['MCPLab:search', 'fetch'] };
    expect(
      matchFailureReasonForRule(rule, ['Required tool in sequence not used: search'])
    ).toBe('Required tool in sequence not used: search');
  });
});

describe('formatCheckStatusLabel', () => {
  it('uses human-readable labels for persisted check statuses', () => {
    expect(formatCheckStatusLabel('not_evaluated')).toBe('Not evaluated');
    expect(formatCheckStatusLabel('not_executed')).toBe('Not executed');
    expect(formatCheckStatusLabel('passed')).toBe('Passed');
    expect(formatCheckStatusLabel('failed')).toBe('Failed');
  });
});

describe('matchFailureReasonForRule', () => {
  it('does not match a response regex failure for a null value', () => {
    expect(
      matchFailureReasonForRule({ type: 'response_regex', value: null as never }, [
        'Regex assertion failed: null'
      ])
    ).toBeUndefined();
  });
});

describe('buildCheckItems', () => {
  it.each(['passed', 'failed'] as const)(
    'provides the saved assertion prompt for a decided %s check',
    (status) => {
      const reason = 'Satisfaction probability 0.95 met the pass threshold 0.9.';
      const result = buildCheckItems({
        evalRules: [{ type: 'agent_check', label: 'Test', prompt: 'Current edited assertion' }],
        failureReasons: status === 'failed' ? [reason] : [],
        checkResults: [
          {
            type: 'agent_check',
            label: 'Test',
            status,
            reason,
            metadata: {
              evaluator: 'decision',
              decision_provider: 'ollama',
              decision_prompt: 'Original assertion sent to the engine',
              decision_probability: 0.95
            }
          }
        ]
      });
      expect(result[0].decisionInput).toBe('Original assertion sent to the engine');
      expect(result[0].failureReason).toBe(reason);
      expect(result[0].decisionDetails).toContain('probability 0.950');
    }
  );
  it('uses the assertion from the scenario for older decision results without a saved prompt', () => {
    const result = buildCheckItems({
      evalRules: [{ type: 'agent_check', label: 'Test', prompt: 'Original assertion' }],
      failureReasons: [],
      checkResults: [
        {
          type: 'agent_check',
          label: 'Test',
          status: 'passed',
          reason: 'Satisfaction probability 0.95 met the pass threshold 0.9.',
          metadata: { evaluator: 'decision', decision_provider: 'ollama' }
        }
      ]
    });
    expect(result[0].decisionInput).toBe('Original assertion');
    expect(result[0].failureReason).toBe(
      'Satisfaction probability 0.95 met the pass threshold 0.9.'
    );
  });
  it('keeps the judge explanation for fallback results', () => {
    const result = buildCheckItems({
      evalRules: [{ type: 'agent_check', label: 'Test', prompt: 'Original assertion' }],
      failureReasons: [],
      checkResults: [
        {
          type: 'agent_check',
          label: 'Test',
          status: 'passed',
          reason: 'Judge explanation',
          metadata: {
            evaluator: 'judge',
            decision_provider: 'ollama',
            decision_prompt: 'Original assertion',
            decision_fallback: 'uncertain'
          }
        }
      ]
    });
    expect(result[0].decisionInput).toBeUndefined();
    expect(result[0].failureReason).toBe('Judge explanation');
  });
  const evalRules: EvalRule[] = [
    {
      type: 'agent_check',
      label: 'Logical range',
      prompt: 'Confirm a logical range exists.'
    },
    { type: 'response_contains', value: 'ready' }
  ];

  it('retains probability and judge fallback details for semantic checks', () => {
    const result = buildCheckItems({
      evalRules,
      failureReasons: [],
      checkResults: [
        {
          type: 'agent_check',
          label: 'Logical range',
          status: 'passed',
          metadata: {
            check_id: 'range',
            decision_provider: 'openai',
            decision_requested_model: 'gpt-6-luna',
            decision_model: 'gpt-6-luna-2026',
            decision_probability: 0.5,
            decision_pass_threshold: 0.9,
            decision_fail_threshold: 0.1,
            decision_duration_ms: 15,
            evaluator: 'judge',
            decision_fallback: 'uncertain',
            judge_provider: 'openai',
            judge_model: 'gpt-4o-mini'
          }
        }
      ]
    });
    expect(result[0].decisionDetails).toBe('Evaluated by LLM judge · OpenAI · gpt-4o-mini');
  });

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

  it('matches core tool-input result labels', () => {
    const rule: EvalRule = { type: 'tool_input_contains', tool: 'stats', value: 'MEAN' };
    const result = buildCheckItems({
      evalRules: [rule],
      failureReasons: [],
      checkResults: [
        {
          type: 'tool_input_contains',
          label: 'Tool input · stats contains MEAN',
          status: 'passed'
        }
      ]
    });

    expect(result[0]).toMatchObject({ rule, status: 'passed' });
  });

  it('does not match legacy tool-input results without assertion metadata', () => {
    const rule: EvalRule = { type: 'tool_input_contains', tool: 'stats', value: 'MEAN' };
    const result = buildCheckItems({
      evalRules: [rule],
      failureReasons: [],
      checkResults: [
        {
          type: 'tool_input_contains',
          label: 'Tool input · stats · contains MEAN',
          status: 'passed',
          metadata: { tool: 'stats' }
        }
      ]
    });

    expect(result[0]).toMatchObject({ rule, status: 'not_executed' });
  });

  it('marks all checks not executed when run fails before evaluation', () => {
    const result = buildCheckItems({
      evalRules,
      failureReasons: ['Scenario error: boom'],
      runError: 'Scenario error: boom'
    });

    expect(result).toEqual([
      { rule: evalRules[0], status: 'not_executed', failureReason: undefined },
      { rule: evalRules[1], status: 'not_executed', failureReason: undefined }
    ]);
  });

  it.each([
    { type: 'tool_input_contains' as const, value: 'Paris' },
    { type: 'tool_input_regex' as const, value: 'Par.*' },
    { type: 'tool_input_jsonpath' as const, path: '$.city', equals: 'Paris' }
  ])('maps $type tool-input failures when structured results are absent', (input) => {
    const rule: EvalRule = { tool: 'search', ...input };
    const result = buildCheckItems({
      evalRules: [rule],
      failureReasons: [
        `Tool input assertion failed: search input did not match (expected: ${
          input.type === 'tool_input_contains'
            ? `contains ${input.value}`
            : input.type === 'tool_input_regex'
              ? `regex ${input.value}`
              : `JSONPath ${input.path} == ${String(input.equals)}`
        })`
      ]
    });

    expect(result[0]).toMatchObject({
      rule,
      status: 'failed',
      failureReason: expect.stringContaining(
        'Tool input assertion failed: search input did not match'
      )
    });
  });

  it('attributes same-tool fallback failures to the matching contains value', () => {
    const result = buildCheckItems({
      evalRules: [
        { type: 'tool_input_contains', tool: 'search', value: 'Paris' },
        { type: 'tool_input_contains', tool: 'search', value: 'London' }
      ],
      failureReasons: [
        'Tool input assertion failed: search input did not match (expected: contains London)'
      ]
    });

    expect(result.map((item) => item.status)).toEqual(['passed', 'failed']);
  });

  it('matches tool-not-used failures without tool-name substring collisions', () => {
    const result = buildCheckItems({
      evalRules: [
        { type: 'tool_input_contains', tool: 'search', value: 'Paris' },
        { type: 'tool_input_contains', tool: 'search_extended', value: 'Paris' }
      ],
      failureReasons: ['Tool input assertion failed: tool not used: search_extended']
    });

    expect(result.map((item) => item.status)).toEqual(['passed', 'failed']);
  });
});

describe('formatEvaluatorDetails', () => {
  it('preserves historical checks without decision metadata', () => {
    expect(formatEvaluatorDetails(undefined)).toBeUndefined();
    expect(formatEvaluatorDetails({ check_id: 'old' })).toBeUndefined();
  });

  it('includes zero probability without rendering malformed probabilities', () => {
    expect(
      formatEvaluatorDetails({
        evaluator: 'decision',
        decision_provider: 'ollama',
        decision_probability: 0
      })
    ).toContain('probability 0.000');
    expect(
      formatEvaluatorDetails({
        evaluator: 'decision',
        decision_provider: 'ollama',
        decision_probability: NaN
      })
    ).not.toContain('NaN');
  });

  it('shows the configured deployment name without a redundant requested model label', () => {
    expect(
      formatEvaluatorDetails({
        evaluator: 'decision',
        decision_provider: 'azure_foundry',
        decision_model: 'microsoft-decision-1',
        decision_requested_model: 'Jev-Decision-1'
      })
    ).toBe('Decision Engine · azure_foundry · Jev-Decision-1');
  });

  it('shows the Evaluation Judge provider and model for direct judge results', () => {
    expect(
      formatEvaluatorDetails({
        judge_agent: 'quality-judge',
        judge_provider: 'openai',
        judge_model: 'gpt-4o-mini'
      })
    ).toBe('Evaluation Judge · OpenAI · gpt-4o-mini');
  });
});
