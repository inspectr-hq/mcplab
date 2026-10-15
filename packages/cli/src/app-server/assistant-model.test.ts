import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import {
  AgentConnectionError,
  type AssistantRuntimeDefinition,
  type LlmAgentConfig,
  type AssistantRuntimeTool
} from '@inspectr/mcplab-core';
import { callAssistantModel } from './assistant-model.js';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';

type Provider = LlmAgentConfig['provider'];
const PROVIDERS: Provider[] = ['openai', 'anthropic', 'azure_openai', 'azure_foundry'];
type WireRequest = { url: string; body: Record<string, unknown> };

function definition(
  provider: Provider,
  model = 'test-model',
  execute = vi.fn(async () => 'unused')
): AssistantRuntimeDefinition {
  const agent: LlmAgentConfig = { provider, model, temperature: 0.25, max_tokens: 321 };
  const tools: AssistantRuntimeTool[] = [
    {
      name: 'lookup',
      server: 'example',
      tool: 'lookup',
      description: 'Look something up',
      inputSchema: { properties: { q: { type: 'string' } }, required: ['q'] },
      execute
    }
  ];
  return {
    agent,
    tools,
    getSystemPrompt: () => 'one system prompt',
    assistant: 'result',
    context: {
      scenario: {
        id: 'scenario-1',
        prompt: 'prompt',
        serverNames: [],
        evalRules: [],
        extractRules: []
      }
    },
    approvalPolicy: () => 'approval_required'
  };
}

function openAiResponse(content: string | null, toolCalls: unknown[] = []) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [
        {
          index: 0,
          finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
          message: {
            role: 'assistant',
            content,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {})
          }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function anthropicResponse(content: unknown[]) {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('LANGCHAIN_TRACING', 'false');
  vi.stubEnv('LANGCHAIN_TRACING_V2', 'false');
});

describe('native assistant model boundary', () => {
  it.each(PROVIDERS)(
    'sends %s requests through its LangChain provider with exactly one system prompt',
    async (provider) => {
      vi.stubEnv('OPENAI_API_KEY', 'openai-key');
      vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
      vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
      vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
      vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
      vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example/models/');
      vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'foundry-key');
      vi.stubEnv('LANGSMITH_TRACING', 'true');
      vi.stubEnv('LANGCHAIN_TRACING_V2', 'true');
      vi.stubEnv('LANGCHAIN_TRACING', 'true');
      vi.stubEnv('LANGSMITH_ENDPOINT', 'https://assistant-export-leak.invalid');
      const requests: WireRequest[] = [];
      const traceRequests: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('assistant-export-leak.invalid') || url.includes('smith.langchain.com')) {
          traceRequests.push(`${init?.method ?? 'GET'} ${url}`);
          return new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        return provider === 'anthropic'
          ? anthropicResponse([{ type: 'text', text: ' answer ' }])
          : openAiResponse(' answer ');
      });

      const result = await callAssistantModel(
        definition(provider, provider === 'azure_foundry' ? ' foundry-deployment ' : 'test-model'),
        [new HumanMessage('question')]
      );

      expect(result).toMatchObject({ type: 'assistant_message', text: 'answer' });
      expect(traceRequests.filter((request) => request.includes('/runs'))).toEqual([]);
      expect(requests).toHaveLength(1);
      const body = requests[0]!.body;
      expect(body.temperature).toBe(0.25);
      if (provider === 'openai' || provider === 'anthropic') expect(body.max_tokens).toBe(321);
      else expect(body.max_completion_tokens).toBe(321);
      const wireMessages = body.messages as Array<Record<string, unknown>> | undefined;
      const systemMessages =
        provider === 'anthropic'
          ? [body.system]
          : wireMessages
              ?.filter((message) => message.role === 'system')
              .map((message) => message.content);
      expect(systemMessages).toEqual(['one system prompt']);
      const wireTools = body.tools as Array<Record<string, unknown>>;
      expect(wireTools).toHaveLength(1);
      expect(wireTools[0]).toMatchObject(
        provider === 'anthropic'
          ? { name: 'lookup', input_schema: { type: 'object' } }
          : { type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }
      );
      if (provider === 'azure_foundry') {
        expect(requests[0]!.url).toContain('/openai/v1/chat/completions');
        expect(body.model).toBe('foundry-deployment');
        expect(requests[0]!.url).not.toContain('api-version');
      }
      if (provider === 'azure_openai') {
        expect(requests[0]!.url).toContain(
          '/openai/deployments/global-deployment/chat/completions'
        );
        expect(requests[0]!.url).toContain('api-version=2024-02-15-preview');
      }
    }
  );

  it('preserves malformed tool call IDs and returns a corrective validation error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const response = openAiResponse(null, [
      { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{bad' } }
    ]);
    vi.stubGlobal('fetch', async () => response.clone());
    await expect(
      callAssistantModel(definition('openai'), [new HumanMessage('question')])
    ).resolves.toMatchObject({
      type: 'tool_call_request',
      toolCalls: [
        { id: 'call-1', name: 'lookup', validationError: expect.stringContaining('{bad') }
      ]
    });
  });

  it('preserves provider order when malformed and valid native calls are mixed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubGlobal('fetch', async () =>
      openAiResponse(null, [
        { id: 'bad-first', type: 'function', function: { name: 'lookup', arguments: '{bad' } },
        {
          id: 'good-second',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"ok"}' }
        }
      ])
    );
    const result = await callAssistantModel(definition('openai'), [new HumanMessage('question')]);
    expect(result).toMatchObject({
      type: 'tool_call_request',
      toolCalls: [
        { id: 'bad-first', validationError: expect.stringContaining('{bad') },
        { id: 'good-second', arguments: { q: 'ok' } }
      ]
    });
  });

  it('returns an OpenAI corrective tool result and valid history after malformed JSON', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      return requests.length === 1
        ? openAiResponse(' ', [
            { id: 'bad-json', type: 'function', function: { name: 'lookup', arguments: '{bad' } }
          ])
        : openAiResponse('Corrected the tool input.');
    });
    const execute = vi.fn(async () => 'must not execute');
    const session = await createLangChainAssistantRuntimeFactory().create({
      ...definition('openai'),
      tools: [
        {
          name: 'lookup',
          server: 'example',
          tool: 'lookup',
          description: 'Lookup',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute
        }
      ],
      approvalPolicy: () => 'automatic'
    });

    await expect(session.sendMessage('Look it up')).resolves.toMatchObject({
      type: 'assistant_message',
      text: 'Corrected the tool input.'
    });
    expect(execute).not.toHaveBeenCalled();
    const continuation = requests[1]!.messages as Array<{
      role: string;
      tool_calls?: Array<{ id: string; function: { arguments: string } }>;
      tool_call_id?: string;
    }>;
    const assistantCall = continuation.find((message) => message.tool_calls?.length);
    expect(assistantCall?.tool_calls).toMatchObject([
      { id: 'bad-json', function: { arguments: '{}' } }
    ]);
    expect(continuation).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'bad-json' })
    );
  });

  it('preserves raw order when malformed and valid calls share a duplicate provider ID', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubGlobal('fetch', async () =>
      openAiResponse(null, [
        { id: 'duplicate', type: 'function', function: { name: 'lookup', arguments: '{bad' } },
        {
          id: 'duplicate',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"valid"}' }
        }
      ])
    );
    const result = await callAssistantModel(definition('openai'), [new HumanMessage('question')]);
    expect(result).toMatchObject({
      type: 'tool_call_request',
      toolCalls: [
        { id: 'duplicate', validationError: expect.stringContaining('{bad') },
        { id: 'duplicate', arguments: { q: 'valid' } }
      ]
    });
  });

  it('forwards tool history and result IDs and returns native tool calls without running callbacks', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return openAiResponse(' ', [
        { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }
      ]);
    });
    const history = [
      new SystemMessage('old system must be replaced'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-old', name: 'lookup', args: { q: 'old' }, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'found', tool_call_id: 'call-old' }),
      new HumanMessage('next')
    ];
    const execute = vi.fn(async () => 'must not execute');
    const result = await callAssistantModel(definition('openai', 'test-model', execute), history);
    const wireMessages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(wireMessages).toHaveLength(4);
    expect(wireMessages[0]).toEqual({ role: 'system', content: 'one system prompt' });
    expect(wireMessages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call-old', function: { name: 'lookup', arguments: '{"q":"old"}' } }]
    });
    expect(wireMessages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-old',
      content: 'found'
    });
    expect(wireMessages.filter((message) => message.role === 'system')).toHaveLength(1);
    expect(wireMessages.at(-1)).toMatchObject({ role: 'user', content: 'next' });
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      type: 'tool_call_request',
      text: 'I need a tool to help answer.',
      toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { q: 'x' } }]
    });
  });

  it('does not send a request for a pre-aborted call', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      callAssistantModel(definition('openai'), [new HumanMessage('question')], controller.signal)
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the OpenAI chat completions endpoint and token field selected by the native integration', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return openAiResponse('ok');
    });
    await callAssistantModel(definition('openai', 'o3-mini'), [new HumanMessage('question')]);
    expect(requests[0]!.url).toContain('/chat/completions');
    expect(requests[0]!.body.max_completion_tokens).toBe(321);
    expect(requests[0]!.body).not.toHaveProperty('max_tokens');
  });

  it('uses one Azure compatibility retry for token and default-only temperature errors', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', 'custom-deployment');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      if (requests.length === 1)
        return new Response(
          JSON.stringify({ error: { message: 'max_completion_tokens is not supported' } }),
          { status: 400 }
        );
      if (requests.length === 2)
        return new Response(
          JSON.stringify({
            error: { message: 'temperature is not supported. Only the default value is allowed' }
          }),
          { status: 400 }
        );
      return openAiResponse('ok');
    });
    await callAssistantModel(definition('azure_openai', 'custom-deployment'), [
      new HumanMessage('question')
    ]);
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.body.max_completion_tokens)).toEqual([
      321,
      undefined,
      undefined
    ]);
    expect(requests.map((request) => request.body.max_tokens)).toEqual([undefined, 321, 321]);
    expect(requests.map((request) => request.body.temperature)).toEqual([0.25, 0.25, undefined]);
    expect(requests.map((request) => request.url)).toEqual(
      Array(3).fill(expect.stringContaining('/deployments/custom-deployment/'))
    );
    for (const request of requests) expect(request.body.tools).toHaveLength(1);
  });

  it('does not retry unrelated Azure or Anthropic authentication failures', async () => {
    const requests: WireRequest[] = [];
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(JSON.stringify({ error: { message: 'invalid API key' } }), {
        status: 401
      });
    });
    await expect(
      callAssistantModel(definition('azure_openai'), [new HumanMessage('x')])
    ).rejects.toThrow('invalid API key');
    expect(requests).toHaveLength(1);

    requests.length = 0;
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    await expect(
      callAssistantModel(definition('anthropic', 'claude-3-5-sonnet-20241022'), [
        new HumanMessage('x')
      ])
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it('tries the dated Anthropic model then its latest alias only after model not found', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return requests.length === 1
        ? new Response(
            JSON.stringify({ error: { type: 'not_found_error', message: 'model not found' } }),
            { status: 404 }
          )
        : anthropicResponse([{ type: 'text', text: 'latest works' }]);
    });
    const result = await callAssistantModel(definition('anthropic', 'claude-3-5-sonnet-20241022'), [
      new HumanMessage('x')
    ]);
    expect(requests.map((request) => request.body.model)).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest'
    ]);
    expect(result).toMatchObject({ type: 'assistant_message', text: 'latest works' });
    expect(requests[0]!.body.max_tokens).toBe(321);
  });

  it('does not treat an unrelated Anthropic 404 as a model miss', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({ error: { type: 'not_found_error', message: 'route/resource not found' } }),
        { status: 404 }
      );
    });

    await expect(
      callAssistantModel(definition('anthropic', 'claude-3-5-sonnet-20241022'), [
        new HumanMessage('x')
      ])
    ).rejects.toThrow('route/resource not found');
    expect(requests).toHaveLength(1);
  });

  it('uses Anthropic default max_tokens and reports exhausted model candidates', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(
        JSON.stringify({ error: { type: 'not_found_error', message: 'model not found' } }),
        { status: 404 }
      );
    });
    const agentDefinition = definition('anthropic', 'claude-3-5-sonnet-20241022');
    agentDefinition.agent.max_tokens = undefined;
    await expect(callAssistantModel(agentDefinition, [new HumanMessage('x')])).rejects.toThrow(
      'tried: claude-3-5-sonnet-20241022, claude-3-5-sonnet-latest'
    );
    expect(requests.map((request) => request.body.model)).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest'
    ]);
    expect(requests[0]!.body.max_tokens).toBe(1024);
  });

  it('binds the local Scenario proposal schema without invoking its callback', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const execute = vi.fn(async () => 'proposal callback must be graph-owned');
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return openAiResponse('ready');
    });
    const agentDefinition = definition('openai');
    agentDefinition.tools = [
      {
        name: 'propose_scenario_changes',
        server: 'local',
        tool: 'propose_scenario_changes',
        description: 'Propose edits for review',
        inputSchema: {
          type: 'object',
          properties: { prompt: { type: 'object' }, notes: { type: 'array' } },
          required: ['prompt']
        },
        execute
      }
    ];
    await callAssistantModel(agentDefinition, [new HumanMessage('suggest an edit')]);
    const wireTools = body?.tools as Array<Record<string, unknown>>;
    expect(wireTools[0]).toMatchObject({
      function: {
        name: 'propose_scenario_changes',
        parameters: {
          type: 'object',
          properties: { prompt: { type: 'object' }, notes: { type: 'array' } },
          required: ['prompt']
        }
      }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not retry retryable provider failures when LangChain retries are disabled', async () => {
    const requests: WireRequest[] = [];
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response(JSON.stringify({ error: { message: 'temporary outage' } }), {
        status: 503
      });
    });
    await expect(
      callAssistantModel(definition('openai'), [new HumanMessage('x')])
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
    requests.length = 0;
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    await expect(
      callAssistantModel(definition('anthropic'), [new HumanMessage('x')])
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it('preserves missing credential and deployment failure categories', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(
      callAssistantModel(definition('openai'), [new HumanMessage('x')])
    ).rejects.toMatchObject<Partial<AgentConnectionError>>({ failure: 'missing_credentials' });
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', '');
    await expect(
      callAssistantModel(definition('azure_openai'), [new HumanMessage('x')])
    ).rejects.toMatchObject<Partial<AgentConnectionError>>({ failure: 'deployment' });
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    vi.stubEnv('AZURE_OPENAI_API_KEY', '');
    await expect(
      callAssistantModel(definition('azure_foundry'), [new HumanMessage('x')])
    ).rejects.toThrow('AZURE_FOUNDRY_API_KEY');
  });

  it('uses the Azure key alias for Foundry when the dedicated key is absent', async () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example/models/');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'dedicated-key');
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'shared-key');
    const authorizations: string[] = [];
    let requestUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('smith.langchain.com'))
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      requestUrl = String(input);
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      return openAiResponse('ok');
    });
    await callAssistantModel(definition('azure_foundry', 'foundry-model'), [new HumanMessage('x')]);
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    await callAssistantModel(definition('azure_foundry', 'foundry-model'), [new HumanMessage('x')]);
    expect(requestUrl).toBe('https://foundry.example/openai/v1/chat/completions');
    expect(authorizations[0]).toContain('dedicated-key');
    expect(authorizations[1]).toContain('shared-key');
  });

  it('does not try Anthropic model aliases when the request becomes aborted', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const controller = new AbortController();
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      return new Response(
        JSON.stringify({ error: { type: 'not_found_error', message: 'model not found' } }),
        { status: 404 }
      );
    });
    await expect(
      callAssistantModel(
        definition('anthropic', 'claude-3-5-sonnet-20241022'),
        [new HumanMessage('x')],
        controller.signal
      )
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it('executes a native tool request through the real graph and preserves the result call ID', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests: WireRequest[] = [];
    const execute = vi.fn(async () => ({ value: 'from tool' }));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return requests.length === 1
        ? openAiResponse(null, [
            {
              id: 'graph-call-1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"x"}' }
            }
          ])
        : openAiResponse('The tool found it.');
    });
    const session = await createLangChainAssistantRuntimeFactory().create({
      ...definition('openai'),
      assistant: 'scenario',
      context: {
        scenario: {
          id: 'scenario-1',
          prompt: 'prompt',
          serverNames: [],
          evalRules: [],
          extractRules: []
        }
      },
      tools: [
        {
          name: 'lookup',
          server: 'example',
          tool: 'lookup',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute
        }
      ],
      approvalPolicy: () => 'automatic'
    });
    const result = await session.sendMessage('Find x');
    expect(result).toMatchObject({ type: 'assistant_message', text: 'The tool found it.' });
    expect(execute).toHaveBeenCalledTimes(1);
    const messages = requests[1]!.body.messages as Array<Record<string, unknown>>;
    expect(messages.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'graph-call-1' }]
    });
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'graph-call-1' });
    expect(messages.at(-1)?.content).toContain('from tool');
  });

  it('runs an Anthropic tool cycle through the default graph with adjacent matched tool results', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests: WireRequest[] = [];
    const executeLookup = vi.fn(async () => ({ value: 'lookup result' }));
    const executeRead = vi.fn(async () => ({ value: 'read result' }));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return requests.length === 1
        ? anthropicResponse([
            { type: 'tool_use', id: 'anthro-lookup-1', name: 'lookup', input: { q: 'x' } },
            { type: 'tool_use', id: 'anthro-read-1', name: 'read', input: { id: 'x' } }
          ])
        : anthropicResponse([{ type: 'text', text: 'Both tools found the answer.' }]);
    });
    const session = await createLangChainAssistantRuntimeFactory().create({
      ...definition('anthropic'),
      assistant: 'scenario',
      tools: [
        {
          name: 'lookup',
          server: 'example',
          tool: 'lookup',
          description: 'Lookup by query',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          execute: executeLookup
        },
        {
          name: 'read',
          server: 'example',
          tool: 'read',
          description: 'Read by id',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          execute: executeRead
        }
      ],
      approvalPolicy: () => 'automatic'
    });

    const result = await session.sendMessage('Find x');

    expect(result).toMatchObject({
      type: 'assistant_message',
      text: 'Both tools found the answer.'
    });
    expect(executeLookup).toHaveBeenCalledTimes(1);
    expect(executeRead).toHaveBeenCalledTimes(1);
    const firstTools = requests[0]!.body.tools as Array<Record<string, unknown>>;
    expect(firstTools).toMatchObject([
      {
        name: 'lookup',
        input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
      },
      {
        name: 'read',
        input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
      }
    ]);
    const messages = requests[1]!.body.messages as Array<Record<string, unknown>>;
    const assistantIndex = messages.findIndex((message) => message.role === 'assistant');
    expect(messages[assistantIndex]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'anthro-lookup-1', name: 'lookup', input: { q: 'x' } },
        { type: 'tool_use', id: 'anthro-read-1', name: 'read', input: { id: 'x' } }
      ]
    });
    expect(messages[assistantIndex + 1]).toMatchObject({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'anthro-lookup-1' },
        { type: 'tool_result', tool_use_id: 'anthro-read-1' }
      ]
    });
    expect(messages[assistantIndex + 1]?.content).not.toContain('Find x');
  });

  it('repairs a non-object Anthropic tool input before sending corrective history', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      return requests.length === 1
        ? anthropicResponse([
            { type: 'tool_use', id: 'bad-input', name: 'lookup', input: ['not', 'an', 'object'] }
          ])
        : anthropicResponse([{ type: 'text', text: 'Corrected the tool input.' }]);
    });
    const execute = vi.fn(async () => 'must not execute');
    const session = await createLangChainAssistantRuntimeFactory().create({
      ...definition('anthropic'),
      tools: [
        {
          name: 'lookup',
          server: 'example',
          tool: 'lookup',
          description: 'Lookup',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          execute
        }
      ],
      approvalPolicy: () => 'automatic'
    });

    await expect(session.sendMessage('Look it up')).resolves.toMatchObject({
      type: 'assistant_message',
      text: 'Corrected the tool input.'
    });
    expect(execute).not.toHaveBeenCalled();
    const continuation = requests[1]!.messages as Array<{ role: string; content: any }>;
    expect(continuation).toContainEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'bad-input', name: 'lookup', input: {} }]
    });
    expect(continuation).toContainEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'bad-input',
          content: expect.stringContaining('expected a JSON object')
        }
      ]
    });
  });

  it('honors the legacy Azure API-version override and selects configured agent deployments independently', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2025-01-01-preview');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', 'assistant-a,assistant-b');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return openAiResponse('ok');
    });

    await callAssistantModel(definition('azure_openai', 'assistant-a'), [new HumanMessage('a')]);
    await callAssistantModel(definition('azure_openai', 'assistant-b'), [new HumanMessage('b')]);

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining(
        '/deployments/assistant-a/chat/completions?api-version=2025-01-01-preview'
      ),
      expect.stringContaining(
        '/deployments/assistant-b/chat/completions?api-version=2025-01-01-preview'
      )
    ]);
    expect(requests.map((request) => request.body.model)).toEqual(['assistant-a', 'assistant-b']);
  });

  it('keeps Foundry deployments isolated to each agent model name', async () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example/models/');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'foundry-key');
    const requests: WireRequest[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return openAiResponse('ok');
    });

    await callAssistantModel(definition('azure_foundry', 'foundry-a'), [new HumanMessage('a')]);
    await callAssistantModel(definition('azure_foundry', 'foundry-b'), [new HumanMessage('b')]);

    expect(requests.map((request) => request.url)).toEqual([
      'https://foundry.example/openai/v1/chat/completions',
      'https://foundry.example/openai/v1/chat/completions'
    ]);
    expect(requests.map((request) => request.body.model)).toEqual(['foundry-a', 'foundry-b']);
    for (const request of requests) expect(request.url).not.toContain('api-version');
  });
});
