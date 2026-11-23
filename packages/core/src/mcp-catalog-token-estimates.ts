import type { McpCatalogDefinition, McpCatalogList, McpServerCatalog } from './mcp.js';
import { estimateTextTokens } from './trace-token-estimates.js';

export function withMcpCatalogTokenEstimates(
  catalog: McpServerCatalog,
  model: string
): McpServerCatalog {
  const count = <T extends object>(item: McpCatalogDefinition<T>): McpCatalogDefinition<T> => {
    const definition = { ...item };
    delete definition.estimatedTokens;
    return {
      ...definition,
      estimatedTokens: estimateTextTokens(JSON.stringify(definition), model).count
    };
  };
  const list = <T extends object>(
    section: McpCatalogList<McpCatalogDefinition<T>>
  ): McpCatalogList<McpCatalogDefinition<T>> =>
    'items' in section ? { ...section, items: section.items.map(count) } : section;
  const toolResources = catalog.toolResources;
  return {
    ...catalog,
    prompts: list(catalog.prompts),
    resources: list(catalog.resources),
    resourceTemplates: list(catalog.resourceTemplates),
    ...(toolResources?.status === 'ready'
      ? {
          toolResources: {
            ...toolResources,
            resources: toolResources.resources.map(count),
            resourceTemplates: toolResources.resourceTemplates.map(count)
          }
        }
      : {})
  };
}
