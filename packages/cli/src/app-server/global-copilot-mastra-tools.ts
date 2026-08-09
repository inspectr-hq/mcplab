import {
  McpClientManager,
  type ServerConfig,
  type ToolDef
} from '@inspectr/mcplab-core';
import { createTool } from '@mastra/core/tools';
import { jsonSchema } from '@mastra/schema-compat';
import { z } from 'zod';
import { makeAssistantToolPublicName, truncateJson } from './assistant-common.js';
import {
  globalCopilotExternalServers,
  globalCopilotMcplabToolPolicy,
  globalCopilotMcpToolErrorMessage,
  globalCopilotMcpToolPayload,
  localMcplabMcpUrl
} from './global-copilot-domain.js';
import { readLibraries } from './libraries-store.js';
import type { AppSettings } from './types.js';

export type GlobalCopilotReadBudget = {
  used: number;
  batchSize: number;
};

type GlobalCopilotApprovalMode = 'automatic' | 'confirmation';

export type GlobalCopilotMcpManager = Pick<
  McpClientManager,
  'connectAll' | 'listTools' | 'callTool' | 'disconnectAll'
>;

export class GlobalCopilotMcpConnectionPool {
  private readonly manager: GlobalCopilotMcpManager;
  private readonly connected = new Map<string, string>();

  constructor(manager: GlobalCopilotMcpManager = new McpClientManager()) {
    this.manager = manager;
  }

  private configKey(server: ServerConfig): string {
    return JSON.stringify(server);
  }

  async ensureConnected(serverName: string, server: ServerConfig): Promise<void> {
    const key = this.configKey(server);
    if (this.connected.get(serverName) === key) return;
    await this.manager.connectAll({ [serverName]: server });
    this.connected.set(serverName, key);
  }

  async listTools(serverName: string, server: ServerConfig): Promise<ToolDef[]> {
    await this.ensureConnected(serverName, server);
    return this.manager.listTools(serverName);
  }

  async callTool(
    serverName: string,
    server: ServerConfig,
    toolName: string,
    arguments_: Record<string, unknown>
  ): Promise<unknown> {
    await this.ensureConnected(serverName, server);
    return this.manager.callTool(serverName, toolName, arguments_);
  }

  async close(): Promise<void> {
    this.connected.clear();
    await this.manager.disconnectAll().catch(() => undefined);
  }
}

const approvalResumeSchema = z
  .object({ approved: z.boolean() })
  .strict();

const approvalSuspendSchema = z
  .object({
    kind: z.enum(['continue_reading', 'mcp_tool_approval']),
    serverName: z.string(),
    toolName: z.string(),
    arguments: z.record(z.unknown()),
    batchSize: z.number().int().positive().optional()
  })
  .strict();

export function createGlobalCopilotMcpTool(params: {
  definition: ToolDef;
  serverName: string;
  toolName: string;
  approval: GlobalCopilotApprovalMode;
  budget: GlobalCopilotReadBudget;
  execute: (arguments_: Record<string, unknown>) => Promise<unknown>;
}) {
  return createTool({
    id: params.definition.name,
    description: params.definition.description ?? '',
    inputSchema: jsonSchema<Record<string, unknown>>(params.definition.inputSchema as any),
    suspendSchema: approvalSuspendSchema,
    resumeSchema: approvalResumeSchema,
    execute: async (arguments_, context) => {
      const resumeData = context?.agent?.resumeData;
      if (resumeData && !resumeData.approved) {
        return { approved: false, reason: 'Denied by user.' };
      }

      const readBudgetExhausted =
        params.approval === 'automatic' && params.budget.used >= params.budget.batchSize;
      const needsApproval = params.approval === 'confirmation' || readBudgetExhausted;
      if (needsApproval && !resumeData) {
        await context?.agent?.suspend({
          kind: readBudgetExhausted ? 'continue_reading' : 'mcp_tool_approval',
          serverName: params.serverName,
          toolName: params.toolName,
          arguments: arguments_ ?? {},
          ...(readBudgetExhausted ? { batchSize: params.budget.batchSize } : {})
        });
        return { suspended: true };
      }

      if (params.approval === 'automatic') {
        if (readBudgetExhausted) params.budget.used = 0;
        params.budget.used += 1;
      }
      return params.execute(arguments_ ?? {});
    }
  });
}

async function discoverServerTools(
  serverName: string,
  server: ServerConfig,
  pool?: GlobalCopilotMcpConnectionPool
): Promise<ToolDef[]> {
  if (pool) return pool.listTools(serverName, server);
  const mcp = new McpClientManager();
  try {
    await mcp.connectAll({ [serverName]: server });
    return await mcp.listTools(serverName);
  } finally {
    await mcp.disconnectAll().catch(() => undefined);
  }
}

async function executeRevalidatedMcpTool(params: {
  serverName: string;
  server: ServerConfig;
  toolName: string;
  arguments_: Record<string, unknown>;
  pool?: GlobalCopilotMcpConnectionPool;
}): Promise<unknown> {
  if (params.pool) {
    const known = (await params.pool.listTools(params.serverName, params.server)).some(
      (tool) => tool.name === params.toolName
    );
    if (!known) throw new Error(`MCP tool '${params.toolName}' is no longer available.`);
    const result = await params.pool.callTool(
      params.serverName,
      params.server,
      params.toolName,
      params.arguments_
    );
    const toolError = globalCopilotMcpToolErrorMessage(result);
    if (toolError) throw new Error(toolError);
    return truncateJson(globalCopilotMcpToolPayload(result), 4000);
  }
  const mcp = new McpClientManager();
  try {
    await mcp.connectAll({ [params.serverName]: params.server });
    const known = (await mcp.listTools(params.serverName)).some(
      (tool) => tool.name === params.toolName
    );
    if (!known) throw new Error(`MCP tool '${params.toolName}' is no longer available.`);
    const result = await mcp.callTool(params.serverName, params.toolName, params.arguments_);
    const toolError = globalCopilotMcpToolErrorMessage(result);
    if (toolError) throw new Error(toolError);
    return truncateJson(globalCopilotMcpToolPayload(result), 4000);
  } finally {
    await mcp.disconnectAll().catch(() => undefined);
  }
}

export async function buildGlobalCopilotMastraTools(params: {
  settings: AppSettings;
  context: any;
  budget?: GlobalCopilotReadBudget;
  pool?: GlobalCopilotMcpConnectionPool;
}): Promise<Record<string, ReturnType<typeof createGlobalCopilotMcpTool>>> {
  const libraries = readLibraries(params.settings.librariesDir);
  const activeTestCaseId =
    typeof params.context?.activeTestCaseId === 'string'
      ? params.context.activeTestCaseId
      : undefined;
  const scenarioEditor = params.context?.scenarioEditor;
  const servers: Record<string, ServerConfig> = {
    mcplab: { transport: 'http', url: localMcplabMcpUrl() },
    ...globalCopilotExternalServers(libraries, activeTestCaseId, scenarioEditor)
  };
  const usedNames = new Set<string>();
  const budget = params.budget ?? { used: 0, batchSize: 5 };
  const tools: Record<string, ReturnType<typeof createGlobalCopilotMcpTool>> = {};

  for (const [serverName, server] of Object.entries(servers)) {
    let definitions: ToolDef[];
    try {
      definitions = await discoverServerTools(serverName, server, params.pool);
    } catch {
      continue;
    }
    for (const definition of definitions) {
      const policy =
        serverName === 'mcplab'
          ? globalCopilotMcplabToolPolicy(definition.name, {
              scenarioEditor: Boolean(scenarioEditor)
            })
          : { expose: true, automatic: false };
      if (!policy.expose) continue;
      const publicName = makeAssistantToolPublicName(serverName, definition.name, usedNames);
      tools[publicName] = createGlobalCopilotMcpTool({
        definition: {
          ...definition,
          name: publicName,
          ...(serverName === 'mcplab'
            ? {}
            : {
                description: `${definition.description ?? ''}\n[External MCP server: requires confirmation before every call.]`.trim()
              })
        },
        serverName,
        toolName: definition.name,
        approval: policy.automatic ? 'automatic' : 'confirmation',
        budget,
          execute: (arguments_) =>
            executeRevalidatedMcpTool({
              serverName,
              server,
              toolName: definition.name,
              arguments_: arguments_,
              pool: params.pool
            })
      });
    }
  }
  return tools;
}
