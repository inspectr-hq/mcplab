import { describe, expect, it } from 'vitest';
import type { AgentConfig, LlmAgentConfig } from '@/types/eval';
import { sortAgentsForDisplay } from './agent-display-order';

const agent = (id: string, provider: LlmAgentConfig['provider'], model = id): AgentConfig => ({
  id,
  name: id,
  provider,
  model,
  maxTokens: 100
});

describe('sortAgentsForDisplay', () => {
  it('groups providers and orders Claude tiers and model versions without mutating the source', () => {
    const agents = [
      agent('azure-deepseek-v4-flash', 'azure', 'DeepSeek-V4-Flash'),
      agent('claude-haiku-55', 'anthropic', 'claude-haiku-5-5'),
      agent('azure-gpt-6-luna', 'azure', 'gpt-6-luna'),
      agent('claude-sonnet-55', 'anthropic', 'claude-sonnet-5-5'),
      agent('azure-gpt-6.1-sol', 'azure', 'gpt-6.1-sol'),
      agent('claude-opus-5', 'anthropic', 'claude-opus-5-5')
    ];
    const original = [...agents];
    expect(sortAgentsForDisplay(agents).map(({ id }) => id)).toEqual([
      'claude-opus-5',
      'claude-sonnet-55',
      'claude-haiku-55',
      'azure-gpt-6.1-sol',
      'azure-gpt-6-luna',
      'azure-deepseek-v4-flash'
    ]);
    expect(agents).toEqual(original);
  });

  it('sorts versions naturally within a tier and uses the model rather than a custom label', () => {
    const older = { ...agent('newest-agent', 'anthropic', 'claude-sonnet-5-9'), name: 'Z Newest' };
    const newer = { ...agent('older-agent', 'anthropic', 'claude-sonnet-5-10'), name: 'A Older' };
    const gptOlder = agent('gpt-6.9', 'azure');
    const gptNewer = agent('gpt-6.10', 'azure');
    expect(sortAgentsForDisplay([older, gptOlder, newer, gptNewer]).map(({ id }) => id)).toEqual([
      'older-agent',
      'newest-agent',
      'gpt-6.10',
      'gpt-6.9'
    ]);
  });

  it('uses a stable alphabetical fallback for equal models and browser agents', () => {
    const beta = { ...agent('beta', 'custom', 'same-model'), name: 'Same' };
    const alpha = { ...beta, id: 'alpha' };
    const browser: AgentConfig = {
      id: 'browser',
      name: 'Browser',
      type: 'browser',
      provider: 'chatgpt-com',
      model: '',
      maxTokens: 100,
      url: 'https://chatgpt.com'
    };
    expect(sortAgentsForDisplay([beta, alpha, browser]).map(({ id }) => id)).toEqual([
      'browser',
      'alpha',
      'beta'
    ]);
  });
});
