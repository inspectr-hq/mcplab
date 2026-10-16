import { expect, it, vi } from 'vitest';

const { chatWithAgentMock } = vi.hoisted(() => ({ chatWithAgentMock: vi.fn() }));
vi.mock('@inspectr/mcplab-core', async () => ({
  ...(await vi.importActual<typeof import('@inspectr/mcplab-core')>('@inspectr/mcplab-core')),
  chatWithAgent: chatWithAgentMock
}));

import { chatWithJsonRetry, parseJsonFromAssistantText } from './one-shot-json.js';

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

it.each([
  'Use button[aria-label="Stop"]. Proposal: {"ok":true}',
  'Notes {not JSON}, then [also not JSON]. {"ok":true}',
  '```text\nbutton[aria-label="Stop"]\n```\n```json\n{"ok":true}\n```',
  '```json\n{invalid}\n```\nActual proposal: {"ok":true}'
])('skips invalid candidates before a valid proposal: %s', (text) => {
  expect(parseJsonFromAssistantText(text)).toEqual({ ok: true });
});

it('retains arrays and escaped delimiters in valid JSON', () => {
  expect(
    parseJsonFromAssistantText('Answer: [{"selector":"button[aria-label=\\"Stop\\"]"}]')
  ).toEqual([{ selector: 'button[aria-label="Stop"]' }]);
});

it('rejects a response with no valid JSON candidate', () => {
  expect(() => parseJsonFromAssistantText('button[aria-label="Stop"] {invalid}')).toThrow(
    'Assistant returned invalid JSON'
  );
});
