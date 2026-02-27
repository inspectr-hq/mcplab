import type { AgentConfig, EvalConfig, LlmMessage, ToolDef } from '@inspectr/mcplab-core';
import { McpClientManager } from '@inspectr/mcplab-core';
import {
  chatWithJsonRetry,
  cleanupSessionsByTtl,
  makeAssistantToolPublicName,
  newAssistantEntityId,
  touchSession,
  truncateJson,
  withTimeout
} from './assistant-common.js';
import { readLibraries } from './libraries-store.js';

export { truncateJson } from './assistant-common.js';

interface ScenarioAssistantContextInput {
  configSnapshotPolicy?: {
    enabled?: boolean;
    mode?: 'warn' | 'fail_on_drift';
    baselineSnapshotId?: string;
  };
  scenario: {
    id: string;
    name?: string;
    prompt: string;
    serverNames: string[];
    evalRules: Array<{ type: string; value: string }>;
    extractRules: Array<{ name: string; pattern: string }>;
    snapshotEval?: {
      enabled?: boolean;
      baselineSnapshotId?: string;
    };
  };
  availableServers?: Array<{ name: string; url?: string }>;
  availableAgents?: Array<{ name: string; provider: string; model: string }>;
}

interface ScenarioAssistantSuggestionBundle {
  prompt?: { replacement: string; rationale?: string };
  evalRules?: {
    replacement: Array<{ type: string; value: string }>;
    rationale?: string;
  };
  extractRules?: {
    replacement: Array<{ name: string; pattern: string }>;
    rationale?: string;
  };
  snapshotEval?: {
    patch: {
      enabled?: boolean;
      baselineSnapshotId?: string;
    };
    rationale?: string;
  };
  notes?: string[];
}

interface ParsedAssistantToolCall {
  name: string;
  arguments?: unknown;
}

interface ParsedAssistantModelOutput {
  type: 'assistant_message' | 'tool_call_request';
  text: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  toolCall?: ParsedAssistantToolCall;
}

interface AssistantPendingToolCall {
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

interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
  suggestions?: ScenarioAssistantSuggestionBundle;
  pendingToolCallId?: string;
  toolRequestServer?: string;
  toolRequestName?: string;
  toolRequestPublicName?: string;
}

export interface ScenarioAssistantSession {
  id: string;
  createdAt: number;
  lastTouchedAt: number;
  configPath?: string;
  selectedAssistantAgentName: string;
  context: ScenarioAssistantContextInput;
  agentConfig: AgentConfig;
  mcp: McpClientManager;
  tools: ToolDef[];
  toolPublicMap: Map<string, { server: string; tool: string }>;
  pendingToolCalls: AssistantPendingToolCall[];
  chatMessages: AssistantChatMessage[];
  llmMessages: LlmMessage[];
  warnings: string[];
  systemPromptCache?: string;
}

const SCENARIO_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const SCENARIO_ASSISTANT_MAX_TOOL_CALLS_PER_TURN = 3;
const SCENARIO_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS = 4000;

export function cleanupAssistantSessions(
  sessions: Map<string, ScenarioAssistantSession>,
  now = Date.now()
): void {
  cleanupSessionsByTtl(sessions, SCENARIO_ASSISTANT_SESSION_TTL_MS, now);
}

export function touchAssistantSession(session: ScenarioAssistantSession): void {
  touchSession(session);
}

export function assistantSessionView(session: ScenarioAssistantSession) {
  return {
    id: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.lastTouchedAt).toISOString(),
    selectedAssistantAgentName: session.selectedAssistantAgentName,
    model: session.agentConfig.model,
    provider: session.agentConfig.provider,
    warnings: session.warnings,
    toolsLoaded: session.tools.length,
    toolServers: Array.from(new Set(session.tools.map((tool) => tool.name.split('__')[0]))),
    messages: session.chatMessages,
    pendingToolCalls: session.pendingToolCalls.filter((call) => call.status === 'pending')
  };
}

function assistantSystemPrompt(session: ScenarioAssistantSession): string {
  if (session.systemPromptCache) return session.systemPromptCache;
  const { scenario, configSnapshotPolicy } = session.context;
  const toolLines = session.tools.map((tool) => {
    const mapping = session.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${
      mapping?.tool ?? tool.name
    }) schema=${schemaText}`;
  });
  const prompt = [
    'You are a Scenario Authoring Assistant for MCP evaluation scenarios.',
    'Goal: help the user author deterministic scenario prompt, Checks (pass/fail), Value Capture Rules, and snapshot settings.',
    'Use the available MCP tools and schemas to ground suggestions.',
    'If you need live MCP information, call a tool and wait for approval.',
    'Use user-facing terminology in your text responses: "Checks" and "Value Capture Rules" (not "eval rules" / "extract rules").',
    'Respond ONLY as JSON with one of these envelopes:',
    `{"type":"assistant_message","text":"...","suggestions":{...optional...}}`,
    `{"type":"tool_call_request","text":"...","toolCall":{"name":"PUBLIC_TOOL_NAME","arguments":{}},"suggestions":{...optional...}}`,
    'For suggestions, use keys: prompt, evalRules, extractRules, snapshotEval, notes.',
    'prompt: { replacement: string, rationale?: string }',
    'evalRules: { replacement: [{ type, value }...], rationale?: string }',
    'extractRules: { replacement: [{ name, pattern }...], rationale?: string }',
    'snapshotEval: { patch: { enabled?: boolean, baselineSnapshotId?: string }, rationale?: string }',
    'If you propose any edits to the scenario (prompt, Checks, Value Capture Rules, or snapshot settings), you MUST include the corresponding structured suggestions payload.',
    'Do not describe "suggested updates" in text only. Include suggestions so the UI can render Apply actions.',
    'Keep rule types limited to: required_tool, forbidden_tool, response_contains, response_not_contains.',
    'Ask clarifying questions if the scenario intent is unclear.',
    `Scenario context: ${JSON.stringify({
      id: scenario.id,
      name: scenario.name ?? '',
      prompt: scenario.prompt,
      serverNames: scenario.serverNames,
      evalRules: scenario.evalRules,
      extractRules: scenario.extractRules,
      snapshotEval: scenario.snapshotEval ?? null,
      configSnapshotPolicy: configSnapshotPolicy ?? null
    })}`,
    toolLines.length > 0
      ? `Available MCP tools:\n${toolLines.join('\n')}`
      : 'No MCP tools available.'
  ].join('\n');
  session.systemPromptCache = prompt;
  return prompt;
}

function formatAssistantMcpPreloadError(serverName: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const htmlErrorMatch =
    raw.match(/Error code\s+(\d{3})/i) ??
    raw.match(/<title>[^<]*\b(\d{3})\b[^<]*<\/title>/i) ??
    raw.match(/\b(502|503|504)\b/);
  const cloudflare = /cloudflare/i.test(raw);
  if (/<html/i.test(raw) || /<!doctype html/i.test(raw)) {
    const code = htmlErrorMatch?.[1];
    const provider = cloudflare ? ' (Cloudflare)' : '';
    return `Scenario Assistant MCP preload failed for server '${serverName}': Upstream MCP endpoint returned an HTML error page${
      code ? ` (${code})` : ''
    }${provider}. Check that the MCP server is reachable and healthy.`;
  }
  return `Scenario Assistant MCP preload failed for server '${serverName}': ${raw}`;
}

export async function preloadAssistantTools(
  session: ScenarioAssistantSession,
  serversByName: Record<string, EvalConfig['servers'][string]>,
  selectedServerNames: string[]
): Promise<void> {
  const usedNames = new Set<string>();
  for (const serverName of selectedServerNames) {
    const server = serversByName[serverName];
    if (!server) {
      session.warnings.push(`Scenario Assistant: server '${serverName}' not found in config.`);
      continue;
    }
    try {
      await session.mcp.connectAll({ [serverName]: server });
      const tools = await session.mcp.listTools(serverName);
      for (const tool of tools) {
        const publicName = makeAssistantToolPublicName(serverName, tool.name, usedNames);
        session.toolPublicMap.set(publicName, { server: serverName, tool: tool.name });
        session.tools.push({
          ...tool,
          name: publicName,
          description: `${tool.description ?? ''}\n[server=${serverName} tool=${tool.name}]`.trim()
        });
      }
    } catch (error: unknown) {
      session.warnings.push(formatAssistantMcpPreloadError(serverName, error));
    }
  }
}

function parseAssistantModelOutput(text: string): ParsedAssistantModelOutput {
  const cleaned = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (fenced) {
      parsed = JSON.parse(fenced[1]);
    } else {
      throw new Error('Assistant returned invalid JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Assistant response must be a JSON object');
  }
  const parsedObj = parsed as Partial<ParsedAssistantModelOutput>;
  if (parsedObj.type !== 'assistant_message' && parsedObj.type !== 'tool_call_request') {
    throw new Error("Assistant response type must be 'assistant_message' or 'tool_call_request'");
  }
  if (typeof parsedObj.text !== 'string') {
    throw new Error('Assistant response missing text');
  }
  if (parsedObj.type === 'tool_call_request') {
    if (!parsedObj.toolCall || typeof parsedObj.toolCall !== 'object') {
      throw new Error('Assistant tool_call_request missing toolCall');
    }
    if (typeof parsedObj.toolCall.name !== 'string' || !parsedObj.toolCall.name.trim()) {
      throw new Error('Assistant toolCall.name must be a non-empty string');
    }
  }
  return parsedObj as ParsedAssistantModelOutput;
}

function safeAssistantTextFromResponse(rawText: string): string {
  try {
    return parseAssistantModelOutput(rawText).text;
  } catch {
    return rawText.trim();
  }
}

async function assistantChatModel(
  session: ScenarioAssistantSession
): Promise<ReturnType<typeof parseAssistantModelOutput>> {
  return chatWithJsonRetry({
    agent: session.agentConfig,
    messages: session.llmMessages,
    tools: session.tools,
    system: assistantSystemPrompt(session),
    parse: parseAssistantModelOutput,
    toolCallFallbackText: (toolName) => `I need to call '${toolName}' to help answer.`
  });
}

export async function continueAssistantTurn(session: ScenarioAssistantSession): Promise<{
  session: ReturnType<typeof assistantSessionView>;
  response: {
    type: 'assistant_message' | 'tool_call_request';
    text: string;
    suggestions?: ScenarioAssistantSuggestionBundle;
    pendingToolCall?: AssistantPendingToolCall;
  };
}> {
  const pendingCountForTurn = session.pendingToolCalls.filter((c) => c.status === 'pending').length;
  if (pendingCountForTurn > SCENARIO_ASSISTANT_MAX_TOOL_CALLS_PER_TURN) {
    throw new Error('Scenario Assistant exceeded maximum pending tool calls for this turn');
  }
  const modelOutput = await assistantChatModel(session);
  if (modelOutput.type === 'tool_call_request') {
    const requested = modelOutput.toolCall!;
    const mapping = session.toolPublicMap.get(requested.name);
    if (!mapping) {
      throw new Error(
        `Scenario Assistant requested unknown tool '${
          requested.name
        }'. Available tools: ${session.tools.map((t) => t.name).join(', ')}`
      );
    }
    const pending: AssistantPendingToolCall = {
      id: newAssistantEntityId('satc'),
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
      suggestions: modelOutput.suggestions,
      pendingToolCallId: pending.id,
      toolRequestServer: pending.server,
      toolRequestName: pending.tool,
      toolRequestPublicName: pending.publicToolName
    });
    session.llmMessages.push({
      role: 'assistant',
      content: modelOutput.text,
      tool_calls: [
        {
          id: pending.id,
          name: pending.publicToolName,
          arguments: pending.arguments
        }
      ]
    });
    touchAssistantSession(session);
    return {
      session: assistantSessionView(session),
      response: {
        type: 'tool_call_request',
        text: modelOutput.text,
        suggestions: modelOutput.suggestions,
        pendingToolCall: pending
      }
    };
  }

  session.chatMessages.push({
    id: newAssistantEntityId('msg'),
    role: 'assistant',
    text: modelOutput.text,
    createdAt: new Date().toISOString(),
    suggestions: modelOutput.suggestions
  });
  session.llmMessages.push({
    role: 'assistant',
    content: JSON.stringify(modelOutput)
  });
  touchAssistantSession(session);
  return {
    session: assistantSessionView(session),
    response: {
      type: 'assistant_message',
      text: modelOutput.text,
      suggestions: modelOutput.suggestions
    }
  };
}

export async function executeAssistantToolCall(
  session: ScenarioAssistantSession,
  pending: AssistantPendingToolCall
): Promise<unknown> {
  const timeoutMs = 10_000;
  return withTimeout(
    () => session.mcp.callTool(pending.server, pending.tool, pending.arguments),
    timeoutMs,
    `Tool call timed out after ${timeoutMs}ms`
  );
}

export function summarizeToolResultForAssistant(result: unknown): string {
  return truncateJson(result, SCENARIO_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS);
}

export function resolveAssistantAgentFromConfig(
  config: EvalConfig,
  selectedAssistantAgentName: string
): AgentConfig {
  const agent = config.agents[selectedAssistantAgentName];
  if (!agent) {
    throw new Error(
      `Scenario Assistant agent '${selectedAssistantAgentName}' not found in resolved config agents.`
    );
  }
  return agent;
}

export function resolveAssistantAgentFromLibraries(
  libraries: ReturnType<typeof readLibraries>,
  selectedAssistantAgentName: string
): AgentConfig {
  const agent = libraries.agents[selectedAssistantAgentName];
  if (!agent) {
    throw new Error(
      `Scenario Assistant agent '${selectedAssistantAgentName}' not found in library agents. Configure the central Scenario Assistant Agent in Libraries > Scenarios.`
    );
  }
  return agent;
}

export function pickDefaultAssistantAgentName(params: {
  requested?: string;
  settingsDefault?: string;
  agentNames: string[];
}): string {
  const requested = params.requested?.trim();
  if (requested) return requested;
  const settingsDefault = params.settingsDefault?.trim();
  if (settingsDefault) return settingsDefault;
  return params.agentNames[0] ?? '';
}
