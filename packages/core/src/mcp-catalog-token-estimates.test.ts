import { describe, expect, it } from 'vitest';
import { withMcpCatalogTokenEstimates } from './mcp-catalog-token-estimates.js';

describe('MCP catalog token estimates', () => {
  it('counts literal special-token text in prompt arguments and estimates URI templates', () => {
    const catalog = withMcpCatalogTokenEstimates(
      {
        resources: { status: 'unsupported' },
        resourceTemplates: {
          status: 'ready',
          items: [{ name: 'Page', uriTemplate: 'docs://pages/{id}' }]
        },
        prompts: {
          status: 'ready',
          items: [
            {
              name: 'Review',
              arguments: [{ name: 'topic', description: 'Text may include <|endoftext|>' }]
            }
          ]
        }
      },
      'unknown-model'
    );
    expect(catalog.resourceTemplates).toMatchObject({
      items: [{ estimatedTokens: expect.any(Number) }]
    });
    expect(catalog.prompts).toMatchObject({ items: [{ estimatedTokens: expect.any(Number) }] });
  });
});
