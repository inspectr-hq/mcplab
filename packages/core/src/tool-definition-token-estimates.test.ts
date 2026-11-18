import { describe, expect, it, vi } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { estimateToolDefinitionTokens } from './tool-definition-token-estimates.js';

vi.mock('js-tiktoken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-tiktoken')>();
  return { ...actual, getEncoding: vi.fn(actual.getEncoding) };
});

describe('estimateToolDefinitionTokens', () => {
  it('returns a per-tool estimate and a matching aggregate', () => {
    const result = estimateToolDefinitionTokens(
      [
        {
          name: 'search',
          title: 'Search',
          description: 'Find matching records.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema: { type: 'array' }
        },
        { name: 'health', description: 'Check service health.' }
      ],
      'gpt-4o-mini'
    );

    expect(result.toolCount).toBe(2);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]?.name).toBe('search');
    expect(result.tools.every((tool) => tool.total > 0)).toBe(true);
    expect(result.total).toBe(result.tools.reduce((total, tool) => total + tool.total, 0));
    expect(result.method).toBe('js_tiktoken_estimate');
  });

  it('reuses the fallback tokenizer across definitions and unknown models', () => {
    const tools = [{ name: 'health' }, { name: 'search' }];
    const result = estimateToolDefinitionTokens(tools, 'unknown-model');
    const repeated = estimateToolDefinitionTokens(tools, 'another-unknown-model');

    expect(result.method).toBe('js_tiktoken_fallback');
    expect(result.tools[0]?.total).toBeGreaterThan(0);
    expect(repeated).toEqual(result);
    expect(
      vi.mocked(getEncoding).mock.calls.filter(([encoding]) => encoding === 'cl100k_base')
    ).toHaveLength(1);
  });
});
