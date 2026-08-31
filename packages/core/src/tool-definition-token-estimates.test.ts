import { describe, expect, it } from 'vitest';
import { estimateToolDefinitionTokens } from './tool-definition-token-estimates.js';

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

  it('uses the fallback tokenizer for unknown models', () => {
    const result = estimateToolDefinitionTokens([{ name: 'health' }], 'unknown-model');

    expect(result.method).toBe('js_tiktoken_fallback');
    expect(result.tools[0]?.total).toBeGreaterThan(0);
  });
});
