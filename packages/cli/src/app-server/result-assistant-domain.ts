import type { AgentConfig, LlmMessage, ResultsJson, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent, McpClientManager } from '@inspectr/mcplab-core';
import {
  cleanupSessionsByTtl,
  makeAssistantToolPublicName,
  newAssistantEntityId,
  touchSession,
  truncateJson
} from './assistant-common.js';

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
  runId: string;
  createdAt: number;
  lastTouchedAt: number;
  selectedAssistantAgentName: string;
  agentConfig: AgentConfig;
  resultSummary: ResultsJson;
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  pendingToolCalls: ResultAssistantPendingToolCall[];
  chatMessages: ResultAssistantChatMessage[];
  llmMessages: LlmMessage[];
  systemPromptCache?: string;
}

const RESULT_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const RESULT_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS = 4000;
const RESULT_ASSISTANT_MAX_PENDING_TOOL_CALLS = 3;
const RESULT_ASSISTANT_MCP_SERVER_NAME = 'mcplab';
const RESULT_ASSISTANT_ALLOWED_TOOLS = new Set([
  'mcplab_write_markdown_report',
  'mcplab_list_runs',
  'mcplab_read_run_artifact',
  'mcplab_grep_run_artifact',
  'mcplab_trace_stats',
  'mcplab_trace_get_final_answers',
  'mcplab_trace_get_conversation',
  'mcplab_trace_list_events',
  'mcplab_trace_search',
  'mcplab_list_tool_analysis_results',
  'mcplab_read_tool_analysis_result',
  'mcplab_list_library',
  'mcplab_get_library_item'
]);

export function cleanupResultAssistantSessions(
  sessions: Map<string, ResultAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, RESULT_ASSISTANT_SESSION_TTL_MS, now);
}

export function touchResultAssistantSession(session: ResultAssistantSession): void {
  touchSession(session);
}

export function resultAssistantSessionView(session: ResultAssistantSession) {
  return {
    id: session.id,
    runId: session.runId,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.agentConfig.model,
    provider: session.agentConfig.provider,
    messages: session.chatMessages,
    pendingToolCalls: session.pendingToolCalls.filter((call) => call.status === 'pending')
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
    if (!RESULT_ASSISTANT_ALLOWED_TOOLS.has(tool.name)) continue;
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
      description:
        `${tool.description ?? ''}\n[server=${RESULT_ASSISTANT_MCP_SERVER_NAME} tool=${tool.name}]`.trim()
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
        `Result Assistant requested unknown tool '${requested.name}'. Available tools: ${session.tools.map((t) => t.name).join(', ')}`
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
    session.pendingToolCalls.push(pending);
    session.chatMessages.push({
      id: newAssistantEntityId('msg'),
      role: 'assistant',
      text: modelOutput.text,
      createdAt: new Date().toISOString(),
      pendingToolCallId: pending.id,
      toolRequestServer: pending.server,
      toolRequestName: pending.tool,
      toolRequestPublicName: pending.publicToolName
    });
    session.llmMessages.push({
      role: 'assistant',
      content: modelOutput.text,
      tool_calls: [{ id: pending.id, name: pending.publicToolName, arguments: pending.arguments }]
    });
    touchResultAssistantSession(session);
    return {
      session: resultAssistantSessionView(session),
      response: { type: 'tool_call_request', text: modelOutput.text, pendingToolCall: pending }
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
  const timeoutMs = 10_000;
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
  const totalScenarioCount = session.resultSummary.scenarios.length;
  const scenarioLimit = 30;
  const omittedScenarioCount = Math.max(0, totalScenarioCount - scenarioLimit);
  const scenarioSummaries = session.resultSummary.scenarios.slice(0, scenarioLimit).map((sc) => ({
    scenario_id: sc.scenario_id,
    agent: sc.agent,
    pass_rate: sc.pass_rate,
    run_count: sc.runs.length,
    sample_failures: sc.runs.flatMap((r) => r.failures).slice(0, 5)
  }));
  const toolLines = session.tools.map((tool) => {
    const mapping = session.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${mapping?.tool ?? tool.name}) schema=${schemaText}`;
  });
  const prompt = [
    'You are the MCP Labs Result Assistant.',
    'Help the user understand MCP evaluation run results, failures, tool behavior, and snapshot drift.',
    'Be concise and practical.',
    'You may call MCPLab MCP tools for grounded follow-up actions (e.g. write a markdown report) when useful, but only when it improves the answer.',
    'If you need a tool, request exactly one tool call and wait for approval.',
    'Respond in plain text. If you need to call a tool, use the available tools directly.',
    omittedScenarioCount > 0
      ? `Important: Only the first ${scenarioLimit} of ${totalScenarioCount} scenarios are included in the prompt context. If the user asks about coverage/completeness, mention that ${omittedScenarioCount} scenario(s) are omitted and suggest using tools to inspect full results.`
      : 'All scenarios are included in the prompt context.',
    `Run result context: ${JSON.stringify({
      run_id: session.resultSummary.metadata.run_id,
      timestamp: session.resultSummary.metadata.timestamp,
      config_hash: session.resultSummary.metadata.config_hash,
      summary: session.resultSummary.summary,
      snapshot_eval: session.resultSummary.metadata.snapshot_eval ?? null,
      scenario_count_total: totalScenarioCount,
      scenario_count_included: scenarioSummaries.length,
      scenario_count_omitted: omittedScenarioCount,
      scenarios: scenarioSummaries
    })}`,
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
      response.content?.trim() || `I need to call '${first.name}' to help with this request.`;
    return {
      type: 'tool_call_request',
      text: baseText,
      toolCall: { name: first.name, arguments: first.arguments ?? {} }
    };
  }
  return { type: 'assistant_message', text: response.content?.trim() ?? '' };
}
