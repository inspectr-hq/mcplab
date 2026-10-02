import { expect, it, vi } from 'vitest';

const { chatWithAgentMock } = vi.hoisted(() => ({ chatWithAgentMock: vi.fn() }));
vi.mock('@inspectr/mcplab-core', async () => ({
  ...(await vi.importActual<typeof import('@inspectr/mcplab-core')>('@inspectr/mcplab-core')),
  chatWithAgent: chatWithAgentMock
}));

import { chatWithJsonRetry } from './assistant-common.js';

it('uses the caller response schema when retrying invalid JSON', async () => {
  chatWithAgentMock
    .mockResolvedValueOnce({ content: 'invalid' })
    .mockResolvedValueOnce({ content: '{"profile":{}}' });
  const retryPrompt = 'Return one JSON object with profile, rationale, and warnings.';
  const result = await chatWithJsonRetry({
    agent: { type: 'llm', provider: 'openai', model: 'test' } as never,
    messages: [],
    tools: [],
    system: 'Review a provider.',
    parse: JSON.parse,
    toolCallFallbackText: () => '',
    invalidJsonRetryPrompt: retryPrompt
  });
  expect(result).toEqual({ profile: {} });
  expect(chatWithAgentMock.mock.calls[1][0].messages.at(-1)).toEqual({
    role: 'user',
    content: retryPrompt
  });
});
