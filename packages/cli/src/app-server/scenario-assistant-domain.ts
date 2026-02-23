import type { AgentConfig, EvalConfig, LlmMessage, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent, McpClientManager } from '@inspectr/mcplab-core';
import { readLibraries } from './libraries-store.js';

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
}

const SCENARIO_ASSISTANT_SESSION_TTL_MS = 30 * 60 * 1000;
const SCENARIO_ASSISTANT_MAX_TOOL_CALLS_PER_TURN = 3;
const SCENARIO_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS = 4000;

export function cleanupAssistantSessions(
  sessions: Map<string, ScenarioAssistantSession>,
  now = Date.now()
): void {
  for (const [id, session] of sessions) {
    if (now - session.lastTouchedAt > SCENARIO_ASSISTANT_SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function touchAssistantSession(session: ScenarioAssistantSession): void {
  session.lastTouchedAt = Date.now();
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
  const { scenario, configSnapshotPolicy } = session.context;
  const toolLines = session.tools.map((tool) => {
    const mapping = session.toolPublicMap.get(tool.name);
    const schemaText = tool.inputSchema ? truncateJson(tool.inputSchema, 500) : '{}';
    return `- ${tool.name} (server=${mapping?.server ?? 'unknown'}, tool=${mapping?.tool ?? tool.name}) schema=${schemaText}`;
  });
  return [
    'You are a Scenario Authoring Assistant for MCP evaluation scenarios.',
    'Goal: help the user author deterministic scenario prompt, eval rules, extract rules, and snapshot settings.',
    'Use the available MCP tools and schemas to ground suggestions.',
    'If you need live MCP information, call a tool and wait for approval.',
    'Respond ONLY as JSON with one of these envelopes:',
    `{"type":"assistant_message","text":"...","suggestions":{...optional...}}`,
    `{"type":"tool_call_request","text":"...","toolCall":{"name":"PUBLIC_TOOL_NAME","arguments":{}},"suggestions":{...optional...}}`,
    'For suggestions, use keys: prompt, evalRules, extractRules, snapshotEval, notes.',
    'prompt: { replacement: string, rationale?: string }',
    'evalRules: { replacement: [{ type, value }...], rationale?: string }',
    'extractRules: { replacement: [{ name, pattern }...], rationale?: string }',
    'snapshotEval: { patch: { enabled?: boolean, baselineSnapshotId?: string }, rationale?: string }',
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
}

export function truncateJson(value: unknown, maxChars: number): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  } catch {
    return String(value);
  }
}

function normalizeAssistantToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || `tool_${Date.now()}`;
}

function makeAssistantToolPublicName(
  serverName: string,
  toolName: string,
  used: Set<string>
): string {
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
      session.warnings.push(
        `Scenario Assistant MCP preload failed for server '${serverName}': ${error instanceof Error ? error.message : String(error)}`
      );
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
  let response = await chatWithAgent({
    agent: session.agentConfig,
    messages: session.llmMessages,
    tools: session.tools,
    system: assistantSystemPrompt(session)
  });
  if (response.tool_calls && response.tool_calls.length > 0) {
    const first = response.tool_calls[0];
    return {
      type: 'tool_call_request',
      text: response.content?.trim() || `I need to call '${first.name}' to help answer.`,
      toolCall: {
        name: first.name,
        arguments: first.arguments ?? {}
      }
    };
  }
  const rawText = response.content?.trim() ?? '';
  try {
    return parseAssistantModelOutput(rawText);
  } catch (error) {
    session.llmMessages.push({
      role: 'assistant',
      content: rawText
    });
    session.llmMessages.push({
      role: 'user',
      content:
        'Your previous response was not valid JSON. Reply ONLY with a valid JSON envelope matching the specified schema.'
    });
    response = await chatWithAgent({
      agent: session.agentConfig,
      messages: session.llmMessages,
      tools: session.tools,
      system: assistantSystemPrompt(session)
    });
    if (response.tool_calls && response.tool_calls.length > 0) {
      const first = response.tool_calls[0];
      return {
        type: 'tool_call_request',
        text: response.content?.trim() || `I need to call '${first.name}' to help answer.`,
        toolCall: { name: first.name, arguments: first.arguments ?? {} }
      };
    }
    return parseAssistantModelOutput(response.content?.trim() ?? '');
  }
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
        `Scenario Assistant requested unknown tool '${requested.name}'. Available tools: ${session.tools.map((t) => t.name).join(', ')}`
      );
    }
    const pending: AssistantPendingToolCall = {
      id: `satc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      suggestions: modelOutput.suggestions,
      pendingToolCallId: pending.id
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
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tool call timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([
    session.mcp.callTool(pending.server, pending.tool, pending.arguments),
    timeout
  ]);
}

export function summarizeToolResultForAssistant(result: unknown): string {
  const text = truncateJson(result, SCENARIO_ASSISTANT_TOOL_RESULT_PREVIEW_CHARS);
  return text;
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
