import type { AgentConfig, LlmMessage, ResultsJson, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent, McpClientManager } from '@inspectr/mcplab-core';
import { truncateJson } from './scenario-assistant-domain.js';

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
}

const RESULT_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const RESULT_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS = 4000;
const RESULT_ASSISTANT_MAX_PENDING_TOOL_CALLS = 3;
const RESULT_ASSISTANT_MCP_SERVER_NAME = 'mcplab-local';
const RESULT_ASSISTANT_ALLOWED_TOOLS = new Set([
  'mcplab_write_markdown_report',
  'mcplab_list_runs',
  'mcplab_read_run_artifact',
  'mcplab_list_tool_analysis_results',
  'mcplab_read_tool_analysis_result',
  'mcplab_list_library',
  'mcplab_get_library_item'
]);

export function cleanupResultAssistantSessions(
  sessions: Map<string, ResultAssistantSession>,
  now = Date.now()
): void {
  for (const [id, session] of sessions) {
    if (now - session.lastTouchedAt > RESULT_ASSISTANT_SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function touchResultAssistantSession(session: ResultAssistantSession): void {
  session.lastTouchedAt = Date.now();
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
    const publicName = makeAssistantToolPublicName(RESULT_ASSISTANT_MCP_SERVER_NAME, tool.name, usedNames);
    session.toolPublicMap.set(publicName, { server: RESULT_ASSISTANT_MCP_SERVER_NAME, tool: tool.name });
    session.tools.push({
      ...tool,
      name: publicName,
      description: `${tool.description ?? ''}\n[server=${RESULT_ASSISTANT_MCP_SERVER_NAME} tool=${tool.name}]`.trim()
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
      id: `ratc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      server: mapping.server,
      tool: mapping.tool,
      publicToolName: requested.name,
      arguments: requested.arguments ?? {},
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    session.pendingToolCalls.push(pending);
    session.chatMessages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      text: modelOutput.text,
      createdAt: new Date().toISOString(),
      pendingToolCallId: pending.id
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
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    text: modelOutput.text,
    createdAt: new Date().toISOString()
  });
  session.llmMessages.push({ role: 'assistant', content: JSON.stringify(modelOutput) });
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
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tool call timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([session.mcp.callTool(pending.server, pending.tool, pending.arguments), timeout]);
}

export function summarizeToolResultForResultAssistant(result: unknown): string {
  return truncateJson(result, RESULT_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS);
}

function resultAssistantSystemPrompt(session: ResultAssistantSession): string {
  const scenarioSummaries = session.resultSummary.scenarios.slice(0, 30).map((sc) => ({
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
  return [
    'You are the MCP Labs Result Assistant.',
    'Help the user understand MCP evaluation run results, failures, tool behavior, and snapshot drift.',
    'Be concise and practical.',
    'You may call MCPLab MCP tools for grounded follow-up actions (e.g. write a markdown report) when useful, but only when it improves the answer.',
    'If you need a tool, request exactly one tool call and wait for approval.',
    'Respond ONLY as JSON with one of these envelopes:',
    `{"type":"assistant_message","text":"..."}`,
    `{"type":"tool_call_request","text":"...","toolCall":{"name":"PUBLIC_TOOL_NAME","arguments":{}}}`,
    `Run result context: ${JSON.stringify({
      run_id: session.resultSummary.metadata.run_id,
      timestamp: session.resultSummary.metadata.timestamp,
      config_hash: session.resultSummary.metadata.config_hash,
      summary: session.resultSummary.summary,
      snapshot_eval: session.resultSummary.metadata.snapshot_eval ?? null,
      scenarios: scenarioSummaries
    })}`,
    toolLines.length > 0
      ? `Available MCPLab MCP tools:\n${toolLines.join('\n')}`
      : 'No MCPLab MCP tools available.'
  ].join('\n');
}

async function resultAssistantChatModel(
  session: ResultAssistantSession
): Promise<ParsedModelOutput> {
  let response = await chatWithAgent({
    agent: session.agentConfig,
    messages: session.llmMessages,
    tools: session.tools,
    system: resultAssistantSystemPrompt(session)
  });
  if (response.tool_calls && response.tool_calls.length > 0) {
    const first = response.tool_calls[0];
    return {
      type: 'tool_call_request',
      text: response.content?.trim() || `I need to call '${first.name}' to help with this request.`,
      toolCall: { name: first.name, arguments: first.arguments ?? {} }
    };
  }
  const rawText = response.content?.trim() ?? '';
  try {
    return parseModelOutput(rawText);
  } catch {
    session.llmMessages.push({ role: 'assistant', content: rawText });
    session.llmMessages.push({
      role: 'user',
      content:
        'Your previous response was not valid JSON. Reply ONLY with a valid JSON envelope matching the specified schema.'
    });
    response = await chatWithAgent({
      agent: session.agentConfig,
      messages: session.llmMessages,
      tools: session.tools,
      system: resultAssistantSystemPrompt(session)
    });
    if (response.tool_calls && response.tool_calls.length > 0) {
      const first = response.tool_calls[0];
      return {
        type: 'tool_call_request',
        text: response.content?.trim() || `I need to call '${first.name}' to help with this request.`,
        toolCall: { name: first.name, arguments: first.arguments ?? {} }
      };
    }
    return parseModelOutput(response.content?.trim() ?? '');
  }
}

function parseModelOutput(text: string): ParsedModelOutput {
  const cleaned = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (!fenced) throw new Error('Assistant returned invalid JSON');
    parsed = JSON.parse(fenced[1]);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Assistant response must be a JSON object');
  const obj = parsed as Partial<ParsedModelOutput>;
  if (obj.type !== 'assistant_message' && obj.type !== 'tool_call_request') {
    throw new Error("Assistant response type must be 'assistant_message' or 'tool_call_request'");
  }
  if (typeof obj.text !== 'string') throw new Error('Assistant response missing text');
  if (obj.type === 'tool_call_request') {
    if (!obj.toolCall || typeof obj.toolCall !== 'object') throw new Error('toolCall is required');
    if (typeof obj.toolCall.name !== 'string' || !obj.toolCall.name.trim()) {
      throw new Error('toolCall.name must be a non-empty string');
    }
  }
  return obj as ParsedModelOutput;
}

function normalizeAssistantToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || `tool_${Date.now()}`;
}

function makeAssistantToolPublicName(serverName: string, toolName: string, used: Set<string>): string {
  const base = `${normalizeAssistantToolName(serverName)}__${normalizeAssistantToolName(toolName)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
