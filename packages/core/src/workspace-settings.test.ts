import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ResolveWorkspaceEvaluationParams, WorkspaceEvaluationSettings } from './types.js';
import { resolveWorkspaceEvaluation, toWorkspaceEvaluationSettings } from './workspace-settings.js';

const agents = {
  judge: { provider: 'openai' as const, model: 'judge-model' },
  browser: { type: 'browser' as const, provider: 'chatgpt', url: 'https://chatgpt.com' }
};
const semantic = {
  id: 'semantic',
  eval: { agent_assertions: [{ label: 'Correct', prompt: 'Correct?' }] }
};
const deterministic = {
  id: 'deterministic',
  eval: { response_assertions: [{ type: 'contains' as const, value: 'done' }] }
};
const decision = {
  provider: 'openai' as const,
  model: 'gpt-6-luna',
  passThreshold: 0.9,
  failThreshold: 0.1
};

describe('toWorkspaceEvaluationSettings', () => {
  it('converts persisted evaluation settings to the shared camelCase contract', () => {
    expect(
      toWorkspaceEvaluationSettings({
        evaluation_judge_agent_name: 'judge',
        evaluation_decision: decision,
        default_queue_workers: 2
      })
    ).toEqual({ evaluationJudgeAgentName: 'judge', evaluationDecision: decision });
  });
  it('preserves legacy judge-only settings and absent configuration', () => {
    expect(toWorkspaceEvaluationSettings({ evaluation_judge_agent_name: 'judge' })).toEqual({
      evaluationJudgeAgentName: 'judge',
      evaluationDecision: undefined
    });
    expect(toWorkspaceEvaluationSettings({})).toEqual({
      evaluationJudgeAgentName: undefined,
      evaluationDecision: undefined
    });
  });
  it('preserves malformed decisions for evaluator fallback', () => {
    const invalid = { ...decision, passThreshold: -1 };
    expect(toWorkspaceEvaluationSettings({ evaluation_decision: invalid }).evaluationDecision).toBe(
      invalid
    );
  });
});

describe('resolveWorkspaceEvaluation', () => {
  it('accepts the shared camelCase evaluation settings contract', () => {
    expectTypeOf<
      ResolveWorkspaceEvaluationParams['settings']
    >().toEqualTypeOf<WorkspaceEvaluationSettings>();
  });
  it.each(['deleted', 'browser'])('ignores a %s judge for deterministic-only scenarios', (name) => {
    expect(
      resolveWorkspaceEvaluation({
        agents,
        scenarios: [deterministic],
        settings: { evaluationJudgeAgentName: name, evaluationDecision: decision }
      })
    ).toEqual({});
  });
  it('only resolves the selected scenario rather than other scenarios in the config', () => {
    expect(
      resolveWorkspaceEvaluation({
        agents,
        scenarios: [semantic, deterministic],
        scenarioId: 'deterministic',
        settings: { evaluationJudgeAgentName: 'deleted', evaluationDecision: decision }
      })
    ).toEqual({});
  });
  it('resolves the configured judge and decision for semantic scenarios', () => {
    const expected = {
      evaluationJudge: { name: 'judge', agent: agents.judge },
      evaluationDecision: decision
    };
    expect(
      resolveWorkspaceEvaluation({
        agents,
        scenarios: [semantic],
        settings: { evaluationJudgeAgentName: 'judge', evaluationDecision: decision }
      })
    ).toEqual(expected);
  });
  it.each(['deleted', 'browser'])('rejects an invalid %s backup for semantic scenarios', (name) => {
    expect(() =>
      resolveWorkspaceEvaluation({
        agents,
        scenarios: [semantic],
        settings: { evaluationJudgeAgentName: name }
      })
    ).toThrow();
  });
  it('retains malformed decisions for runtime fallback without blocking semantic setup', () => {
    const invalid = { ...decision, passThreshold: -1 };
    expect(
      resolveWorkspaceEvaluation({
        agents,
        scenarios: [semantic],
        settings: { evaluationJudgeAgentName: 'judge', evaluationDecision: invalid }
      }).evaluationDecision
    ).toEqual(invalid);
  });
});
