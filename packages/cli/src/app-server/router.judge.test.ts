import { describe, expect, it } from 'vitest';
import { resolveEvaluationJudge } from '@inspectr/mcplab-core';

describe('evaluation judge selection', () => {
  it('accepts an LLM agent whose type is omitted', () => {
    const agent = { provider: 'azure_openai' as const, model: 'DeepSeek-V4-Flash' };
    expect(
      resolveEvaluationJudge({ agents: { judge: agent }, evaluationJudgeAgentName: 'judge' })?.agent
    ).toEqual(agent);
  });

  it('rejects browser agents', () => {
    expect(() =>
      resolveEvaluationJudge({
        agents: {
          judge: { type: 'browser', provider: 'm365-cloud-microsoft', url: 'https://example.com' }
        },
        evaluationJudgeAgentName: 'judge'
      })
    ).toThrow('LLM');
  });
});
