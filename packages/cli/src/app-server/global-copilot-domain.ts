import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEncoder } from '@ag-ui/encoder';
import { EventType, RunAgentInputSchema, type RunAgentInput } from '@ag-ui/core';
import { chatWithAgent, McpClientManager, type AgentConfig, type LlmMessage, type ToolDef } from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';
import { readLibraries } from './libraries-store.js';
import { isResultAssistantAllowedTool, isResultAssistantAutoApprovedTool } from './result-assistant-tools.js';
import { makeAssistantToolPublicName, truncateJson } from './assistant-common.js';

export function selectGlobalCopilotAgentName(params: {
  globalCopilotAgentName?: string;
  scenarioAssistantAgentName?: string;
  agentNames: string[];
}): string | undefined {
  const candidates = [params.globalCopilotAgentName, params.scenarioAssistantAgentName];
  return candidates.find((name) => name && params.agentNames.includes(name)) ?? params.agentNames[0];
}

function toLlmMessages(input: RunAgentInput): LlmMessage[] {
  return input.messages.flatMap((message: any) => {
    if (!['user', 'assistant', 'system', 'tool'].includes(message.role)) return [];
    if (typeof message.content !== 'string') return [];
    return [{ role: message.role, content: message.content } as LlmMessage];
  });
}

function globalCopilotSystemPrompt(context: unknown): string {
  return [
    'You are the MCPLab Global Copilot.',
    'Help users analyze evaluation results and author or improve MCP test cases.',
    'You can navigate the MCPLab interface using available frontend actions.',
    'Never claim that a write, evaluation run, or tool analysis job happened until its confirmed action succeeds.',
    'Use concise, practical answers.',
    `Current application context: ${JSON.stringify(context ?? {})}`
  ].join('\n');
}

function localMcplabMcpUrl(): string {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = process.env.MCP_PORT || '3011';
  return `http://${host}:${port}${process.env.MCP_PATH || '/mcp'}`;
}

async function loadMcplabTools(): Promise<{
  mcp: McpClientManager;
  tools: ToolDef[];
  mapping: Map<string, string>;
}> {
  const mcp = new McpClientManager();
  await mcp.connectAll({ mcplab: { transport: 'http', url: localMcplabMcpUrl() } });
  const mapping = new Map<string, string>();
  const usedNames = new Set<string>();
  const tools = (await mcp.listTools('mcplab')).flatMap((tool) => {
    if (!isResultAssistantAllowedTool(tool.name)) return [];
    const publicName = makeAssistantToolPublicName('mcplab', tool.name, usedNames);
    mapping.set(publicName, tool.name);
    return [{ ...tool, name: publicName }];
  });
  return { mcp, tools, mapping };
}

function sendEvent(res: ServerResponse, encoder: EventEncoder, event: any): void {
  res.write(encoder.encodeSSE(event));
}

export async function handleGlobalCopilotRun(params: {
  req: IncomingMessage;
  res: ServerResponse;
  settings: AppSettings;
  parseBody: (req: IncomingMessage) => Promise<any>;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
}): Promise<void> {
  const { req, res, settings, parseBody, asJson } = params;
  const body = await parseBody(req);
  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) {
    asJson(res, 400, { error: 'Invalid AG-UI run input', details: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const libraries = readLibraries(settings.librariesDir);
  const agentName = selectGlobalCopilotAgentName({
    globalCopilotAgentName: settings.globalCopilotAgentName,
    scenarioAssistantAgentName: settings.scenarioAssistantAgentName,
    agentNames: Object.keys(libraries.agents)
  });
  const agent = agentName ? libraries.agents[agentName] : undefined;
  if (!agent) {
    asJson(res, 400, {
      error: 'No Global Copilot agent is configured. Add an agent in Libraries > Agents or configure it in Settings.'
    });
    return;
  }

  const encoder = new EventEncoder({ accept: String(req.headers.accept ?? '') });
  res.statusCode = 200;
  res.setHeader('content-type', encoder.getContentType());
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  if ('flushHeaders' in res && typeof res.flushHeaders === 'function') res.flushHeaders();
  const messageId = randomUUID();
  try {
    sendEvent(res, encoder, { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
    sendEvent(res, encoder, { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
    const loaded = await loadMcplabTools().catch(() => undefined);
    const messages = toLlmMessages(input);
    let response = await chatWithAgent({
      agent: agent as AgentConfig,
      messages,
      tools: loaded?.tools,
      system: globalCopilotSystemPrompt((input.forwardedProps as any)?.context)
    });
    if (loaded && response.tool_calls?.length) {
      const call = response.tool_calls[0]!;
      const tool = loaded.mapping.get(call.name);
      if (tool && isResultAssistantAutoApprovedTool(tool)) {
        const toolCallId = call.id ?? randomUUID();
        sendEvent(res, encoder, { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: call.name, parentMessageId: messageId });
        sendEvent(res, encoder, { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(call.arguments ?? {}) });
        sendEvent(res, encoder, { type: EventType.TOOL_CALL_END, toolCallId });
        const result = await loaded.mcp.callTool('mcplab', tool, call.arguments ?? {});
        const content = truncateJson(result, 4000);
        sendEvent(res, encoder, { type: EventType.TOOL_CALL_RESULT, toolCallId, content });
        messages.push({ role: 'assistant', content: response.content ?? '', tool_calls: [{ id: toolCallId, name: call.name, arguments: call.arguments ?? {} }] });
        messages.push({ role: 'tool', content, tool_call_id: toolCallId, name: call.name });
        response = await chatWithAgent({ agent: agent as AgentConfig, messages, tools: loaded.tools, system: globalCopilotSystemPrompt((input.forwardedProps as any)?.context) });
      }
    }
    await loaded?.mcp.disconnectAll();
    const text = response.content?.trim() || (response.tool_calls?.length ? 'This action needs your approval before I can continue.' : 'I could not produce a response.');
    sendEvent(res, encoder, { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
    sendEvent(res, encoder, { type: EventType.TEXT_MESSAGE_END, messageId });
    sendEvent(res, encoder, { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
  } catch (error: unknown) {
    sendEvent(res, encoder, {
      type: EventType.RUN_ERROR,
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    res.end();
  }
}
