import { describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@inspectr/mcplab-core';
import {
  GLOBAL_COPILOT_AGENT_ID,
  createGlobalCopilotLanguageModel,
  createGlobalCopilotMastraAgent,
  createGlobalCopilotRuntimeHandler,
  globalCopilotContextFromAgUi,
  globalCopilotModelDescriptor,
  persistGlobalCopilotPendingInterrupts,
  validateGlobalCopilotProviderEnvironment
} from './global-copilot-mastra.js';

describe('globalCopilotModelDescriptor', () => {
  it('maps OpenAI library agents without changing generation settings', () => {
    const agent = {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      temperature: 0.2,
      max_tokens: 4096,
      system: 'Be concise.'
    } satisfies AgentConfig;

    expect(globalCopilotModelDescriptor(agent)).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      temperature: 0.2,
      maxTokens: 4096,
      system: 'Be concise.'
    });
  });

  it('maps Anthropic and Azure OpenAI without changing the configured model', () => {
    expect(
      globalCopilotModelDescriptor({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(
      globalCopilotModelDescriptor({ provider: 'azure_openai', model: 'gpt-5-mini' })
    ).toMatchObject({ provider: 'azure_openai', model: 'gpt-5-mini' });
  });

  it('uses the stable CopilotKit agent id', () => {
    expect(GLOBAL_COPILOT_AGENT_ID).toBe('mcplab-global-copilot');
  });

  it('reports the existing OpenAI and Anthropic credential names', () => {
    expect(() =>
      validateGlobalCopilotProviderEnvironment(
        { provider: 'openai', model: 'gpt-5.6-sol' },
        {}
      )
    ).toThrow('Missing OPENAI_API_KEY');
    expect(() =>
      validateGlobalCopilotProviderEnvironment(
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        {}
      )
    ).toThrow('Missing ANTHROPIC_API_KEY');
  });

  it('uses OpenAI Chat Completions like the existing evaluation adapter', () => {
    const model = createGlobalCopilotLanguageModel(
      { provider: 'openai', model: 'gpt-5.6-sol' },
      { OPENAI_API_KEY: 'key' }
    );

    expect(model.provider).toBe('openai.chat');
    expect(model.modelId).toBe('gpt-5.6-sol');
  });

  it('requires the same Azure OpenAI environment as the evaluation adapter', () => {
    expect(() =>
      validateGlobalCopilotProviderEnvironment(
        { provider: 'azure_openai', model: 'gpt-5-mini' },
        { AZURE_OPENAI_API_KEY: 'key' }
      )
    ).toThrow('Missing AZURE_OPENAI_ENDPOINT');
    expect(() =>
      validateGlobalCopilotProviderEnvironment(
        { provider: 'azure_openai', model: 'gpt-5-mini' },
        {
          AZURE_OPENAI_API_KEY: 'key',
          AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
          AZURE_OPENAI_DEPLOYMENT: 'deployment'
        }
      )
    ).not.toThrow();
  });

  it('uses Azure Chat Completions like the existing evaluation adapter', () => {
    const model = createGlobalCopilotLanguageModel(
      { provider: 'azure_openai', model: 'gpt-5-chat' },
      {
        AZURE_OPENAI_API_KEY: 'key',
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_DEPLOYMENT: 'deployment',
        AZURE_OPENAI_API_VERSION: '2024-02-15-preview'
      }
    );

    expect(model.provider).toBe('azure.chat');
    expect(model.modelId).toBe('deployment');
  });

  it('constructs an interrupt-capable in-process Mastra agent', () => {
    const wrapped = createGlobalCopilotMastraAgent({
      agentConfig: { provider: 'openai', model: 'gpt-5.6-sol' },
      instructions: 'You are the MCPLab Global Copilot.',
      resourceId: 'workspace-1',
      environment: { OPENAI_API_KEY: 'test-key' }
    });

    expect(wrapped.agent.id).toBe(GLOBAL_COPILOT_AGENT_ID);
    expect(wrapped.resourceId).toBe('workspace-1');
    expect(wrapped.emitInterruptOutcome).toBe(true);
  });

  it('serves runtime discovery through the single CopilotKit endpoint', async () => {
    const wrapped = createGlobalCopilotMastraAgent({
      agentConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      instructions: 'You are the MCPLab Global Copilot.',
      resourceId: 'workspace-1',
      environment: { ANTHROPIC_API_KEY: 'test-key' }
    });

    const handler = createGlobalCopilotRuntimeHandler(wrapped) as unknown as (
      request: Request
    ) => Promise<Response>;
    const response = await handler(
      new Request('http://localhost/api/copilotkit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'info' })
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agents: { [GLOBAL_COPILOT_AGENT_ID]: { name: GLOBAL_COPILOT_AGENT_ID } }
    });
  });

  it('decodes CopilotKit v2 agent context for dynamic instructions and tools', () => {
    expect(
      globalCopilotContextFromAgUi([
        {
          description: 'Current MCPLab application context',
          value: JSON.stringify({ currentView: 'test-case-detail', activeTestCaseId: 'weather' })
        }
      ])
    ).toEqual({ currentView: 'test-case-detail', activeTestCaseId: 'weather' });
  });

  it('stores pending interrupt descriptors in the Mastra thread metadata', async () => {
    const updateThread = vi.fn().mockResolvedValue(undefined);
    await persistGlobalCopilotPendingInterrupts({
      memory: {
        getThreadById: vi.fn().mockResolvedValue({
          id: 'thread-1',
          resourceId: 'workspace-1',
          title: 'Conversation',
          metadata: { retained: true }
        }),
        updateThread
      } as any,
      resourceId: 'workspace-1',
      agent: {
        threadId: 'thread-1',
        pendingInterrupts: [{ id: 'run-1::tool-1', reason: 'mastra:tool_suspend' }]
      } as any
    });

    expect(updateThread).toHaveBeenCalledWith({
      id: 'thread-1',
      title: 'Conversation',
      metadata: {
        retained: true,
        globalCopilotPendingInterrupts: [
          { id: 'run-1::tool-1', reason: 'mastra:tool_suspend' }
        ]
      }
    });
  });
});
