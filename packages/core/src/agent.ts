import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentConfig,
  ExecutableScenario,
  LlmMessage,
  LlmResponse,
  ToolCall,
  ToolDef,
  TraceMessage,
  TraceMessageContentBlock,
  TraceMessageUsage
} from './types.js';
import type { McpClientManager } from './mcp.js';

export interface AgentRunResult {
  finalText: string;
  toolSequence: string[];
  toolDurationsMs: number[];
  traceMessages: TraceMessage[];
  traceStartedAt: string;
  traceEndedAt: string;
  traceProvider: string;
  traceModel: string;
}

export type AgentRunProgressEvent =
  | {
      type: 'llm_request_started';
      scenarioId: string;
      agentName: string;
      provider: string;
      model: string;
      turn: number;
    }
  | {
      type: 'llm_response_received';
      scenarioId: string;
      agentName: string;
      provider: string;
      model: string;
      turn: number;
      hasText: boolean;
      toolCallCount: number;
    }
  | {
      type: 'tool_call_started';
      scenarioId: string;
      agentName: string;
      server: string;
      tool: string;
      turn: number;
    }
  | {
      type: 'tool_call_finished';
      scenarioId: string;
      agentName: string;
      server: string;
      tool: string;
      turn: number;
      ok: boolean;
      durationMs: number;
    }
  | {
      type: 'final_answer';
      scenarioId: string;
      agentName: string;
      turn: number;
      hasText: boolean;
    };

interface LlmAdapter {
  chat(messages: LlmMessage[], tools: ToolDef[], options: AdapterOptions): Promise<LlmResponse>;
}

interface AdapterOptions {
  model: string;
  temperature?: number;
  max_tokens?: number;
  system?: string;
}

export async function runAgentScenario(params: {
  scenario: ExecutableScenario;
  agent: AgentConfig;
  mcp: McpClientManager;
  requestId?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  onProgress?: (event: AgentRunProgressEvent) => void | Promise<void>;
}): Promise<AgentRunResult> {
  const { scenario, agent, mcp } = params;
  const toolsByName = new Map<string, { server: string; tool: ToolDef }>();
  for (const serverName of scenario.servers) {
    const tools = await mcp.listTools(serverName);
    for (const tool of tools) {
      if (toolsByName.has(tool.name)) {
        throw new Error(`Duplicate tool name across servers: ${tool.name}`);
      }
      toolsByName.set(tool.name, { server: serverName, tool });
    }
  }
  const tools = Array.from(toolsByName.values()).map((entry) => entry.tool);

  const adapter = createAdapter(agent);
  const messages: LlmMessage[] = [];
  if (agent.system) {
    messages.push({ role: 'system', content: agent.system });
  }
  messages.push({ role: 'user', content: scenario.prompt });
  const traceMessages: TraceMessage[] = [
    {
      role: 'user',
      ts: new Date().toISOString(),
      content: [{ type: 'text', text: scenario.prompt }]
    }
  ];
  const traceStartedAt = new Date().toISOString();

  const toolSequence: string[] = [];
  const toolDurationsMs: number[] = [];
  let finalText = '';
  const maxTurns = params.maxTurns ?? 15;
  const emitProgress = async (event: AgentRunProgressEvent): Promise<void> => {
    if (!params.onProgress) return;
    await params.onProgress(event);
  };
  let finalAnswerTurn = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    await emitProgress({
      type: 'llm_request_started',
      scenarioId: scenario.id,
      agentName: scenario.agent,
      provider: agent.provider,
      model: agent.model,
      turn
    });
    const response = await adapter.chat(messages, tools, {
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      system: agent.system
    });

    const responseText = truncate((response.content ?? '').trim(), 4000);
    const toolCallNames = response.tool_calls?.map((call) => call.name) ?? [];
    await emitProgress({
      type: 'llm_response_received',
      scenarioId: scenario.id,
      agentName: scenario.agent,
      provider: agent.provider,
      model: agent.model,
      turn,
      hasText: responseText.length > 0,
      toolCallCount: toolCallNames.length
    });
    if (response.tool_calls && response.tool_calls.length > 0) {
      const assistantBlocks: TraceMessageContentBlock[] = [];
      if (responseText) assistantBlocks.push({ type: 'text', text: responseText });
      const resolvedToolCalls = response.tool_calls.map((toolCall, index) => {
        const resolved = toolsByName.get(toolCall.name);
        if (!resolved) {
          throw new Error(`Tool not found: ${toolCall.name}`);
        }
        const toolUseId = toolCall.id ?? `tool_use_${turn}_${index}`;
        assistantBlocks.push({
          type: 'tool_use',
          id: toolUseId,
          name: toolCall.name,
          input: toolCall.arguments,
          server: resolved.server
        });
        return { toolCall, resolved, toolUseId };
      });
      traceMessages.push({
        role: 'assistant',
        ts: new Date().toISOString(),
        usage: toTraceUsage(response.usage),
        content: assistantBlocks
      });
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.tool_calls
      });
      const toolResultBlocks: TraceMessageContentBlock[] = [];
      for (const { toolCall, resolved, toolUseId } of resolvedToolCalls) {
        await emitProgress({
          type: 'tool_call_started',
          scenarioId: scenario.id,
          agentName: scenario.agent,
          server: resolved.server,
          tool: toolCall.name,
          turn
        });
        const tsStart = new Date();

        let ok = true;
        let result: any;
        try {
          result = await mcp.callTool(resolved.server, toolCall.name, toolCall.arguments, {
            requestHeaders: params.requestId ? { 'x-request-id': params.requestId } : undefined
          });
        } catch (err: any) {
          ok = false;
          result = { error: String(err?.message ?? err) };
        }

        const tsEnd = new Date();
        const durationMs = tsEnd.getTime() - tsStart.getTime();
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          name: toolCall.name,
          server: resolved.server,
          is_error: !ok,
          duration_ms: durationMs,
          ts_start: tsStart.toISOString(),
          ts_end: tsEnd.toISOString(),
          content: [
            {
              type: 'text',
              text: truncateToolResultContent(stringifySafe(result))
            }
          ]
        });
        await emitProgress({
          type: 'tool_call_finished',
          scenarioId: scenario.id,
          agentName: scenario.agent,
          server: resolved.server,
          tool: toolCall.name,
          turn,
          ok,
          durationMs
        });

        toolSequence.push(toolCall.name);
        toolDurationsMs.push(durationMs);

        messages.push({
          role: 'tool',
          content: stringifySafe(result),
          tool_call_id: toolCall.id ?? toolUseId,
          name: toolCall.name
        });
      }
      if (toolResultBlocks.length > 0) {
        traceMessages.push({
          role: 'tool',
          ts: new Date().toISOString(),
          content: toolResultBlocks
        });
      }
      continue;
    }

    if (response.content) {
      finalText = response.content;
      finalAnswerTurn = turn;
      traceMessages.push({
        role: 'assistant',
        ts: new Date().toISOString(),
        usage: toTraceUsage(response.usage),
        content: [{ type: 'text', text: truncate(finalText, 4000) }]
      });
    }
    break;
  }

  await emitProgress({
    type: 'final_answer',
    scenarioId: scenario.id,
    agentName: scenario.agent,
    turn: finalAnswerTurn,
    hasText: finalText.trim().length > 0
  });

  return {
    finalText,
    toolSequence,
    toolDurationsMs,
    traceMessages,
    traceStartedAt,
    traceEndedAt: new Date().toISOString(),
    traceProvider: agent.provider,
    traceModel: agent.model
  };
}

export async function chatWithAgent(params: {
  agent: AgentConfig;
  messages: LlmMessage[];
  tools?: ToolDef[];
  system?: string;
}): Promise<LlmResponse> {
  const { agent, messages } = params;
  const tools = params.tools ?? [];
  const adapter = createAdapter(agent);
  return adapter.chat(messages, tools, {
    model: agent.model,
    temperature: agent.temperature,
    max_tokens: agent.max_tokens,
    system: params.system ?? agent.system
  });
}

function createAdapter(agent: AgentConfig): LlmAdapter {
  if (agent.provider === 'openai') {
    return new OpenAiAdapter(process.env.OPENAI_API_KEY);
  }
  if (agent.provider === 'anthropic') {
    return new AnthropicAdapter(process.env.ANTHROPIC_API_KEY);
  }
  if (agent.provider === 'azure_openai') {
    return new AzureOpenAiAdapter({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION
    });
  }
  throw new Error(`Unsupported provider: ${agent.provider}`);
}

class OpenAiAdapter implements LlmAdapter {
  private client: OpenAI;

  constructor(apiKey?: string) {
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    this.client = new OpenAI({ apiKey });
  }

  async chat(
    messages: LlmMessage[],
    tools: ToolDef[],
    options: AdapterOptions
  ): Promise<LlmResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: messages.map(toOpenAiMessage),
      tools: tools.length > 0 ? (tools.map(toOpenAiTool) as any) : undefined,
      temperature: options.temperature,
      max_tokens: options.max_tokens
    });
    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((call: any) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeJsonParse(call.function.arguments)
    }));
    return {
      content: message?.content ?? '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      raw: response,
      usage: response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens
          }
        : undefined
    };
  }
}

class AzureOpenAiAdapter implements LlmAdapter {
  private client: OpenAI;
  private deployment: string;
  private apiVersion: string;

  constructor(params: {
    apiKey?: string;
    endpoint?: string;
    deployment?: string;
    apiVersion?: string;
  }) {
    const { apiKey, endpoint, deployment, apiVersion } = params;
    if (!apiKey) throw new Error('Missing AZURE_OPENAI_API_KEY');
    if (!endpoint) throw new Error('Missing AZURE_OPENAI_ENDPOINT');
    if (!deployment) throw new Error('Missing AZURE_OPENAI_DEPLOYMENT');
    this.deployment = deployment;
    this.apiVersion = apiVersion ?? '2024-02-15-preview';
    this.client = new OpenAI({
      apiKey,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { 'api-version': this.apiVersion }
    });
  }

  async chat(
    messages: LlmMessage[],
    tools: ToolDef[],
    options: AdapterOptions
  ): Promise<LlmResponse> {
    const baseRequest = {
      model: this.deployment,
      messages: messages.map(toOpenAiMessage),
      tools: tools.length > 0 ? (tools.map(toOpenAiTool) as any) : undefined
    } as any;
    if (typeof options.temperature === 'number') {
      baseRequest.temperature = options.temperature;
    }

    const createWithTemperatureFallback = async (request: any) => {
      try {
        return await this.client.chat.completions.create(request);
      } catch (err: any) {
        const message = String(err?.message ?? '');
        const unsupportedTemperature =
          message.includes('temperature') &&
          (message.includes('not supported') || message.includes('Only the default'));
        if (!unsupportedTemperature || !('temperature' in request)) throw err;
        const { temperature: _ignored, ...withoutTemperature } = request;
        return this.client.chat.completions.create(withoutTemperature as any);
      }
    };

    let response;
    if (typeof options.max_tokens === 'number') {
      try {
        response = await createWithTemperatureFallback({
          ...baseRequest,
          max_completion_tokens: options.max_tokens
        } as any);
      } catch (err: any) {
        const message = String(err?.message ?? '');
        const unsupportedMaxCompletionTokens =
          message.includes('max_completion_tokens') && message.includes('not supported');
        if (!unsupportedMaxCompletionTokens) throw err;
        response = await createWithTemperatureFallback({
          ...baseRequest,
          max_tokens: options.max_tokens
        } as any);
      }
    } else {
      response = await createWithTemperatureFallback(baseRequest as any);
    }

    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((call: any) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeJsonParse(call.function.arguments)
    }));
    return {
      content: message?.content ?? '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      raw: response,
      usage: response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens
          }
        : undefined
    };
  }
}

class AnthropicAdapter implements LlmAdapter {
  private client: Anthropic;

  constructor(apiKey?: string) {
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
  }

  async chat(
    messages: LlmMessage[],
    tools: ToolDef[],
    options: AdapterOptions
  ): Promise<LlmResponse> {
    const system = messages.find((msg) => msg.role === 'system')?.content ?? options.system;
    const anthroMessages = toAnthropicMessages(messages);

    const response = await this.createWithModelFallback(options.model, {
      temperature: options.temperature,
      max_tokens: options.max_tokens ?? 1024,
      system,
      messages: anthroMessages,
      tools: tools.length > 0 ? (tools.map(toAnthropicTool) as any) : undefined
    });

    const toolCalls: ToolCall[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      }
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input
        });
      }
    }

    return {
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      raw: response,
      usage: response.usage
        ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            total_tokens:
              typeof response.usage.input_tokens === 'number' &&
              typeof response.usage.output_tokens === 'number'
                ? response.usage.input_tokens + response.usage.output_tokens
                : undefined
          }
        : undefined
    };
  }

  private async createWithModelFallback(
    model: string,
    payload: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, 'model'>
  ): Promise<Anthropic.Messages.Message> {
    const candidates = anthropicModelCandidates(model);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        return await this.client.messages.create({
          model: candidate,
          stream: false,
          ...payload
        });
      } catch (error) {
        lastError = error;
        if (!isModelNotFound(error) || candidate === candidates[candidates.length - 1]) {
          break;
        }
      }
    }

    if (isModelNotFound(lastError)) {
      const tried = candidates.join(', ');
      throw new Error(
        `Anthropic model not found: '${model}' (tried: ${tried}). Your API key is authenticated, but this model is not enabled/available for that Anthropic account. Update the agent model in Manage Agents/Config Editor to one your account can access.`
      );
    }
    throw lastError;
  }
}

function anthropicModelCandidates(model: string): string[] {
  const trimmed = model.trim();
  const out = [trimmed];
  const legacyWithDate = /^(claude-[\w.-]+)-\d{8}$/;
  const match = trimmed.match(legacyWithDate);
  if (match) {
    out.push(`${match[1]}-latest`);
  }
  return Array.from(new Set(out));
}

function isModelNotFound(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as {
    status?: number;
    message?: string;
    error?: { type?: string; message?: string };
  };
  const statusNotFound = anyErr.status === 404;
  const typeNotFound = anyErr.error?.type === 'not_found_error';
  const msg = `${anyErr.message ?? ''} ${anyErr.error?.message ?? ''}`.toLowerCase();
  return (
    statusNotFound || typeNotFound || (msg.includes('not_found_error') && msg.includes('model'))
  );
}

function toOpenAiTool(tool: ToolDef) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: ensureJsonSchema(tool.inputSchema) as any
    }
  };
}

function ensureJsonSchema(schema: unknown) {
  if (schema && typeof schema === 'object') {
    const hasType = Object.prototype.hasOwnProperty.call(schema, 'type');
    return hasType ? schema : { ...(schema as Record<string, unknown>), type: 'object' };
  }
  return { type: 'object', properties: {} };
}

function toOpenAiMessage(message: LlmMessage) {
  if (message.role === 'tool') {
    return {
      role: 'tool' as const,
      content: message.content,
      tool_call_id: message.tool_call_id ?? ''
    };
  }
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    return {
      role: 'assistant' as const,
      content: message.content ?? '',
      tool_calls: message.tool_calls.map((call) => ({
        id: call.id ?? '',
        type: 'function' as const,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {})
        }
      }))
    };
  }
  return {
    role: message.role,
    content: message.content
  };
}

function toAnthropicTool(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description ?? '',
    input_schema: ensureJsonSchema(tool.inputSchema)
  };
}

function toAnthropicMessages(
  messages: LlmMessage[]
): Array<{ role: 'user' | 'assistant'; content: any[] }> {
  const result: Array<{ role: 'user' | 'assistant'; content: any[] }> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.tool_call_id ?? 'unknown',
            content: message.content
          }
        ]
      });
      continue;
    }
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      const contentBlocks: any[] = [];
      if (message.content) {
        contentBlocks.push({ type: 'text', text: message.content });
      }
      message.tool_calls.forEach((call, index) => {
        contentBlocks.push({
          type: 'tool_use',
          id: call.id ?? `tool_use_${index}`,
          name: call.name,
          input: call.arguments ?? {}
        });
      });
      result.push({
        role: 'assistant',
        content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }]
      });
      continue;
    }
    result.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: message.content }]
    });
  }
  return result;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function truncateToolResultContent(value: string): string {
  return truncate(value, 12000);
}

function toTraceUsage(usage?: LlmResponse['usage']): TraceMessageUsage | undefined {
  if (!usage) return undefined;
  if (
    typeof usage.input_tokens !== 'number' &&
    typeof usage.output_tokens !== 'number' &&
    typeof usage.total_tokens !== 'number'
  ) {
    return undefined;
  }
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens
  };
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}...`;
}
