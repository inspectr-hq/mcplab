import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatOpenAICompletions, type ChatOpenAICompletionsCallOptions } from '@langchain/openai';
import {
  AgentConnectionError,
  anthropicModelCandidates,
  isModelNotFound,
  resolveAzureFoundryConnection,
  resolveAzureOpenAIDeployment,
  type AssistantRuntimeDefinition,
  type AssistantRuntimeModelOutput,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_AZURE_OPENAI_API_VERSION
} from '@inspectr/mcplab-core';
import { withAssistantTraceExportDisabled } from './assistant-tracing.js';

export type AssistantModelCall = (
  definition: AssistantRuntimeDefinition,
  messages: BaseMessage[],
  signal?: AbortSignal
) => Promise<AssistantModelOutput>;

export type AssistantModelOutput = AssistantRuntimeModelOutput & { nativeMessage?: AIMessage };

export const callAssistantModel: AssistantModelCall = (definition, messages, signal) =>
  withAssistantTraceExportDisabled(async () => {
    signal?.throwIfAborted();
    const history = [
      new SystemMessage(definition.getSystemPrompt()),
      ...messages.filter((message) => message.getType() !== 'system')
    ];
    const tools = assistantTools(definition);
    const agent = definition.agent;
    let response;

    if (agent.provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new AgentConnectionError('missing_credentials', 'Missing OPENAI_API_KEY');
      const model = new ChatOpenAICompletions({
        apiKey,
        model: agent.model,
        temperature: agent.temperature,
        maxTokens: agent.max_tokens,
        maxRetries: 0,
        configuration: { maxRetries: 0 }
      });
      response = await invoke(model, tools, history, signal);
    } else if (agent.provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey)
        throw new AgentConnectionError('missing_credentials', 'Missing ANTHROPIC_API_KEY');
      const candidates = anthropicModelCandidates(agent.model);
      let lastError: unknown;
      for (const candidate of candidates) {
        signal?.throwIfAborted();
        const model = new ChatAnthropic({
          apiKey,
          model: candidate,
          temperature: agent.temperature,
          maxTokens: agent.max_tokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
          maxRetries: 0,
          clientOptions: { maxRetries: 0 }
        });
        try {
          response = await invoke(model, tools, history, signal);
          break;
        } catch (error) {
          lastError = error;
          if (signal?.aborted || !isAnthropicModelNotFound(error)) throw error;
          if (candidate === candidates.at(-1))
            throw anthropicModelNotFound(agent.model, candidates);
        }
      }
      if (!response) {
        if (isAnthropicModelNotFound(lastError))
          throw anthropicModelNotFound(agent.model, candidates);
        throw lastError;
      }
    } else if (agent.provider === 'azure_openai') {
      const apiKey = process.env.AZURE_OPENAI_API_KEY;
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const deployment = resolveAzureOpenAIDeployment(agent.model);
      if (!apiKey)
        throw new AgentConnectionError('missing_credentials', 'Missing AZURE_OPENAI_API_KEY');
      if (!endpoint)
        throw new AgentConnectionError('missing_credentials', 'Missing AZURE_OPENAI_ENDPOINT');
      if (!deployment)
        throw new AgentConnectionError('deployment', 'Missing AZURE_OPENAI_DEPLOYMENT');
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? DEFAULT_AZURE_OPENAI_API_VERSION;
      response = await invokeAzure(
        {
          apiKey,
          endpoint: `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}`,
          apiVersion,
          model: deployment,
          maxTokens: agent.max_tokens,
          temperature: agent.temperature
        },
        tools,
        history,
        signal
      );
    } else if (agent.provider === 'azure_foundry') {
      const deployment = agent.model.trim();
      if (!deployment) throw new Error('Azure Foundry requires a deployment name for this agent.');
      const connection = resolveAzureFoundryConnection();
      response = await invokeAzure(
        {
          apiKey: connection.apiKey,
          endpoint: `${connection.endpoint}/openai/v1`,
          model: deployment,
          maxTokens: agent.max_tokens,
          temperature: agent.temperature
        },
        tools,
        history,
        signal
      );
    } else {
      throw new Error(`Unsupported provider: ${agent.provider}`);
    }

    return toAssistantOutput(response);
  });

async function invoke(
  model: ChatOpenAICompletions | ChatAnthropic,
  tools: ReturnType<typeof assistantTools>,
  messages: BaseMessage[],
  signal?: AbortSignal
) {
  const bound = bindTools(model, tools);
  return bound.invoke(messages, { signal, maxRetries: 0 });
}

function bindTools(
  model: ChatOpenAICompletions | ChatAnthropic,
  tools: ReturnType<typeof assistantTools>
) {
  if (!tools.length) return model;
  return model instanceof ChatAnthropic
    ? model.bindTools(tools as Parameters<ChatAnthropic['bindTools']>[0])
    : model.bindTools(tools as Parameters<ChatOpenAICompletions['bindTools']>[0]);
}

function assistantTools(definition: AssistantRuntimeDefinition) {
  return definition.tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: asJsonSchema(tool.inputSchema)
    }
  }));
}

async function invokeAzure(
  params: {
    apiKey: string;
    endpoint: string;
    apiVersion?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
  },
  tools: ReturnType<typeof assistantTools>,
  messages: BaseMessage[],
  signal?: AbortSignal
) {
  let tokenField: 'max_completion_tokens' | 'max_tokens' = 'max_completion_tokens';
  let includeTemperature = typeof params.temperature === 'number';
  for (;;) {
    signal?.throwIfAborted();
    const model = new AzureAssistantChatOpenAI({
      apiKey: params.apiKey,
      model: params.model,
      temperature: includeTemperature ? params.temperature : undefined,
      maxTokens: params.maxTokens,
      tokenField,
      maxRetries: 0,
      configuration: {
        baseURL: params.endpoint,
        defaultQuery: params.apiVersion ? { 'api-version': params.apiVersion } : undefined,
        maxRetries: 0
      }
    });
    try {
      const bound = bindTools(model, tools);
      return await bound.invoke(messages, { signal, maxRetries: 0 });
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = errorMessage(error).toLowerCase();
      if (
        tokenField === 'max_completion_tokens' &&
        params.maxTokens !== undefined &&
        message.includes('max_completion_tokens') &&
        message.includes('not supported')
      ) {
        tokenField = 'max_tokens';
        continue;
      }
      if (
        includeTemperature &&
        message.includes('temperature') &&
        (message.includes('not supported') || message.includes('only the default'))
      ) {
        includeTemperature = false;
        continue;
      }
      throw error;
    }
  }
}

class AzureAssistantChatOpenAI extends ChatOpenAICompletions {
  private readonly tokenField: 'max_completion_tokens' | 'max_tokens';

  constructor(
    fields: NonNullable<ConstructorParameters<typeof ChatOpenAICompletions>[0]> & {
      tokenField: 'max_completion_tokens' | 'max_tokens';
    }
  ) {
    // Azure deployment compatibility uses max_completion_tokens first, regardless of model naming.
    super(fields);
    this.tokenField = fields.tokenField;
  }

  invocationParams(options?: ChatOpenAICompletionsCallOptions, extra?: { streaming?: boolean }) {
    const params = super.invocationParams(options, extra);
    if (typeof this.maxTokens === 'number') {
      delete params.max_tokens;
      delete params.max_completion_tokens;
      params[this.tokenField] = this.maxTokens;
    }
    return params;
  }
}

function toAssistantOutput(message: AIMessage): AssistantModelOutput {
  const text = contentToText(message.content).trim();
  const toolCalls = message.tool_calls ?? [];
  const invalidCalls = message.invalid_tool_calls ?? [];
  if (toolCalls.length || invalidCalls.length) {
    const ordered: Array<{
      index: number;
      call: { id?: string; name: string; args: unknown; validationError?: string };
    }> = [];
    const rawCalls: unknown = message.additional_kwargs.tool_calls;
    const original: Array<Record<string, unknown>> = Array.isArray(rawCalls)
      ? rawCalls.filter(isRecord)
      : [];
    const consumedRaw = new Set<number>();
    const rawArguments = (item: Record<string, unknown>) => {
      const fn = isRecord(item.function) ? item.function : undefined;
      return typeof fn?.arguments === 'string'
        ? fn.arguments
        : typeof item.arguments === 'string'
          ? item.arguments
          : undefined;
    };
    const rawIndex = (id: string | undefined, name: string, args: unknown, rawArgs?: string) => {
      const candidates = original.flatMap((item, position) => {
        if (consumedRaw.has(position)) return [];
        const fn = isRecord(item.function) ? item.function : undefined;
        const rawName = typeof fn?.name === 'string' ? fn.name : item.name;
        const matchesIdentity = (id === undefined || item.id === id) && rawName === name;
        return matchesIdentity ? [{ item, position }] : [];
      });
      let candidate =
        rawArgs === undefined
          ? undefined
          : candidates.find(({ item }) => rawArguments(item) === rawArgs);
      if (!candidate && rawArgs === undefined) {
        candidate = candidates.find(({ item }) => {
          const raw = rawArguments(item);
          if (raw === undefined) return false;
          try {
            return JSON.stringify(JSON.parse(raw)) === JSON.stringify(args);
          } catch {
            return false;
          }
        });
      }
      candidate ??= candidates[0];
      const index = candidate?.position ?? -1;
      if (index >= 0) consumedRaw.add(index);
      return index;
    };
    for (const call of toolCalls) {
      const index = rawIndex(call.id, call.name, call.args);
      const objectArgs = isRecord(call.args);
      ordered.push({
        index,
        call: {
          id: call.id,
          name: call.name,
          args: objectArgs ? call.args : {},
          ...(!objectArgs
            ? {
                validationError: `Invalid arguments for tool '${call.name}': expected a JSON object.`
              }
            : {})
        }
      });
    }
    for (const invalid of invalidCalls) {
      const rawArgs = invalid.args ?? '';
      const matchedRawIndex = rawIndex(invalid.id, invalid.name ?? 'unknown', undefined, rawArgs);
      ordered.push({
        index:
          matchedRawIndex >= 0
            ? matchedRawIndex
            : Number(invalid.index ?? toolCalls.length + invalidCalls.indexOf(invalid)),
        call: {
          id: invalid.id,
          name: invalid.name ?? 'unknown',
          args: {},
          validationError: `Invalid arguments for tool '${invalid.name ?? 'unknown'}': ${invalid.error ?? 'malformed tool arguments'}${rawArgs ? ` (raw: ${rawArgs})` : ''}`
        }
      });
    }
    return {
      type: 'tool_call_request',
      text: text || 'I need a tool to help answer.',
      toolCalls: ordered
        .sort((a, b) => a.index - b.index)
        .map(({ call }) => ({
          id: call.id,
          name: call.name,
          arguments: call.args,
          ...(call.validationError ? { validationError: call.validationError } : {})
        })),
      nativeMessage: message as AIMessage
    };
  }
  return { type: 'assistant_message', text, nativeMessage: message as AIMessage };
}

function asJsonSchema(schema: unknown): Record<string, unknown> {
  if (isRecord(schema)) return { ...schema, type: schema.type ?? 'object' };
  return { type: 'object', properties: {}, additionalProperties: true };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAnthropicModelNotFound(error: unknown): boolean {
  if (!isModelNotFound(error) || !isRecord(error)) return false;
  let payload: unknown = error.error;
  while (isRecord(payload)) {
    if (typeof payload.message === 'string' && /\bmodel\b/i.test(payload.message)) return true;
    payload = payload.error;
  }
  return false;
}

function anthropicModelNotFound(model: string, candidates: string[]): Error {
  return new Error(
    `Anthropic model not found: '${model}' (tried: ${candidates.join(', ')}). Your API key is authenticated, but this model is not enabled/available for that Anthropic account. Update the agent model in Manage Agents/Config Editor to one your account can access.`
  );
}
