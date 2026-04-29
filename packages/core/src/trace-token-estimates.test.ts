import { describe, expect, it } from 'vitest';
import { enrichTraceMessagesWithEstimatedTokens } from './trace-token-estimates.js';
import type { TraceMessage } from './types.js';

describe('enrichTraceMessagesWithEstimatedTokens', () => {
  it('adds estimated_tokens on matching tool_use and tool_result blocks', () => {
    const messages: TraceMessage[] = [
      {
        role: 'assistant',
        ts: '2026-04-01T10:00:00.000Z',
        content: [
          {
            type: 'tool_use',
            id: 'u1',
            name: 'search_tags',
            input: { q: 'ALPHA' },
            server: 'mcplab'
          }
        ]
      },
      {
        role: 'tool',
        ts: '2026-04-01T10:00:01.000Z',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'u1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"hits":3}' }],
            is_error: false
          }
        ]
      }
    ];

    const enriched = enrichTraceMessagesWithEstimatedTokens(messages, 'gpt-4o-mini');
    const use = enriched[0]!.content[0];
    const result = enriched[1]!.content[0];
    if (use.type !== 'tool_use' || result.type !== 'tool_result') {
      throw new Error('Unexpected block types');
    }
    expect(use.estimated_tokens).toBeDefined();
    expect(result.estimated_tokens).toBeDefined();
    expect(use.estimated_tokens?.method).toBe('js_tiktoken_estimate');
    expect(result.estimated_tokens?.method).toBe('js_tiktoken_estimate');
    expect(use.estimated_tokens?.total).toBeGreaterThan(0);
    expect(result.estimated_tokens).toEqual(use.estimated_tokens);
  });

  it('uses fallback method for unknown model names', () => {
    const messages: TraceMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'u1',
            name: 'search_tags',
            input: { q: 'BETA' },
            server: 'mcplab'
          }
        ]
      }
    ];

    const enriched = enrichTraceMessagesWithEstimatedTokens(messages, 'anthropic-unknown-model');
    const use = enriched[0]!.content[0];
    if (use.type !== 'tool_use') throw new Error('Unexpected block type');
    expect(use.estimated_tokens?.method).toBe('js_tiktoken_fallback');
    expect(use.estimated_tokens?.total).toBeGreaterThan(0);
  });
});
