import { describe, expect, it } from 'vitest';
import { matchStructuredCheckResult } from './check-result-matching';
import type { CheckResult, EvalRule } from '@/types/eval';

describe('matchStructuredCheckResult', () => {
  it('matches sequence metadata structurally with canonical expressions', () => {
    const rule: EvalRule = { type: 'tool_sequence', sequence: ['search | lookup', 'search'] };
    const result: CheckResult = {
      type: 'tool_sequence',
      label: 'old label',
      status: 'passed',
      metadata: { expected: ['search|lookup', 'search'], matched_tools: ['lookup', 'search'] }
    };
    expect(matchStructuredCheckResult(rule, [result], () => 'new label')).toBe(result);
    expect(
      matchStructuredCheckResult(
        { ...rule, sequence: ['search', 'lookup|search'] },
        [result],
        () => 'new label'
      )
    ).toBeUndefined();
    expect(
      matchStructuredCheckResult(
        { ...rule, sequence: ['search|lookup|search'] },
        [result],
        () => 'new label'
      )
    ).toBeUndefined();
  });

  it('keeps old sequence labels readable without group metadata', () => {
    const rule: EvalRule = { type: 'tool_sequence', sequence: ['search | lookup', 'search'] };
    const result: CheckResult = {
      type: 'tool_sequence',
      label: 'Tool sequence · search | lookup -> search',
      status: 'failed'
    };
    expect(matchStructuredCheckResult(rule, [result], () => 'new label')).toBe(result);
  });

  it('does not match a stale sole candidate when assertion fields changed', () => {
    const rule: EvalRule = { type: 'tool_input_contains', tool: 'search', value: 'Paris' };
    const staleResult: CheckResult = {
      type: 'tool_input_contains',
      label: 'Tool input · search contains London',
      status: 'passed',
      metadata: { tool: 'search', value: 'London' }
    };

    expect(
      matchStructuredCheckResult(rule, [staleResult], () => String(rule.value ?? ''))
    ).toBeUndefined();
  });

  it('keeps JSONPath exists and equals results distinct', () => {
    const existsRule: EvalRule = {
      type: 'tool_input_jsonpath',
      tool: 'search',
      path: '$.query'
    };
    const equalsResult: CheckResult = {
      type: 'tool_input_jsonpath',
      label: 'Tool input · search JSONPath $.query == Paris',
      status: 'passed',
      metadata: { tool: 'search', path: '$.query', equals: 'Paris' }
    };

    expect(
      matchStructuredCheckResult(existsRule, [equalsResult], () => 'different label')
    ).toBeUndefined();
  });

  it('matches required tool alternatives by canonical metadata identity', () => {
    const rule: EvalRule = { type: 'required_tool', value: 'lookup | search' };
    const result: CheckResult = {
      type: 'required_tool',
      label: 'Required tool · old label',
      status: 'passed',
      metadata: { alternatives: ['lookup', 'search'] }
    };
    expect(matchStructuredCheckResult(rule, [result], () => 'legacy label')).toBe(result);
  });

  it('matches aliased expressions and supports legacy raw labels', () => {
    const rule: EvalRule = { type: 'required_tool', value: 'lookup|search' };
    const metadataResult: CheckResult = {
      type: 'required_tool',
      label: 'renamed label',
      status: 'passed',
      metadata: { expression: 'server:lookup|search', available_tool_names: ['lookup', 'search'] }
    };
    expect(matchStructuredCheckResult(rule, [metadataResult], () => 'new label')).toBe(
      metadataResult
    );

    const legacyResult: CheckResult = {
      type: 'required_tool',
      label: 'Required tool · lookup|search',
      status: 'passed'
    };
    expect(matchStructuredCheckResult(rule, [legacyResult], () => 'new label')).toBe(legacyResult);
  });

  it('does not match overlapping alternatives as the same rule', () => {
    const rule: EvalRule = { type: 'required_tool', value: 'lookup|search' };
    const result: CheckResult = {
      type: 'required_tool',
      label: 'different',
      status: 'passed',
      metadata: { expression: 'search|delete', matched_tools: ['search'] }
    };
    expect(matchStructuredCheckResult(rule, [result], () => 'new label')).toBeUndefined();
  });
});
