import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '@inspectr/mcplab-core';
import {
  GLOBAL_COPILOT_AGENT_ID,
  createGlobalCopilotMastraAgent,
  createGlobalCopilotRuntimeHandler,
  globalCopilotContextFromAgUi,
  globalCopilotModelDescriptor,
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

  it('creates a Node HTTP handler for the single CopilotKit endpoint', () => {
    const wrapped = createGlobalCopilotMastraAgent({
      agentConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      instructions: 'You are the MCPLab Global Copilot.',
      resourceId: 'workspace-1',
      environment: { ANTHROPIC_API_KEY: 'test-key' }
    });

    expect(createGlobalCopilotRuntimeHandler(wrapped)).toEqual(expect.any(Function));
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
});
