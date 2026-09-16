import { describe, expect, it } from 'vitest';
import { createEmptyAgent } from './agent-factory';

describe('createEmptyAgent', () => {
  it('creates an LLM agent by default', () => {
    expect(createEmptyAgent()).toMatchObject({ type: 'llm', provider: 'openai', model: 'gpt-4o' });
  });

  it('creates a browser agent when requested', () => {
    expect(createEmptyAgent('browser')).toMatchObject({ type: 'browser', provider: 'claude', url: '' });
  });
});
