import { describe, expect, it } from 'vitest';
import { resolveWorkspaceEvaluation } from './workspace-settings.js';

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

describe('resolveWorkspaceEvaluation', () => {
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
        settings: { evaluation_judge_agent_name: 'deleted', evaluation_decision: decision }
      })
    ).toEqual({});
  });
  it('resolves app settings and persisted YAML settings to the same evaluation options', () => {
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
    expect(
      resolveWorkspaceEvaluation({
        agents,
        scenarios: [semantic],
        settings: { evaluation_judge_agent_name: 'judge', evaluation_decision: decision }
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
