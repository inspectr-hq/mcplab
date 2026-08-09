import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentConfig } from '@inspectr/mcplab-core';
import { MastraAgent } from '@ag-ui/mastra';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint
} from '@copilotkit/runtime';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import type { MastraMemory } from '@mastra/core/memory';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { readLibraries } from './libraries-store.js';
import {
  globalCopilotSystemPrompt,
  selectGlobalCopilotAgentName
} from './global-copilot-domain.js';
import type { AppSettings } from './types.js';
import {
  buildGlobalCopilotMastraTools,
  GlobalCopilotMcpConnectionPool,
  type GlobalCopilotReadBudget
} from './global-copilot-mastra-tools.js';
import { getGlobalCopilotMemoryRuntime } from './global-copilot-memory.js';

export const GLOBAL_COPILOT_AGENT_ID = 'mcplab-global-copilot';

export type GlobalCopilotModelDescriptor = {
  provider: AgentConfig['provider'];
  model: string;
  temperature?: number;
  maxTokens?: number;
  system?: string;
};

export function globalCopilotModelDescriptor(
  agent: AgentConfig
): GlobalCopilotModelDescriptor {
  return {
    provider: agent.provider,
    model: agent.model,
    ...(agent.temperature === undefined ? {} : { temperature: agent.temperature }),
    ...(agent.max_tokens === undefined ? {} : { maxTokens: agent.max_tokens }),
    ...(agent.system === undefined ? {} : { system: agent.system })
  };
}

type ProviderEnvironment = Record<string, string | undefined>;

function requireEnvironment(environment: ProviderEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function validateGlobalCopilotProviderEnvironment(
  agent: AgentConfig,
  environment: ProviderEnvironment = process.env
): void {
  if (agent.provider === 'openai') {
    requireEnvironment(environment, 'OPENAI_API_KEY');
    return;
  }
  if (agent.provider === 'anthropic') {
    requireEnvironment(environment, 'ANTHROPIC_API_KEY');
    return;
  }
  requireEnvironment(environment, 'AZURE_OPENAI_API_KEY');
  requireEnvironment(environment, 'AZURE_OPENAI_ENDPOINT');
  requireEnvironment(environment, 'AZURE_OPENAI_DEPLOYMENT');
}

function azureOpenAIBaseUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, '');
  return normalized.endsWith('/openai') ? normalized : `${normalized}/openai`;
}

export function createGlobalCopilotLanguageModel(
  agent: AgentConfig,
  environment: ProviderEnvironment = process.env
): any {
  validateGlobalCopilotProviderEnvironment(agent, environment);
  if (agent.provider === 'openai') {
    return createOpenAI({ apiKey: requireEnvironment(environment, 'OPENAI_API_KEY') }).chat(
      agent.model
    );
  }
  if (agent.provider === 'anthropic') {
    return createAnthropic({ apiKey: requireEnvironment(environment, 'ANTHROPIC_API_KEY') })(
      agent.model
    );
  }
  const deployment = requireEnvironment(environment, 'AZURE_OPENAI_DEPLOYMENT');
  return createAzure({
    apiKey: requireEnvironment(environment, 'AZURE_OPENAI_API_KEY'),
    baseURL: azureOpenAIBaseUrl(requireEnvironment(environment, 'AZURE_OPENAI_ENDPOINT')),
    apiVersion: environment.AZURE_OPENAI_API_VERSION?.trim() || undefined,
    useDeploymentBasedUrls: true
  }).chat(deployment);
}

export function createGlobalCopilotMastraAgent(params: {
  agentConfig: AgentConfig;
  instructions: string | ((args: any) => string);
  resourceId: string;
  environment?: ProviderEnvironment;
  memory?: MastraMemory;
  storage?: MastraCompositeStore;
  tools?: any;
}): MastraAgent {
  const descriptor = globalCopilotModelDescriptor(params.agentConfig);
  const agent = new Agent({
    id: GLOBAL_COPILOT_AGENT_ID,
    name: 'MCPLab Global Copilot',
    instructions: params.instructions,
    model: createGlobalCopilotLanguageModel(params.agentConfig, params.environment),
    ...(params.memory ? { memory: params.memory } : {}),
    ...(params.tools ? { tools: params.tools } : {}),
    defaultOptions: {
      maxSteps: params.agentConfig.max_turns ?? 30,
      modelSettings: {
        ...(descriptor.temperature === undefined
          ? {}
          : { temperature: descriptor.temperature }),
        ...(descriptor.maxTokens === undefined
          ? {}
          : { maxOutputTokens: descriptor.maxTokens })
      }
    }
  });
  const registeredAgent = params.storage
    ? new Mastra({
        agents: { [GLOBAL_COPILOT_AGENT_ID]: agent },
        storage: params.storage
      }).getAgent(GLOBAL_COPILOT_AGENT_ID)
    : agent;
  return new MastraAgent({
    agent: registeredAgent,
    resourceId: params.resourceId,
    emitInterruptOutcome: true
  });
}

export function createGlobalCopilotRuntimeHandler(agent: MastraAgent) {
  const runtime = new CopilotRuntime({ agents: { [GLOBAL_COPILOT_AGENT_ID]: agent } });
  return copilotRuntimeNodeHttpEndpoint({
    endpoint: '/api/copilotkit',
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter()
  });
}

export function globalCopilotWorkspaceResourceId(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex');
}

export function globalCopilotContextFromAgUi(context: unknown): unknown {
  if (!Array.isArray(context)) return context;
  const entry = context.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item as { description?: unknown }).description === 'Current MCPLab application context'
  ) as { value?: unknown } | undefined;
  if (typeof entry?.value !== 'string') return entry?.value ?? {};
  try {
    return JSON.parse(entry.value);
  } catch {
    return {};
  }
}

export async function persistGlobalCopilotPendingInterrupts(params: {
  memory: MastraMemory;
  resourceId: string;
  agent: MastraAgent;
}): Promise<void> {
  const threadId = params.agent.threadId;
  if (!threadId) return;
  const thread = await params.memory.getThreadById({ threadId });
  if (!thread || thread.resourceId !== params.resourceId) return;
  await params.memory.updateThread({
    id: thread.id,
    title: thread.title ?? 'New conversation',
    metadata: {
      ...(thread.metadata ?? {}),
      globalCopilotPendingInterrupts: params.agent.pendingInterrupts
    }
  });
}

export async function handleGlobalCopilotKit(params: {
  req: IncomingMessage;
  res: ServerResponse;
  settings: AppSettings;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
}): Promise<void> {
  const libraries = readLibraries(params.settings.librariesDir);
  const agentName = selectGlobalCopilotAgentName({
    globalCopilotAgentName: params.settings.globalCopilotAgentName,
    scenarioAssistantAgentName: params.settings.scenarioAssistantAgentName,
    agentNames: Object.keys(libraries.agents)
  });
  const agentConfig = agentName ? libraries.agents[agentName] : undefined;
  if (!agentConfig) {
    params.asJson(params.res, 400, {
      error:
        'No Global Copilot agent is configured. Add an agent in Libraries > Agents or configure it in Settings.'
    });
    return;
  }
  const connectionPool = new GlobalCopilotMcpConnectionPool();
  try {
    const memoryRuntime = await getGlobalCopilotMemoryRuntime(params.settings.workspaceRoot);
    const readBudget: GlobalCopilotReadBudget = { used: 0, batchSize: 5 };
    const agent = createGlobalCopilotMastraAgent({
      agentConfig,
      resourceId: globalCopilotWorkspaceResourceId(params.settings.workspaceRoot),
      memory: memoryRuntime.memory,
      storage: memoryRuntime.storage,
      tools: async ({ requestContext }: any) => {
        const context = globalCopilotContextFromAgUi(requestContext?.get?.('ag-ui')?.context);
        return buildGlobalCopilotMastraTools({
          settings: params.settings,
          context,
          budget: readBudget,
          pool: connectionPool
        });
      },
      instructions: ({ requestContext }) => {
        const context = globalCopilotContextFromAgUi(requestContext?.get?.('ag-ui')?.context);
        return [agentConfig.system, globalCopilotSystemPrompt(context)].filter(Boolean).join('\n\n');
      }
    });
    await createGlobalCopilotRuntimeHandler(agent)(params.req, params.res);
    await persistGlobalCopilotPendingInterrupts({
      memory: memoryRuntime.memory,
      resourceId: globalCopilotWorkspaceResourceId(params.settings.workspaceRoot),
      agent
    });
  } catch (error: unknown) {
    if (params.res.headersSent) {
      params.res.end();
      return;
    }
    params.asJson(params.res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await connectionPool.close();
  }
}
