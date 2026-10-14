import type { ServerResponse } from 'node:http';
import type {
  LlmAgentConfig,
  AssistantRuntimeMessage,
  AssistantRuntimeDefinition,
  AssistantRuntimeModelOutput,
  AssistantRuntimeSession,
  AssistantRuntimeToolCall,
  ResultsJson,
  ToolDef
} from '@inspectr/mcplab-core';
import { McpClientManager } from '@inspectr/mcplab-core';
import {
  cleanupSessionsByTtl,
  makeAssistantToolPublicName,
  touchSession,
  truncateJson,
  withTimeout
} from './assistant-common.js';
import type { AssistantSseEvent } from './assistant-events.js';
import { endAssistantSseClients } from './assistant-events.js';
import {
  isResultAssistantAllowedTool,
  isResultAssistantAutoApprovedTool
} from './result-assistant-tools.js';

type ResultAssistantPendingToolCall = AssistantRuntimeToolCall;
type ResultAssistantChatMessage = AssistantRuntimeMessage;

export interface ResultAssistantSession {
  id: string;
  scope: 'run' | 'all_runs';
  runId: string | null;
  createdAt: number;
  lastTouchedAt: number;
  selectedAssistantAgentName: string;
  agentConfig: LlmAgentConfig;
  resultSummary: ResultsJson | null;
  referenceReportsForRun: Array<{
    path: string;
    relativePath: string;
    name: string;
    sizeBytes: number;
    mtime: string;
  }>;
  toolsLoaded: number;
  toolServers: string[];
  initialMessages: ResultAssistantChatMessage[];
  events: AssistantSseEvent[];
  clients: Set<ServerResponse>;
  runtime?: AssistantRuntimeSession;
}

export interface PreparedResultAssistantSession extends ResultAssistantSession {
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  systemPromptCache?: string;
}

const RESULT_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const RESULT_ASSISTANT_MCP_SERVER_NAME = 'mcplab';

export function cleanupResultAssistantSessions(
  sessions: Map<string, ResultAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, RESULT_ASSISTANT_SESSION_TTL_MS, now, (session) => {
    void Promise.resolve(session.runtime?.dispose()).catch(() => {});
    endAssistantSseClients(session);
  }, (session) => session.runtime?.isBusy?.() === true);
}

export function touchResultAssistantSession(session: ResultAssistantSession): void {
  touchSession(session);
}

export function resultAssistantSessionView(session: ResultAssistantSession) {
  const runtimeSnapshot = session.runtime?.getSnapshot();
  return {
    id: session.id,
    scope: session.scope,
    runId: session.runId,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.agentConfig.model,
    provider: session.agentConfig.provider,
    toolsLoaded: session.toolsLoaded,
    toolServers: session.toolServers,
    messages: runtimeSnapshot?.messages ?? session.initialMessages,
    pendingToolCalls: runtimeSnapshot?.pendingToolCalls ?? []
  };
}

export async function preloadResultAssistantTools(
  session: PreparedResultAssistantSession,
  mcpServerUrl: string
): Promise<void> {
  await session.mcp.connectAll({
    [RESULT_ASSISTANT_MCP_SERVER_NAME]: {
      transport: 'http',
      url: mcpServerUrl
    }
  });
  const discovered = await session.mcp.listTools(RESULT_ASSISTANT_MCP_SERVER_NAME);
  const usedNames = new Set<string>();
  for (const tool of discovered) {
    if (!isResultAssistantAllowedTool(tool.name)) continue;
    const publicName = makeAssistantToolPublicName(
      RESULT_ASSISTANT_MCP_SERVER_NAME,
      tool.name,
      usedNames
    );
    session.toolPublicMap.set(publicName, {
      server: RESULT_ASSISTANT_MCP_SERVER_NAME,
      tool: tool.name
    });
    session.tools.push({
      ...tool,
      name: publicName,
      description: `${tool.description ?? ''}\n[server=${RESULT_ASSISTANT_MCP_SERVER_NAME} tool=${
        tool.name
      }]`.trim()
    });
  }
}

export function createResultAssistantRuntimeDefinition(
  session: PreparedResultAssistantSession,
  refreshReports: () => ResultAssistantSession['referenceReportsForRun']
): AssistantRuntimeDefinition {
  return {
    assistant: 'result',
    outputMode: 'native',
    agent: session.agentConfig,
    context: {
      scope: session.scope,
      runId: session.runId,
      resultSummary: session.resultSummary,
      referenceReportsForRun: session.referenceReportsForRun
    },
    initialMessages: session.initialMessages,
    dispose: () => session.mcp.disconnectAll(),
    getSystemPrompt: () => resultAssistantSystemPrompt(session),
    tools: session.tools.map((tool) => {
      const mapping = session.toolPublicMap.get(tool.name)!;
      return {
        name: tool.name,
        server: mapping.server,
        tool: mapping.tool,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (arguments_, signal) => {
          const result = await withTimeout(
            () => session.mcp.callTool(mapping.server, mapping.tool, arguments_, { signal }),
            30_000,
            'Tool call timed out after 30000ms',
            signal
          );
          if (mapping.tool === 'mcplab_write_markdown_report' && session.scope === 'run') {
            session.referenceReportsForRun = refreshReports();
            session.systemPromptCache = undefined;
          }
          return result;
        }
      };
    }),
    approvalPolicy: (name) =>
      isResultAssistantAllowedTool(name) && isResultAssistantAutoApprovedTool(name)
        ? 'automatic'
        : 'approval_required',
    decodeOutput: (value): AssistantRuntimeModelOutput => ({
      type: 'assistant_message',
      text: String(value)
    })
  };
}

function resultAssistantSystemPrompt(session: PreparedResultAssistantSession): string {
  if (session.systemPromptCache) return session.systemPromptCache;
  const scenarioLimit = 30;
  const totalScenarioCount = session.resultSummary?.scenarios.length ?? 0;
  const omittedScenarioCount = Math.max(0, totalScenarioCount - scenarioLimit);
  const scenarioSummaries =
    session.resultSummary?.scenarios.slice(0, scenarioLimit).map((sc) => ({
      scenario_id: sc.scenario_id,
      agent: sc.agent,
      pass_rate: sc.pass_rate,
      run_count: sc.runs.length,
      sample_failures: sc.runs.flatMap((r) => r.failures).slice(0, 5)
    })) ?? [];
  const toolLines = session.tools.map((tool) => {
    const mapping = session.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${
      mapping?.tool ?? tool.name
    }) schema=${schemaText}`;
  });
  const prompt = [
    'You are the MCP Labs Result Assistant.',
    'Help the user understand MCP evaluation run results, failures, and tool behavior.',
    'Be concise and practical.',
    'You may call MCPLab MCP tools for grounded follow-up actions (e.g. write a markdown report) when useful, but only when it improves the answer.',
    'Tool selection policy: prefer search_* tools first for retrieval; fall back to list_* tools when the query is unknown, broad, or full coverage is required.',
    'If you need a tool, request exactly one tool call and wait for approval.',
    'Respond in plain text. If you need to call a tool, use the available tools directly.',
    session.scope === 'all_runs'
      ? 'Scope: all historical runs. Use mcplab_results_search for broad retrieval, mcplab_results_context for focused excerpts, and mcplab_read_run_artifact only for raw fallback reads.'
      : omittedScenarioCount > 0
        ? `Important: Only the first ${scenarioLimit} of ${totalScenarioCount} scenarios are included in the prompt context. If the user asks about coverage/completeness, mention that ${omittedScenarioCount} scenario(s) are omitted and suggest using tools to inspect full results.`
        : 'All scenarios are included in the prompt context.',
    session.scope === 'all_runs'
      ? 'Run result context: none preloaded. You can inspect any run from history using available tools.'
      : `Run result context: ${JSON.stringify({
          run_id: session.resultSummary?.metadata.run_id,
          timestamp: session.resultSummary?.metadata.timestamp,
          run_note: session.resultSummary?.metadata.run_note ?? null,
          config_hash: session.resultSummary?.metadata.config_hash,
          summary: session.resultSummary?.summary,
          scenario_count_total: totalScenarioCount,
          scenario_count_included: scenarioSummaries.length,
          scenario_count_omitted: omittedScenarioCount,
          scenarios: scenarioSummaries,
          linked_custom_reports: session.referenceReportsForRun.slice(0, 20)
        })}`,
    session.scope === 'all_runs'
      ? 'For custom markdown reports across runs, use mcplab_search_markdown_reports (no query needed for full listing, or filter by run_id/name). Then read selected files with mcplab_read_markdown_report.'
      : 'For custom markdown reports linked to this run, use mcplab_search_markdown_reports with run_id set to the current run id. Then read selected files with mcplab_read_markdown_report.',
    toolLines.length > 0
      ? `Available MCPLab MCP tools:\n${toolLines.join('\n')}`
      : 'No MCPLab MCP tools available.'
  ].join('\n');
  session.systemPromptCache = prompt;
  return prompt;
}
