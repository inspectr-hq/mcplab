import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatResult } from '@langchain/core/outputs';
import { createMiddleware, type AgentMiddleware } from 'langchain';
import {
  AgentConnectionError,
  anthropicModelCandidates,
  isAbortError,
  isModelNotFound,
  isUnsupportedTemperatureError,
  resolveAzureFoundryConnection,
  resolveAzureOpenAIDeployment,
  type LlmAgentConfig,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_AZURE_OPENAI_API_VERSION
} from '@inspectr/mcplab-core';
import type { AssistantRuntimeDefinition } from './assistant-runtime-contract.js';

export interface AssistantChatModelOptions {
  /** Attached to every model instance so streamed tokens reach the runtime exactly once. */
  callbacks: BaseCallbackHandler[];
  /** Compatibility retries are only safe before any text has been shown to the user. */
  hasStreamedText(): boolean;
}

export interface AssistantChatModelSetup {
  model: BaseChatModel;
  middleware: AgentMiddleware[];
}

export type AssistantChatModelFactory = (
  definition: AssistantRuntimeDefinition,
  options: AssistantChatModelOptions
) => AssistantChatModelSetup | Promise<AssistantChatModelSetup>;

interface ModelVariant {
  anthropicModel?: string;
  /** OpenAI reasoning models use the Responses API, which returns reasoning summaries. */
  openaiReasoning?: boolean;
  azureTokenField: 'max_completion_tokens' | 'max_tokens';
  includeTemperature: boolean;
}

/**
 * Production models: MCPlab provider configuration on standard LangChain chat models. The
 * concrete model is chosen per call by middleware, so missing credentials surface on the first
 * message (as before) and provider compatibility fallbacks stay out of the agent loop.
 */
export const createAssistantChatModel: AssistantChatModelFactory = (definition, options) => ({
  model: new UnresolvedAssistantChatModel(),
  middleware: [providerModelMiddleware(definition.agent, options)]
});

function providerModelMiddleware(agent: LlmAgentConfig, options: AssistantChatModelOptions) {
  const cache = new Map<string, Promise<BaseChatModel>>();
  const modelFor = (variant: ModelVariant) => {
    const key = JSON.stringify(variant);
    let model = cache.get(key);
    if (!model) {
      model = buildChatModel(agent, variant, options.callbacks);
      model.catch(() => cache.delete(key));
      cache.set(key, model);
    }
    return model;
  };
  const anthropicCandidates =
    agent.provider === 'anthropic' ? anthropicModelCandidates(agent.model) : [];

  return createMiddleware({
    name: 'McplabProviderModel',
    wrapModelCall: async (request, handler) => {
      let variant: ModelVariant = {
        ...(anthropicCandidates.length ? { anthropicModel: anthropicCandidates[0] } : {}),
        ...(agent.provider === 'openai' && isOpenAIReasoningModel(agent.model)
          ? { openaiReasoning: true }
          : {}),
        azureTokenField: 'max_completion_tokens',
        includeTemperature: typeof agent.temperature === 'number'
      };
      for (;;) {
        const model = await modelFor(variant);
        try {
          return await handler({ ...request, model });
        } catch (error) {
          if (isAbortError(error) || options.hasStreamedText()) throw error;
          const next = nextVariant(agent, variant, error, anthropicCandidates);
          if (!next) throw error;
          variant = next;
        }
      }
    }
  });
}

function nextVariant(
  agent: LlmAgentConfig,
  variant: ModelVariant,
  error: unknown,
  anthropicCandidates: string[]
): ModelVariant | undefined {
  // Some models (reasoning models, newer Claude models) reject temperature outright.
  if (variant.includeTemperature && isUnsupportedTemperatureError(error))
    return { ...variant, includeTemperature: false };
  if (agent.provider === 'anthropic') {
    if (!isAnthropicModelNotFound(error)) return undefined;
    const index = anthropicCandidates.indexOf(variant.anthropicModel ?? '');
    const anthropicModel = anthropicCandidates[index + 1];
    if (!anthropicModel) throw anthropicModelNotFound(agent.model, anthropicCandidates);
    return { ...variant, anthropicModel };
  }
  if (agent.provider === 'openai') {
    const message = errorMessage(error).toLowerCase();
    // Fall back to Chat Completions if a model rejects the reasoning settings.
    return variant.openaiReasoning &&
      message.includes('reasoning') &&
      (message.includes('not supported') || message.includes('unsupported'))
      ? { ...variant, openaiReasoning: false }
      : undefined;
  }
  if (agent.provider !== 'azure_openai' && agent.provider !== 'azure_foundry') return undefined;
  const message = errorMessage(error).toLowerCase();
  if (
    variant.azureTokenField === 'max_completion_tokens' &&
    agent.max_tokens !== undefined &&
    message.includes('max_completion_tokens') &&
    message.includes('not supported')
  )
    return { ...variant, azureTokenField: 'max_tokens' };
  return undefined;
}

/** The OpenAI models that reason, matching @langchain/openai's own check. */
export function isOpenAIReasoningModel(model: string): boolean {
  const name = model.trim();
  return (
    /^o\d/.test(name) ||
    (name.startsWith('gpt-5') && !name.startsWith('gpt-5-chat')) ||
    (name.startsWith('gpt-6') && !name.startsWith('gpt-6-chat'))
  );
}

async function buildChatModel(
  agent: LlmAgentConfig,
  variant: ModelVariant,
  callbacks: BaseCallbackHandler[]
): Promise<BaseChatModel> {
  if (agent.provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AgentConnectionError('missing_credentials', 'Missing OPENAI_API_KEY');
    if (variant.openaiReasoning) {
      const { ChatOpenAIResponses } = await import('@langchain/openai');
      return new ChatOpenAIResponses({
        apiKey,
        model: agent.model,
        temperature: variant.includeTemperature ? agent.temperature : undefined,
        maxTokens: agent.max_tokens,
        maxRetries: 0,
        configuration: { maxRetries: 0 },
        callbacks,
        reasoning: { summary: 'auto' },
        // Keep responses out of OpenAI storage; reasoning is replayed encrypted between calls.
        zdrEnabled: true,
        modelKwargs: { include: ['reasoning.encrypted_content'] }
      });
    }
    const { ChatOpenAICompletions } = await import('@langchain/openai');
    return new ChatOpenAICompletions({
      apiKey,
      model: agent.model,
      temperature: variant.includeTemperature ? agent.temperature : undefined,
      maxTokens: agent.max_tokens,
      maxRetries: 0,
      configuration: { maxRetries: 0 },
      callbacks
    });
  }
  if (agent.provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AgentConnectionError('missing_credentials', 'Missing ANTHROPIC_API_KEY');
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({
      apiKey,
      model: variant.anthropicModel ?? agent.model,
      temperature: variant.includeTemperature ? agent.temperature : undefined,
      maxTokens: agent.max_tokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
      maxRetries: 0,
      clientOptions: { maxRetries: 0 },
      callbacks
    });
  }
  if (agent.provider === 'azure_openai') {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deployment = resolveAzureOpenAIDeployment(agent.model);
    if (!apiKey)
      throw new AgentConnectionError('missing_credentials', 'Missing AZURE_OPENAI_API_KEY');
    if (!endpoint)
      throw new AgentConnectionError('missing_credentials', 'Missing AZURE_OPENAI_ENDPOINT');
    if (!deployment)
      throw new AgentConnectionError('deployment', 'Missing AZURE_OPENAI_DEPLOYMENT');
    return buildAzureModel({
      apiKey,
      baseURL: `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}`,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? DEFAULT_AZURE_OPENAI_API_VERSION,
      model: deployment,
      agent,
      variant,
      callbacks
    });
  }
  if (agent.provider === 'azure_foundry') {
    const deployment = agent.model.trim();
    if (!deployment) throw new Error('Azure Foundry requires a deployment name for this agent.');
    const connection = resolveAzureFoundryConnection();
    return buildAzureModel({
      apiKey: connection.apiKey,
      baseURL: `${connection.endpoint}/openai/v1`,
      model: deployment,
      agent,
      variant,
      callbacks
    });
  }
  throw new Error(`Unsupported provider: ${agent.provider}`);
}

async function buildAzureModel(params: {
  apiKey: string;
  baseURL: string;
  apiVersion?: string;
  model: string;
  agent: LlmAgentConfig;
  variant: ModelVariant;
  callbacks: BaseCallbackHandler[];
}): Promise<BaseChatModel> {
  const { ChatOpenAICompletions } = await import('@langchain/openai');
  const tokenField = params.variant.azureTokenField;
  // Azure deployments are sent max_completion_tokens first, regardless of model naming.
  class AzureAssistantChatOpenAI extends ChatOpenAICompletions {
    override invocationParams(
      options?: this['ParsedCallOptions'],
      extra?: { streaming?: boolean }
    ) {
      const invocation = super.invocationParams(options, extra);
      if (typeof this.maxTokens === 'number') {
        delete invocation.max_tokens;
        delete invocation.max_completion_tokens;
        invocation[tokenField] = this.maxTokens;
      }
      return invocation;
    }
  }
  return new AzureAssistantChatOpenAI({
    apiKey: params.apiKey,
    model: params.model,
    temperature: params.variant.includeTemperature ? params.agent.temperature : undefined,
    maxTokens: params.agent.max_tokens,
    maxRetries: 0,
    configuration: {
      baseURL: params.baseURL,
      defaultQuery: params.apiVersion ? { 'api-version': params.apiVersion } : undefined,
      maxRetries: 0
    },
    callbacks: params.callbacks
  });
}

/** Placeholder required by createAgent; the provider middleware always supplies the real model. */
class UnresolvedAssistantChatModel extends BaseChatModel {
  constructor() {
    super({});
  }

  _llmType() {
    return 'mcplab-unresolved';
  }

  bindTools() {
    return this as never;
  }

  async _generate(): Promise<ChatResult> {
    throw new Error('Assistant model was not resolved by the provider middleware');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
