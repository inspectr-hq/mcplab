import type { EstimatedTokens } from './types.js';
import { estimateTextTokens } from './trace-token-estimates.js';

export interface ToolDefinitionForTokenEstimate {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface ToolDefinitionTokenEstimate {
  name: string;
  total: number;
}

export interface ToolDefinitionTokenEstimates {
  toolCount: number;
  total: number;
  tools: ToolDefinitionTokenEstimate[];
  method: EstimatedTokens['method'];
}

function serializeToolDefinition(tool: ToolDefinitionForTokenEstimate): string {
  return JSON.stringify({
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {})
  });
}

export function estimateToolDefinitionTokens(
  tools: ToolDefinitionForTokenEstimate[],
  model: string
): ToolDefinitionTokenEstimates {
  const estimates = tools.map((tool) => {
    const estimate = estimateTextTokens(serializeToolDefinition(tool), model);
    return { name: tool.name, total: estimate.count, method: estimate.method };
  });
  return {
    toolCount: estimates.length,
    total: estimates.reduce((total, estimate) => total + estimate.total, 0),
    tools: estimates.map(({ name, total }) => ({ name, total })),
    method: estimates.some((estimate) => estimate.method === 'js_tiktoken_fallback')
      ? 'js_tiktoken_fallback'
      : 'js_tiktoken_estimate'
  };
}
