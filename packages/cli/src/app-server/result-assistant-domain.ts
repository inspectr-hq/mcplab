import type { ServerResponse } from 'node:http';
import type { AgentConfig, LlmMessage, ResultsJson, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent, McpClientManager } from '@inspectr/mcplab-core';
import {
  cleanupSessionsByTtl,
  makeAssistantToolPublicName,
  formatAssistantToolName,
  newAssistantEntityId,
  touchSession,
  truncateJson
} from './assistant-common.js';
import type { AssistantSseEvent } from './assistant-events.js';
import { endAssistantSseClients } from './assistant-events.js';
import { isResultAssistantAllowedTool } from './result-assistant-tools.js';

interface ParsedAssistantToolCall {
  name: string;
  arguments?: unknown;
}

interface ParsedModelOutput {
  type: 'assistant_message' | 'tool_call_request';
  text: string;
  toolCall?: ParsedAssistantToolCall;
}

interface ResultAssistantPendingToolCall {
  id: string;
  server: string;
  tool: string;
  publicToolName: string;
  arguments: unknown;
  status: 'pending' | 'approved' | 'denied' | 'error';
  createdAt: string;
  resultPreview?: string;
  error?: string;
}

interface ResultAssistantChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  pendingToolCallId?: string;
  toolRequestServer?: string;
  toolRequestName?: string;
  toolRequestPublicName?: string;
}

export interface ResultAssistantSession {
  id: string;
  scope: 'run' | 'all_runs';
  runId: string | null;
  createdAt: number;
  lastTouchedAt: number;
  selectedAssistantAgentName: string;
  agentConfig: AgentConfig;
  resultSummary: ResultsJson | null;
  referenceReportsForRun: Array<{
    path: string;
    relativePath: string;
    name: string;
    sizeBytes: number;
    mtime: string;
  }>;
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  pendingToolCalls: ResultAssistantPendingToolCall[];
  chatMessages: ResultAssistantChatMessage[];
  llmMessages: LlmMessage[];
  systemPromptCache?: string;
  events: AssistantSseEvent[];
  clients: Set<ServerResponse>;
}

const RESULT_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const RESULT_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS = 4000;
const RESULT_ASSISTANT_MAX_PENDING_TOOL_CALLS = 3;
const RESULT_ASSISTANT_MCP_SERVER_NAME = 'mcplab';

export function cleanupResultAssistantSessions(
  sessions: Map<string, ResultAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, RESULT_ASSISTANT_SESSION_TTL_MS, now, endAssistantSseClients);
}

export function touchResultAssistantSession(session: ResultAssistantSession): void {
  touchSession(session);
}

export function resultAssistantSessionView(session: ResultAssistantSession) {
  return {
    id: session.id,
    scope: session.scope,
    runId: session.runId,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.agentConfig.model,
    provider: session.agentConfig.provider,
    messages: session.chatMessages,
    pendingToolCalls: session.pendingToolCalls
  };
}

export async function preloadResultAssistantTools(
  session: ResultAssistantSession,
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

export async function continueResultAssistantTurn(session: ResultAssistantSession): Promise<{
  session: ReturnType<typeof resultAssistantSessionView>;
  response: {
    type: 'assistant_message' | 'tool_call_request';
    text: string;
    pendingToolCall?: ResultAssistantPendingToolCall;
  };
}> {
  const pendingCount = session.pendingToolCalls.filter((c) => c.status === 'pending').length;
  if (pendingCount > RESULT_ASSISTANT_MAX_PENDING_TOOL_CALLS) {
    throw new Error('Result Assistant exceeded maximum pending tool calls for this turn');
  }
  const modelOutput = await resultAssistantChatModel(session);
  if (modelOutput.type === 'tool_call_request') {
    const requested = modelOutput.toolCall!;
    const mapping = session.toolPublicMap.get(requested.name);
    if (!mapping) {
      throw new Error(
        `Result Assistant requested unknown tool '${
          requested.name
        }'. Available tools: ${session.tools.map((t) => t.name).join(', ')}`
      );
    }
    const pending: ResultAssistantPendingToolCall = {
      id: newAssistantEntityId('ratc'),
      server: mapping.server,
      tool: mapping.tool,
      publicToolName: requested.name,
      arguments: requested.arguments ?? {},
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    const toolRequestText = `I need to call '${formatAssistantToolName(
      pending.publicToolName
    )}' to help with this request.`;
    session.pendingToolCalls.push(pending);
    session.chatMessages.push({
      id: newAssistantEntityId('msg'),
      role: 'assistant',
      text: toolRequestText,
      createdAt: new Date().toISOString(),
      pendingToolCallId: pending.id,
      toolRequestServer: pending.server,
      toolRequestName: pending.tool,
      toolRequestPublicName: pending.publicToolName
    });
    session.llmMessages.push({
      role: 'assistant',
      content: toolRequestText,
      tool_calls: [{ id: pending.id, name: pending.publicToolName, arguments: pending.arguments }]
    });
    touchResultAssistantSession(session);
    return {
      session: resultAssistantSessionView(session),
      response: { type: 'tool_call_request', text: toolRequestText, pendingToolCall: pending }
    };
  }

  session.chatMessages.push({
    id: newAssistantEntityId('msg'),
    role: 'assistant',
    text: modelOutput.text,
    createdAt: new Date().toISOString()
  });
  session.llmMessages.push({ role: 'assistant', content: modelOutput.text });
  touchResultAssistantSession(session);
  return {
    session: resultAssistantSessionView(session),
    response: { type: 'assistant_message', text: modelOutput.text }
  };
}

export async function executeResultAssistantToolCall(
  session: ResultAssistantSession,
  pending: ResultAssistantPendingToolCall
): Promise<unknown> {
  const timeoutMs = 30_000;
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(
      () => reject(new Error(`Tool call timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([
      session.mcp.callTool(pending.server, pending.tool, pending.arguments).finally(() => {
        if (handle) clearTimeout(handle);
      }),
      timeout
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

export function summarizeToolResultForResultAssistant(result: unknown): string {
  return truncateJson(result, RESULT_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS);
}

function resultAssistantSystemPrompt(session: ResultAssistantSession): string {
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
    'Help the user understand MCP evaluation run results, failures, tool behavior, and snapshot drift.',
    'Be concise and practical.',
    'You may call MCPLab MCP tools for grounded follow-up actions (e.g. write a markdown report) when useful, but only when it improves the answer.',
    'Tool selection policy: prefer search_* tools first for retrieval; fall back to list_* tools when the query is unknown, broad, or full coverage is required.',
    'If you need a tool, request exactly one tool call and wait for approval.',
    'Respond in plain text. If you need to call a tool, use the available tools directly.',
    session.scope === 'all_runs'
      ? 'Scope: all historical runs. Use mcplab_search_runs to list or filter runs (no query needed for full listing). Then inspect specific runs via mcplab_read_run_artifact / trace tools.'
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
          snapshot_eval: session.resultSummary?.metadata.snapshot_eval ?? null,
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

async function resultAssistantChatModel(
  session: ResultAssistantSession
): Promise<ParsedModelOutput> {
  const response = await chatWithAgent({
    agent: session.agentConfig,
    messages: session.llmMessages,
    tools: session.tools,
    system: resultAssistantSystemPrompt(session)
  });
  if (response.tool_calls && response.tool_calls.length > 0) {
    const [first] = response.tool_calls;
    const baseText =
      response.content?.trim() ||
      `I need to call '${formatAssistantToolName(first.name)}' to help with this request.`;
    return {
      type: 'tool_call_request',
      text: baseText,
      toolCall: { name: first.name, arguments: first.arguments ?? {} }
    };
  }
  return { type: 'assistant_message', text: response.content?.trim() ?? '' };
}
