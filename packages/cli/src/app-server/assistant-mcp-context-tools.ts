import type { McpClientManager } from '@inspectr/mcplab-core';
import {
  ASSISTANT_TOOL_TIMEOUT_MESSAGE,
  ASSISTANT_TOOL_TIMEOUT_MS,
  withTimeout
} from './assistant-common.js';
import type { AssistantRuntimeTool } from './assistant-runtime-contract.js';

export const MCP_CONTEXT_TOOL_NAMES = [
  'list_mcp_resources',
  'read_mcp_resource',
  'list_mcp_prompts',
  'get_mcp_prompt'
] as const;

const MAX_LISTED_ITEMS = 200;
const READ_ONLY = { readOnly: true };

export interface McpContextServers {
  /** Selected servers that advertise MCP resources. */
  resources: string[];
  /** Selected servers that advertise MCP prompts. */
  prompts: string[];
}

/**
 * Read-only tools that let an assistant use the server's own resources (documents, schemas)
 * and prompt templates as context. Only features a server advertises are offered.
 */
export function createMcpContextTools(
  mcp: McpClientManager,
  servers: McpContextServers
): AssistantRuntimeTool[] {
  const tools: AssistantRuntimeTool[] = [];
  const serverField = (names: string[]) => ({
    type: 'string',
    enum: names,
    description: 'MCP server name'
  });
  const pick = (requested: unknown, available: string[]) => {
    if (requested === undefined) return available;
    if (typeof requested === 'string' && available.includes(requested)) return [requested];
    throw new Error(
      `Unknown server '${String(requested)}'. Choose one of: ${available.join(', ')}`
    );
  };

  if (servers.resources.length) {
    tools.push(
      {
        name: 'list_mcp_resources',
        server: 'mcp',
        tool: 'list_mcp_resources',
        display: { title: 'List MCP resources', hints: READ_ONLY },
        description:
          'List the resources (documents, schemas, reference data) the selected MCP servers expose. Read relevant ones before proposing scenario changes.',
        inputSchema: {
          type: 'object',
          properties: { server: serverField(servers.resources) },
          additionalProperties: false
        },
        execute: async (args, signal) => {
          const listed = [];
          for (const server of pick(argument(args, 'server'), servers.resources))
            for (const resource of await mcp.listResources(server, signal))
              listed.push({ server, ...resource });
          return { resources: listed.slice(0, MAX_LISTED_ITEMS), total: listed.length };
        }
      },
      {
        name: 'read_mcp_resource',
        server: 'mcp',
        tool: 'read_mcp_resource',
        display: { title: 'Read MCP resource', hints: READ_ONLY },
        description:
          'Read one MCP resource by URI. Binary content is reported by type and size only.',
        inputSchema: {
          type: 'object',
          properties: { server: serverField(servers.resources), uri: { type: 'string' } },
          required: ['server', 'uri'],
          additionalProperties: false
        },
        execute: async (args, signal) => {
          const [server] = pick(argument(args, 'server'), servers.resources);
          const uri = argument(args, 'uri');
          if (typeof uri !== 'string' || !uri) throw new Error('uri is required');
          return { server, contents: await mcp.readResource(server!, uri, signal) };
        }
      }
    );
  }

  if (servers.prompts.length) {
    tools.push(
      {
        name: 'list_mcp_prompts',
        server: 'mcp',
        tool: 'list_mcp_prompts',
        display: { title: 'List MCP prompts', hints: READ_ONLY },
        description:
          'List the prompt templates the selected MCP servers provide. They show how the server expects to be used.',
        inputSchema: {
          type: 'object',
          properties: { server: serverField(servers.prompts) },
          additionalProperties: false
        },
        execute: async (args, signal) => {
          const listed = [];
          for (const server of pick(argument(args, 'server'), servers.prompts))
            for (const prompt of await mcp.listPrompts(server, signal))
              listed.push({ server, ...prompt });
          return { prompts: listed.slice(0, MAX_LISTED_ITEMS), total: listed.length };
        }
      },
      {
        name: 'get_mcp_prompt',
        server: 'mcp',
        tool: 'get_mcp_prompt',
        display: { title: 'Get MCP prompt', hints: READ_ONLY },
        description: 'Get one MCP prompt template, filled in with the given arguments.',
        inputSchema: {
          type: 'object',
          properties: {
            server: serverField(servers.prompts),
            name: { type: 'string' },
            arguments: { type: 'object', additionalProperties: { type: 'string' } }
          },
          required: ['server', 'name'],
          additionalProperties: false
        },
        execute: async (args, signal) => {
          const [server] = pick(argument(args, 'server'), servers.prompts);
          const name = argument(args, 'name');
          if (typeof name !== 'string' || !name) throw new Error('name is required');
          const promptArgs = argument(args, 'arguments');
          return {
            server,
            ...(await mcp.getPrompt(
              server!,
              name,
              promptArgs && typeof promptArgs === 'object'
                ? (promptArgs as Record<string, string>)
                : undefined,
              signal
            ))
          };
        }
      }
    );
  }
  return tools.map((tool) => ({
    ...tool,
    execute: (args, signal) => withToolTimeout(signal, (bounded) => tool.execute(args, bounded))
  }));
}

/** Prompt guidance for the context tools that are actually available. */
export function mcpContextToolGuidance(servers: McpContextServers): string[] {
  const lines: string[] = [];
  if (servers.resources.length)
    lines.push(
      `MCP resources are available from: ${servers.resources.join(', ')}. Use list_mcp_resources and read_mcp_resource to read the server's own documentation, schemas or reference data before proposing prompts, Checks or Value Capture Rules.`
    );
  if (servers.prompts.length)
    lines.push(
      `MCP prompt templates are available from: ${servers.prompts.join(', ')}. Use list_mcp_prompts and get_mcp_prompt to see how the server expects to be used; they are good starting points for scenario prompts.`
    );
  return lines;
}

/**
 * One limit covers the whole call, across every page and server, like other assistant tools.
 * On timeout or completion the MCP requests still in flight are aborted, not left running.
 */
async function withToolTimeout<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const stop = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  try {
    return await withTimeout(
      () => run(requestSignal),
      ASSISTANT_TOOL_TIMEOUT_MS,
      ASSISTANT_TOOL_TIMEOUT_MESSAGE,
      signal
    );
  } finally {
    stop.abort();
  }
}

function argument(args: unknown, key: string): unknown {
  return args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
}
