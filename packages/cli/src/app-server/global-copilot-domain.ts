import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEncoder } from '@ag-ui/encoder';
import { EventType, RunAgentInputSchema, type RunAgentInput } from '@ag-ui/core';
import {
  chatWithAgent,
  McpClientManager,
  type AgentConfig,
  type LlmMessage,
  type ToolDef
} from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';
import { readLibraries } from './libraries-store.js';
import { isResultAssistantAutoApprovedTool } from './result-assistant-tools.js';
import { makeAssistantToolPublicName, truncateJson } from './assistant-common.js';

export const GLOBAL_COPILOT_NAVIGATION_TARGETS = [
  '/',
  '/mcp-evaluations',
  '/run',
  '/results',
  '/compare',
  '/tool-analysis',
  '/tool-analysis-results',
  '/oauth-debugger',
  '/libraries/servers',
  '/libraries/agents',
  '/libraries/test-cases',
  '/settings'
] as const;

export const GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE = 5;
// Kept for the confirmation endpoint used by persisted pre-queue Copilot threads.
// New Global Copilot runs use the app's queue_evaluation_run frontend action instead.
const GLOBAL_COPILOT_RUN_EVALUATION_TOOL = 'mcplab_run_eval';
const GLOBAL_COPILOT_WRITE_MARKDOWN_REPORT_TOOL = 'mcplab_write_markdown_report';
const GLOBAL_COPILOT_AUTOMATIC_MCP_TOOLS = new Set([
  'mcplab_validate_config',
  'mcplab_list_evaluation_configs',
  'mcplab_generate_scenario_entry',
  'mcplab_generate_agent_entry',
  'mcplab_generate_server_entry'
]);
const GLOBAL_COPILOT_CONFIRMED_MCP_TOOLS = new Set([
  GLOBAL_COPILOT_WRITE_MARKDOWN_REPORT_TOOL
]);

const GLOBAL_COPILOT_ACTION_MARKER = '[mcplab-action]';

function globalCopilotActionContent(action: Record<string, unknown>): string {
  return `${GLOBAL_COPILOT_ACTION_MARKER}${JSON.stringify(action)}`;
}

export function globalCopilotMcplabToolPolicy(name: string): {
  expose: boolean;
  automatic: boolean;
} {
  if (isResultAssistantAutoApprovedTool(name) || GLOBAL_COPILOT_AUTOMATIC_MCP_TOOLS.has(name)) {
    return { expose: true, automatic: true };
  }
  if (GLOBAL_COPILOT_CONFIRMED_MCP_TOOLS.has(name)) return { expose: true, automatic: false };
  return { expose: false, automatic: false };
}

export const GLOBAL_COPILOT_FRONTEND_TOOLS: ToolDef[] = [
  {
    name: 'navigate_to_view',
    description:
      'Navigate to a supported MCPLab view when the user explicitly asks to open or show that view.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', enum: GLOBAL_COPILOT_NAVIGATION_TARGETS },
        reason: { type: 'string', description: 'Short reason shown in the confirmation card.' }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'open_test_case',
    description:
      'Open one specific MCPLab Test Case by its ID when the user explicitly asks to open that Test Case.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['testCaseId'],
      properties: { testCaseId: { type: 'string' } }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'open_result_detail',
    description:
      'Open one specific evaluation Result Detail by run ID when the user explicitly asks to open that run.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: { runId: { type: 'string' } }
    },
    annotations: { readOnlyHint: true }
  }
];

const GLOBAL_COPILOT_START_ACTION_TOOLS: ToolDef[] = [
  {
    name: 'queue_evaluation_run',
    description:
      'Request a confirmed queue-backed evaluation run from the Run Evaluation page. This follows the app’s existing OAuth preflight and queue lifecycle. Use exact library IDs. The selected page configId must match configId.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['configId', 'agentIds'],
      properties: {
        configId: { type: 'string', description: 'Exact evaluation configuration ID selected on the Run Evaluation page.' },
        agentIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Exact agent IDs to use temporarily for this queued run.'
        },
        scenarioIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional exact Test Case IDs. Omit to use the page selection.'
        },
        runsPerScenario: { type: 'number', minimum: 1 },
        serverOverrideAll: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional exact MCP server IDs to use for every selected Test Case.'
        },
        scenarioServerOverrides: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          description: 'Optional per-Test-Case MCP server overrides, keyed by Test Case ID.'
        },
        runNote: { type: 'string' }
      }
    }
  },
  {
    name: 'start_tool_analysis',
    description:
      'Request a confirmed start of the already configured Tool Analysis on the current page.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  }
];

const GLOBAL_COPILOT_LIBRARY_ACTION_TOOLS: ToolDef[] = [
  {
    name: 'create_test_case',
    description:
      'Request confirmed creation of a reviewed Test Case through the MCPLab Library API. This creates only a canonical test-cases entry, never an arbitrary file.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'servers', 'prompt'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        servers: { type: 'array', items: { type: 'string' }, minItems: 1 },
        prompt: { type: 'string' },
        required_tools: { type: 'array', items: { type: 'string' } },
        response_regex_patterns: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'duplicate_test_case',
    description: 'Request a confirmed duplicate of the selected Test Case in the current library view.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } }
    }
  },
  {
    name: 'duplicate_mcp_server',
    description: 'Request a confirmed duplicate of the selected MCP server in the current library view.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } }
    }
  },
  {
    name: 'duplicate_agent',
    description: 'Request a confirmed duplicate of the selected agent in the current library view.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } }
    }
  }
];

const GLOBAL_COPILOT_LIBRARY_ACTION_NAMES = new Set(
  GLOBAL_COPILOT_LIBRARY_ACTION_TOOLS.map((tool) => tool.name)
);

export function globalCopilotFrontendTools(context: any): ToolDef[] {
  const available = new Set(
    Array.isArray(context?.availableActions) ? context.availableActions : []
  );
  return [
    ...GLOBAL_COPILOT_FRONTEND_TOOLS,
    ...GLOBAL_COPILOT_START_ACTION_TOOLS.filter((tool) => available.has(tool.name)),
    ...GLOBAL_COPILOT_LIBRARY_ACTION_TOOLS.filter((tool) => available.has(tool.name))
  ];
}

export function selectGlobalCopilotAgentName(params: {
  globalCopilotAgentName?: string;
  scenarioAssistantAgentName?: string;
  agentNames: string[];
}): string | undefined {
  const candidates = [params.globalCopilotAgentName, params.scenarioAssistantAgentName];
  return (
    candidates.find((name) => name && params.agentNames.includes(name)) ?? params.agentNames[0]
  );
}

export function isExplicitGlobalCopilotNavigationRequest(messages: LlmMessage[]): boolean {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const content = String(lastUserMessage?.content ?? '');
  return (
    /\b(?:go(?:\s+to)?|goto|navigate|open|take me|switch)\b/i.test(content) ||
    /\b(?:show|display)\s+(?:me\s+)?(?:my\s+|the\s+)?(?:test cases|mcp servers|agents|tool analysis|oauth debugger)\b/i.test(content)
  );
}

export function toGlobalCopilotLlmMessages(input: RunAgentInput): LlmMessage[] {
  return input.messages.flatMap((message: any) => {
    if (!['user', 'assistant', 'system', 'tool'].includes(message.role)) return [];
    if (typeof message.content !== 'string') return [];
    if (message.role === 'tool') {
      return [
        {
          role: 'system',
          content: `Previously retrieved MCPLab tool data:\n${message.content}`
        } as LlmMessage
      ];
    }
    return [{ role: message.role, content: message.content } as LlmMessage];
  });
}

function globalCopilotSystemPrompt(context: unknown): string {
  return [
    'You are the MCPLab Global Copilot.',
    'Help users analyze evaluation results and author or improve MCP test cases.',
    'You can navigate the MCPLab interface using available frontend actions.',
    'The Current application context is authoritative page state supplied by the app. When it names a currentView or page filters, answer directly from that context; do not say you cannot see the screen.',
    'Only navigate when the user explicitly asks to go, navigate, open, take them, switch to a view, or to show the Test Cases, MCP Servers, Agents, Tool Analysis, or OAuth Debugger view. Before calling open_test_case, always call mcplab_get_library_item with kind "test_cases" and the exact ID; never open a generated draft that has not been saved. Use open_result_detail with a run ID when the user explicitly asks to open one specific result; otherwise use navigate_to_view for supported views. For “open the last/latest evaluation run”, first call mcplab_list_runs to identify the run ID, then call open_result_detail. Do not use mcplab_build_app_link. For analysis questions, use MCP tools to answer instead of navigating.',
    'When the current context contains resultsFilter, call mcplab_list_runs with its ISO bounds before analyzing the current Results view.',
    'When the current context identifies the MCP Evaluations view and the user asks which evaluations are shown, call mcplab_list_evaluation_configs using its suiteFilter (without the suite: prefix), searchQuery, sortBy, and sortDirection before answering.',
    'For an explicit request to run an evaluation, use queue_evaluation_run only when the Run Evaluation page is open with the requested configuration selected. It is confirmation-required and uses the existing app OAuth preflight and queue lifecycle. Do not use mcplab_run_eval: that MCP tool is reserved for external MCP clients.',
    'When the user asks to create a Test Case, draft it first with mcplab_generate_scenario_entry, then request the confirmation-required create_test_case frontend action. Do not give manual filesystem instructions or call mcplab_create_test_case; that MCP tool is for external MCP clients.',
    'Never claim that a write, evaluation run, or tool analysis job happened until its confirmed action succeeds.',
    'Use concise, practical answers.',
    `Current application context: ${JSON.stringify(context ?? {})}`
  ].join('\n');
}

/**
 * The current context must be the first system message. Anthropic uses the
 * first system message as its provider-level system prompt, while OpenAI only
 * receives system text included in the message list. Persisted tool results
 * are represented as later system messages, so they must never get precedence.
 */
export function toGlobalCopilotConversationMessages(input: RunAgentInput): LlmMessage[] {
  return [
    {
      role: 'system',
      content: globalCopilotSystemPrompt((input.forwardedProps as any)?.context)
    },
    ...toGlobalCopilotLlmMessages(input)
  ];
}

function localMcplabMcpUrl(): string {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = process.env.MCP_PORT || '3011';
  return `http://${host}:${port}${process.env.MCP_PATH || '/mcp'}`;
}

export function globalCopilotExternalServers(
  libraries: ReturnType<typeof readLibraries>,
  activeTestCaseId: string | undefined
): Record<
  string,
  { transport: 'http'; url: string; headers?: Record<string, string>; auth?: unknown }
> {
  if (!activeTestCaseId) return {};
  const scenario = libraries.scenarios.find((item: any) => item.id === activeTestCaseId) as any;
  if (!scenario) return {};
  const entries = scenario.mcp_servers ?? (scenario.servers ?? []).map((ref: string) => ({ ref }));
  return entries.reduce((servers: Record<string, any>, entry: any) => {
    if (entry?.ref && libraries.servers[entry.ref])
      servers[entry.ref] = libraries.servers[entry.ref];
    else if (entry?.id && entry.transport === 'http' && entry.url) {
      const { id, ...config } = entry;
      servers[id] = config;
    }
    return servers;
  }, {});
}

async function loadMcplabTools(): Promise<{
  mcp: McpClientManager;
  tools: ToolDef[];
  mapping: Map<string, { server: string; tool: string; autoApprove: boolean }>;
}> {
  const mcp = new McpClientManager();
  await mcp.connectAll({ mcplab: { transport: 'http', url: localMcplabMcpUrl() } });
  const mapping = new Map<string, { server: string; tool: string; autoApprove: boolean }>();
  const usedNames = new Set<string>();
  const tools = (await mcp.listTools('mcplab')).flatMap((tool) => {
    const policy = globalCopilotMcplabToolPolicy(tool.name);
    if (!policy.expose) return [];
    const publicName = makeAssistantToolPublicName('mcplab', tool.name, usedNames);
    mapping.set(publicName, { server: 'mcplab', tool: tool.name, autoApprove: policy.automatic });
    return [{ ...tool, name: publicName }];
  });
  return { mcp, tools, mapping };
}

async function loadGlobalCopilotTools(
  externalServers: Record<
    string,
    { transport: 'http'; url: string; headers?: Record<string, string>; auth?: unknown }
  >
): Promise<{
  mcp: McpClientManager;
  tools: ToolDef[];
  mapping: Map<string, { server: string; tool: string; autoApprove: boolean }>;
}> {
  const loaded = await loadMcplabTools();
  const usedNames = new Set(loaded.mapping.keys());
  for (const [serverName, server] of Object.entries(externalServers)) {
    try {
      await loaded.mcp.connectAll({ [serverName]: server as any });
      for (const tool of await loaded.mcp.listTools(serverName)) {
        const publicName = makeAssistantToolPublicName(serverName, tool.name, usedNames);
        loaded.mapping.set(publicName, { server: serverName, tool: tool.name, autoApprove: false });
        loaded.tools.push({
          ...tool,
          name: publicName,
          description: `${
            tool.description ?? ''
          }\n[External MCP server: requires confirmation before every call.]`.trim()
        });
      }
    } catch {
      // A failed external server must not prevent normal MCPLab help from working.
    }
  }
  return loaded;
}

function sendEvent(res: ServerResponse, encoder: EventEncoder, event: any): void {
  res.write(encoder.encodeSSE(event));
}

export function globalCopilotMcpToolErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !(result as { isError?: unknown }).isError) {
    return undefined;
  }
  const text = (result as { content?: unknown }).content;
  if (!Array.isArray(text)) return 'The MCP tool reported an error.';
  const messages = text
    .filter(
      (item): item is { type: 'text'; text: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string'
    )
    .map((item) => item.text.trim())
    .filter(Boolean);
  return messages.join('\n') || 'The MCP tool reported an error.';
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
      error:
        'No Global Copilot agent is configured. Add an agent in Libraries > Agents or configure it in Settings.'
    });
    return;
  }

  const encoder = new EventEncoder({ accept: String(req.headers.accept ?? '') });
  res.statusCode = 200;
  res.setHeader('content-type', encoder.getContentType());
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  if ('flushHeaders' in res && typeof res.flushHeaders === 'function') res.flushHeaders();
  const toolMessageId = randomUUID();
  const finalMessageId = randomUUID();
  try {
    sendEvent(res, encoder, {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId
    });
    const context = (input.forwardedProps as any)?.context;
    const activeTestCaseId = context?.activeTestCaseId;
    const loaded = await loadGlobalCopilotTools(
      globalCopilotExternalServers(libraries, activeTestCaseId)
    ).catch(() => undefined);
    const messages = toGlobalCopilotConversationMessages(input);
    const frontendTools = globalCopilotFrontendTools(context).filter(
      (tool) =>
        !['navigate_to_view', 'open_test_case', 'open_result_detail'].includes(tool.name) ||
        isExplicitGlobalCopilotNavigationRequest(messages)
    );
    let response = await chatWithAgent({
      agent: agent as AgentConfig,
      messages,
      tools: [...frontendTools, ...(loaded?.tools ?? [])]
    });
    let pendingApproval = false;
    let suggestedRunId: string | undefined;
    for (
      let toolTurn = 0;
      response.tool_calls?.length && toolTurn < GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE;
      toolTurn += 1
    ) {
      const call = response.tool_calls[0]!;
      if (
        call.name === 'navigate_to_view' ||
        call.name === 'open_test_case' ||
        call.name === 'open_result_detail' ||
        call.name === 'start_evaluation_run' ||
        call.name === 'queue_evaluation_run' ||
        call.name === 'start_tool_analysis' ||
        GLOBAL_COPILOT_LIBRARY_ACTION_NAMES.has(call.name)
      ) {
        const toolCallId = call.id ?? randomUUID();
        sendEvent(res, encoder, {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: call.name,
          parentMessageId: toolMessageId
        });
        sendEvent(res, encoder, {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: JSON.stringify(call.arguments ?? {})
        });
        sendEvent(res, encoder, { type: EventType.TOOL_CALL_END, toolCallId });
        response = {
          ...response,
          content: globalCopilotActionContent(
            call.name === 'navigate_to_view'
              ? { kind: 'navigate_to_view', ...(call.arguments ?? {}) }
              : call.name === 'open_test_case'
                ? { kind: 'open_test_case', ...(call.arguments ?? {}) }
                : call.name === 'open_result_detail'
                  ? { kind: 'navigate_to_result_detail', ...(call.arguments ?? {}) }
                : GLOBAL_COPILOT_LIBRARY_ACTION_NAMES.has(call.name)
                ? { kind: 'library_action', name: call.name, arguments: call.arguments ?? {} }
              : { kind: 'start_action', name: call.name, arguments: call.arguments ?? {} }
          )
        };
        pendingApproval = true;
        break;
      } else {
        const tool = loaded?.mapping.get(call.name);
        if (tool && loaded && tool.autoApprove) {
          const arguments_ = call.arguments ?? {};
          if (typeof (arguments_ as Record<string, unknown>).run_id === 'string') {
            suggestedRunId = (arguments_ as Record<string, string>).run_id;
          }
          const toolCallId = call.id ?? randomUUID();
          sendEvent(res, encoder, {
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: call.name,
            parentMessageId: toolMessageId
          });
          sendEvent(res, encoder, {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: JSON.stringify(call.arguments ?? {})
          });
          sendEvent(res, encoder, { type: EventType.TOOL_CALL_END, toolCallId });
          const result = await loaded.mcp.callTool(tool.server, tool.tool, call.arguments ?? {});
          const content = truncateJson(result, 4000);
          sendEvent(res, encoder, {
            type: EventType.TOOL_CALL_RESULT,
            messageId: randomUUID(),
            toolCallId,
            content
          });
          messages.push({
            role: 'assistant',
            content: response.content ?? '',
            tool_calls: [{ id: toolCallId, name: call.name, arguments: call.arguments ?? {} }]
          });
          messages.push({ role: 'tool', content, tool_call_id: toolCallId, name: call.name });
          response = await chatWithAgent({
            agent: agent as AgentConfig,
            messages,
            tools: [...frontendTools, ...loaded.tools]
          });
          continue;
        }
        const toolCallId = call.id ?? randomUUID();
        sendEvent(res, encoder, {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: call.name,
          parentMessageId: toolMessageId
        });
        sendEvent(res, encoder, {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: JSON.stringify(call.arguments ?? {})
        });
        sendEvent(res, encoder, { type: EventType.TOOL_CALL_END, toolCallId });
        response = {
          ...response,
          content: globalCopilotActionContent({
            ...(tool?.server === 'mcplab' && tool.tool === GLOBAL_COPILOT_RUN_EVALUATION_TOOL
              ? { kind: 'run_mcp_evaluation' }
              : tool?.server === 'mcplab' && tool.tool === GLOBAL_COPILOT_WRITE_MARKDOWN_REPORT_TOOL
              ? { kind: 'write_markdown_report' }
              : {
                  kind: 'external_mcp_tool',
                  serverName: tool?.server,
                  toolName: tool?.tool
                }),
            arguments: call.arguments ?? {}
          })
        };
        pendingApproval = true;
        break;
      }
    }
    if (response.tool_calls?.length && !pendingApproval) {
      const toolCallId = randomUUID();
      sendEvent(res, encoder, {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: 'request_additional_read_tools',
        parentMessageId: toolMessageId
      });
      sendEvent(res, encoder, {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify({ batchSize: GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE })
      });
      sendEvent(res, encoder, { type: EventType.TOOL_CALL_END, toolCallId });
      response = {
        content: globalCopilotActionContent({
          kind: 'continue_reading',
          batchSize: GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE
        }),
        tool_calls: [
          {
            id: toolCallId,
            name: 'request_additional_read_tools',
            arguments: { batchSize: GLOBAL_COPILOT_AUTOMATIC_READ_TOOL_BATCH_SIZE }
          }
        ]
      };
    }
    await loaded?.mcp.disconnectAll();
    const text =
      response.content?.trim() ||
      (response.tool_calls?.length
        ? 'This action needs your approval before I can continue.'
        : 'I could not produce a response.');
    sendEvent(res, encoder, {
      type: EventType.TEXT_MESSAGE_START,
      messageId: finalMessageId,
      role: 'assistant'
    });
    sendEvent(res, encoder, {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: finalMessageId,
      delta: text
    });
    sendEvent(res, encoder, { type: EventType.TEXT_MESSAGE_END, messageId: finalMessageId });
    if (suggestedRunId && !pendingApproval && !text.startsWith(GLOBAL_COPILOT_ACTION_MARKER)) {
      const suggestionMessageId = randomUUID();
      sendEvent(res, encoder, {
        type: EventType.TEXT_MESSAGE_START,
        messageId: suggestionMessageId,
        role: 'assistant'
      });
      sendEvent(res, encoder, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: suggestionMessageId,
        delta: globalCopilotActionContent({ kind: 'open_result_detail', runId: suggestedRunId })
      });
      sendEvent(res, encoder, { type: EventType.TEXT_MESSAGE_END, messageId: suggestionMessageId });
    }
    sendEvent(res, encoder, {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId
    });
  } catch (error: unknown) {
    sendEvent(res, encoder, {
      type: EventType.RUN_ERROR,
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    res.end();
  }
}

export async function handleGlobalCopilotRunEvaluationConfirmation(params: {
  req: IncomingMessage;
  res: ServerResponse;
  parseBody: (req: IncomingMessage) => Promise<any>;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
}): Promise<void> {
  const body = (await params.parseBody(params.req)) as Record<string, unknown>;
  const arguments_ =
    body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
      ? body.arguments
      : {};
  const mcp = new McpClientManager();
  try {
    await mcp.connectAll({ mcplab: { transport: 'http', url: localMcplabMcpUrl() } });
    const knownTool = (await mcp.listTools('mcplab')).find(
      (tool) => tool.name === GLOBAL_COPILOT_RUN_EVALUATION_TOOL
    );
    if (!knownTool) {
      params.asJson(params.res, 400, { error: 'The local MCPLab evaluation tool is unavailable.' });
      return;
    }
    const result = await mcp.callTool('mcplab', GLOBAL_COPILOT_RUN_EVALUATION_TOOL, arguments_);
    const toolError = globalCopilotMcpToolErrorMessage(result);
    if (toolError) {
      params.asJson(params.res, 502, { error: toolError });
      return;
    }
    const runId = (result as any)?.structuredContent?.metadata?.run_id;
    params.asJson(params.res, 200, {
      content: truncateJson(result, 4000),
      ...(typeof runId === 'string' ? { runId } : {})
    });
  } catch (error: unknown) {
    params.asJson(params.res, 502, {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await mcp.disconnectAll().catch(() => undefined);
  }
}

export async function handleGlobalCopilotMarkdownReportWriteConfirmation(params: {
  req: IncomingMessage;
  res: ServerResponse;
  parseBody: (req: IncomingMessage) => Promise<any>;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
}): Promise<void> {
  const body = (await params.parseBody(params.req)) as Record<string, unknown>;
  const arguments_ =
    body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
      ? body.arguments
      : {};
  const mcp = new McpClientManager();
  try {
    await mcp.connectAll({ mcplab: { transport: 'http', url: localMcplabMcpUrl() } });
    const knownTool = (await mcp.listTools('mcplab')).find(
      (tool) => tool.name === GLOBAL_COPILOT_WRITE_MARKDOWN_REPORT_TOOL
    );
    if (!knownTool) {
      params.asJson(params.res, 400, {
        error: 'The local MCPLab Markdown report tool is unavailable.'
      });
      return;
    }
    const result = await mcp.callTool(
      'mcplab',
      GLOBAL_COPILOT_WRITE_MARKDOWN_REPORT_TOOL,
      arguments_
    );
    const toolError = globalCopilotMcpToolErrorMessage(result);
    if (toolError) {
      params.asJson(params.res, 502, { error: toolError });
      return;
    }
    params.asJson(params.res, 200, { content: truncateJson(result, 4000) });
  } catch (error: unknown) {
    params.asJson(params.res, 502, {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await mcp.disconnectAll().catch(() => undefined);
  }
}

export async function handleGlobalCopilotToolConfirmation(params: {
  req: IncomingMessage;
  res: ServerResponse;
  settings: AppSettings;
  parseBody: (req: IncomingMessage) => Promise<any>;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
}): Promise<void> {
  const body = (await params.parseBody(params.req)) as Record<string, unknown>;
  const activeTestCaseId =
    typeof body.activeTestCaseId === 'string' ? body.activeTestCaseId : undefined;
  const serverName = typeof body.serverName === 'string' ? body.serverName : undefined;
  const toolName = typeof body.toolName === 'string' ? body.toolName : undefined;
  const arguments_ =
    body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
      ? body.arguments
      : {};
  if (!activeTestCaseId || !serverName || !toolName) {
    params.asJson(params.res, 400, {
      error: 'A test case, server, and tool are required for confirmation.'
    });
    return;
  }
  const libraries = readLibraries(params.settings.librariesDir);
  const server = globalCopilotExternalServers(libraries, activeTestCaseId)[serverName];
  if (!server) {
    params.asJson(params.res, 400, {
      error: 'The requested MCP server is not configured for the active test case.'
    });
    return;
  }
  const mcp = new McpClientManager();
  try {
    await mcp.connectAll({ [serverName]: server as any });
    const knownTool = (await mcp.listTools(serverName)).find((tool) => tool.name === toolName);
    if (!knownTool) {
      params.asJson(params.res, 400, {
        error: 'The requested MCP tool is not available from the active test-case server.'
      });
      return;
    }
    const result = await mcp.callTool(serverName, toolName, arguments_);
    const toolError = globalCopilotMcpToolErrorMessage(result);
    if (toolError) {
      params.asJson(params.res, 502, { error: toolError });
      return;
    }
    params.asJson(params.res, 200, { content: truncateJson(result, 4000) });
  } catch (error: unknown) {
    params.asJson(params.res, 502, {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await mcp.disconnectAll().catch(() => undefined);
  }
}
