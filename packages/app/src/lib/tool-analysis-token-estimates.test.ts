import { describe, expect, it } from 'vitest';
import { selectedToolContextTokens } from './tool-analysis-token-estimates';

describe('selectedToolContextTokens', () => {
  it('sums estimates for selected tools only', () => {
    expect(
      selectedToolContextTokens(
        [
          {
            serverName: 'demo',
            warnings: [],
            tokenEstimate: {
              toolCount: 2,
              total: 30,
              tools: [
                { name: 'search', total: 20 },
                { name: 'health', total: 10 }
              ],
              method: 'js_tiktoken_fallback'
            },
            tools: []
          }
        ],
        { demo: ['search'] }
      )
    ).toBe(20);
  });

  it('returns undefined for legacy discovery data without estimates', () => {
    expect(
      selectedToolContextTokens([{ serverName: 'demo', warnings: [], tools: [] }], { demo: [] })
    ).toBeUndefined();
  });
});
