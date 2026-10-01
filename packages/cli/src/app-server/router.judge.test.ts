import { describe, expect, it } from 'vitest';
import { isEvaluationJudgeAgent } from './router.js';

describe('evaluation judge selection', () => {
  it('accepts an LLM agent whose type is omitted', () => {
    expect(
      isEvaluationJudgeAgent({ provider: 'azure_openai', model: 'DeepSeek-V4-Flash' } as any)
    ).toBe(true);
  });

  it('rejects browser agents', () => {
    expect(
      isEvaluationJudgeAgent({ type: 'browser', provider: 'm365-cloud-microsoft' } as any)
    ).toBe(false);
  });
});
