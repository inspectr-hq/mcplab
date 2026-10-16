import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentConnectionError,
  type AssistantRuntimeEvent,
  type LlmAgentConfig
} from '@inspectr/mcplab-core';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeTool
} from './assistant-runtime-contract.js';

type Provider = LlmAgentConfig['provider'];
type WireRequest = { url: string; body: Record<string, unknown>; authorization: string };
const PROVIDERS: Provider[] = ['openai', 'anthropic', 'azure_openai', 'azure_foundry'];

function definition(
  provider: Provider,
  model = 'test-model',
  overrides: Partial<AssistantRuntimeDefinition> = {}
): AssistantRuntimeDefinition {
  const tools: AssistantRuntimeTool[] = [
    {
      name: 'lookup',
      server: 'example',
      tool: 'lookup',
      description: 'Look something up',
      inputSchema: { properties: { q: { type: 'string' } }, required: ['q'] },
      execute: vi.fn(async () => ({ found: true }))
    }
  ];
  return {
    assistant: 'result',
    agent: { provider, model, temperature: 0.25, max_tokens: 321 },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'one system prompt',
    tools,
    approvalPolicy: () => 'approval_required',
    ...overrides
  };
}

/** Runs a turn through the production runtime: createAgent with real LangChain providers. */
async function ask(agentDefinition: AssistantRuntimeDefinition, message = 'question') {
  const events: AssistantRuntimeEvent[] = [];
  const session = await createLangChainAssistantRuntimeFactory().create({
    ...agentDefinition,
    onEvent: (event) => events.push(event)
  });
  const response = session.sendMessage(message);
  return { session, events, response };
}

function sse(chunks: string[], { failAfter }: { failAfter?: string } = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        // Fail after the first chunk has been delivered, like a connection dropping mid-answer.
        if (failAfter) setTimeout(() => controller.error(new Error(failAfter)), 20);
        else controller.close();
      }
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
}

function openAiStream(
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: string }> = [],
  options: { failAfter?: string } = {}
) {
  const events: Array<Record<string, unknown>> = [];
  if (text)
    events.push({
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    });
  toolCalls.forEach((call, index) =>
    events.push({
      choices: [
        {
          index: 0,
          delta: {
            ...(text ? {} : { role: 'assistant' }),
            tool_calls: [
              {
                index,
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments }
              }
            ]
          },
          finish_reason: null
        }
      ]
    })
  );
  if (!options.failAfter)
    events.push({
      choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }]
    });
  const chunks = events.map((event) => `data: ${JSON.stringify({ id: 'chatcmpl', ...event })}\n\n`);
  return sse(options.failAfter ? chunks : [...chunks, 'data: [DONE]\n\n'], options);
}

function anthropicStream(text: string) {
  const event = (name: string, data: unknown) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return sse([
    event('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'test-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 }
      }
    }),
    event('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    }),
    event('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text }
    }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 }
    }),
    event('message_stop', { type: 'message_stop' })
  ]);
}

function jsonError(status: number, message: string, type = 'invalid_request_error') {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function captureFetch(respond: (request: WireRequest, index: number) => Response) {
  const requests: WireRequest[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      authorization: new Headers(init?.headers).get('authorization') ?? ''
    };
    requests.push(request);
    return respond(request, requests.length - 1);
  });
  return requests;
}

// Provider packages load lazily; warm them outside the per-test timeout so the first provider
// test does not pay the module-loading cost under a busy parallel run.
beforeAll(async () => {
  await import('@langchain/openai');
  await import('@langchain/anthropic').catch(() => undefined);
}, 60_000);

beforeEach(() => {
  vi.stubEnv('LANGSMITH_TRACING', 'false');
  vi.stubEnv('LANGCHAIN_TRACING_V2', 'false');
  vi.stubEnv('LANGCHAIN_TRACING', 'false');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('assistant chat models on the standard agent', () => {
  it.each(PROVIDERS)(
    'streams a %s answer with one system prompt and MCPlab provider settings',
    async (provider) => {
      vi.stubEnv('OPENAI_API_KEY', 'openai-key');
      vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
      vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
      vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
      vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
      vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example/models/');
      vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'foundry-key');
      const requests = captureFetch(() =>
        provider === 'anthropic' ? anthropicStream(' answer ') : openAiStream(' answer ')
      );

      const { response, events, session } = await ask(
        definition(provider, provider === 'azure_foundry' ? ' foundry-deployment ' : 'test-model')
      );

      await expect(response).resolves.toMatchObject({ type: 'assistant_message', text: 'answer' });
      expect(events.filter((event) => event.type === 'assistant_message_delta')).not.toHaveLength(
        0
      );
      expect(requests).toHaveLength(1);
      const body = requests[0]!.body;
      expect(body.stream).toBe(true);
      expect(body.temperature).toBe(0.25);
      if (provider === 'openai' || provider === 'anthropic') expect(body.max_tokens).toBe(321);
      else expect(body.max_completion_tokens).toBe(321);
      const systemMessages =
        provider === 'anthropic'
          ? [body.system].flat().map((part: any) => (typeof part === 'string' ? part : part.text))
          : (body.messages as Array<Record<string, unknown>>)
              .filter((message) => message.role === 'system')
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
        expect(requests[0]!.url).toBe('https://foundry.example/openai/v1/chat/completions');
        expect(body.model).toBe('foundry-deployment');
      }
      if (provider === 'azure_openai') {
        expect(requests[0]!.url).toContain(
          '/openai/deployments/global-deployment/chat/completions?api-version=2024-02-15-preview'
        );
      }
      await session.dispose();
    }
  );

  it('runs an OpenAI tool call through approval and pairs its result in the next request', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests = captureFetch((_request, index) =>
      index === 0
        ? openAiStream('', [{ id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' }])
        : openAiStream('found it')
    );
    const agentDefinition = definition('openai');
    const { session, response } = await ask(agentDefinition);
    await expect(response).resolves.toMatchObject({
      type: 'tool_call_request',
      pendingToolCalls: [{ id: 'call-1', arguments: { q: 'x' } }]
    });
    await expect(
      session.resolveToolCalls([{ toolCallId: 'call-1', decision: 'approve' }])
    ).resolves.toMatchObject({ type: 'assistant_message', text: 'found it' });
    expect(agentDefinition.tools[0]!.execute).toHaveBeenCalledWith(
      { q: 'x' },
      expect.any(AbortSignal)
    );
    const followup = requests[1]!.body.messages as Array<Record<string, any>>;
    expect(followup.find((message) => message.role === 'assistant')?.tool_calls).toMatchObject([
      { id: 'call-1', function: { name: 'lookup' } }
    ]);
    expect(followup.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
    await session.dispose();
  });

  it('answers malformed OpenAI arguments with an error result before the next request', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests = captureFetch((_request, index) =>
      index === 0
        ? openAiStream('', [{ id: 'broken', name: 'lookup', arguments: '{"q": not json}' }])
        : openAiStream('recovered')
    );
    const agentDefinition = definition('openai');
    const { session, response } = await ask(agentDefinition);
    await expect(response).resolves.toMatchObject({ type: 'assistant_message', text: 'recovered' });
    expect(agentDefinition.tools[0]!.execute).not.toHaveBeenCalled();
    const followup = requests[1]!.body.messages as Array<Record<string, any>>;
    expect(followup.find((message) => message.role === 'assistant')?.tool_calls).toMatchObject([
      { id: 'broken' }
    ]);
    const result = followup.find((message) => message.role === 'tool');
    expect(result).toMatchObject({ tool_call_id: 'broken' });
    expect(JSON.parse(result!.content).error).toContain("Invalid arguments for tool 'lookup'");
    await session.dispose();
  });

  it('uses one Azure compatibility retry for token and default-only temperature errors', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', 'custom-deployment');
    const requests = captureFetch((_request, index) =>
      index === 0
        ? jsonError(400, 'max_completion_tokens is not supported')
        : index === 1
          ? jsonError(400, 'temperature is not supported. Only the default value is allowed')
          : openAiStream('ok')
    );
    const { response, session } = await ask(definition('azure_openai', 'custom-deployment'));
    await expect(response).resolves.toMatchObject({ text: 'ok' });
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
    await session.dispose();
  });

  it('does not retry a compatibility error once text has been streamed', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    const requests = captureFetch(() =>
      openAiStream('partial answer', [], { failAfter: 'max_completion_tokens is not supported' })
    );
    const { response, session } = await ask(definition('azure_openai'));
    await expect(response).rejects.toThrow();
    expect(requests).toHaveLength(1);
    await session.dispose();
  });

  it('does not retry retryable provider failures', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests = captureFetch(() => jsonError(503, 'temporary outage', 'server_error'));
    const { response, session } = await ask(definition('openai'));
    await expect(response).rejects.toThrow();
    expect(requests).toHaveLength(1);
    await session.dispose();
  });

  it('reports missing credentials and deployments on the first message', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const openai = await ask(definition('openai'));
    await expect(openai.response).rejects.toMatchObject<Partial<AgentConnectionError>>({
      failure: 'missing_credentials'
    });
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', '');
    const azure = await ask(definition('azure_openai'));
    await expect(azure.response).rejects.toMatchObject<Partial<AgentConnectionError>>({
      failure: 'deployment'
    });
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    vi.stubEnv('AZURE_OPENAI_API_KEY', '');
    const foundry = await ask(definition('azure_foundry'));
    await expect(foundry.response).rejects.toThrow('AZURE_FOUNDRY_API_KEY');
  });

  it('uses the Azure key alias for Foundry when the dedicated key is absent', async () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example/models/');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'dedicated-key');
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'shared-key');
    const requests = captureFetch(() => openAiStream('ok'));
    await (
      await ask(definition('azure_foundry', 'foundry-model'))
    ).response;
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    await (
      await ask(definition('azure_foundry', 'foundry-model'))
    ).response;
    expect(requests.map((request) => request.url)).toEqual(
      Array(2).fill('https://foundry.example/openai/v1/chat/completions')
    );
    expect(requests[0]!.authorization).toContain('dedicated-key');
    expect(requests[1]!.authorization).toContain('shared-key');
  });

  it('honors the Azure API-version override and selects each agent deployment', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2025-01-01-preview');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', 'assistant-a,assistant-b');
    const requests = captureFetch(() => openAiStream('ok'));
    await (
      await ask(definition('azure_openai', 'assistant-a'))
    ).response;
    await (
      await ask(definition('azure_openai', 'assistant-b'))
    ).response;
    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining(
        '/deployments/assistant-a/chat/completions?api-version=2025-01-01-preview'
      ),
      expect.stringContaining(
        '/deployments/assistant-b/chat/completions?api-version=2025-01-01-preview'
      )
    ]);
  });

  it('tries the dated Anthropic model then its latest alias only after model not found', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests = captureFetch((_request, index) =>
      index === 0
        ? jsonError(404, 'model not found', 'not_found_error')
        : anthropicStream('latest works')
    );
    const { response } = await ask(definition('anthropic', 'claude-3-5-sonnet-20241022'));
    await expect(response).resolves.toMatchObject({ text: 'latest works' });
    expect(requests.map((request) => request.body.model)).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest'
    ]);
  });

  it('does not treat an unrelated Anthropic 404 as a model miss', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests = captureFetch(() =>
      jsonError(404, 'route/resource not found', 'not_found_error')
    );
    const { response } = await ask(definition('anthropic', 'claude-3-5-sonnet-20241022'));
    await expect(response).rejects.toThrow('route/resource not found');
    expect(requests).toHaveLength(1);
  });

  it('uses Anthropic default max_tokens and reports exhausted model candidates', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const requests = captureFetch(() => jsonError(404, 'model not found', 'not_found_error'));
    const agentDefinition = definition('anthropic', 'claude-3-5-sonnet-20241022');
    agentDefinition.agent.max_tokens = undefined;
    const { response } = await ask(agentDefinition);
    await expect(response).rejects.toThrow(
      'tried: claude-3-5-sonnet-20241022, claude-3-5-sonnet-latest'
    );
    expect(requests.map((request) => request.body.model)).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest'
    ]);
    expect(requests[0]!.body.max_tokens).toBe(1024);
  });
});

function openAiResponsesStream(answer: string) {
  const event = (data: Record<string, unknown>) =>
    `event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`;
  const reasoningItem = {
    type: 'reasoning',
    id: 'rs_1',
    summary: [
      { type: 'summary_text', text: 'Checking the run.' },
      { type: 'summary_text', text: 'Two checks fail.' }
    ],
    encrypted_content: 'encrypted-reasoning'
  };
  const messageItem = {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: answer, annotations: [] }]
  };
  const response = (status: string, output: unknown[]) => ({
    id: 'resp_1',
    object: 'response',
    created_at: 0,
    model: 'o4-mini',
    status,
    output,
    usage: {
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 1 }
    }
  });
  const summary = (index: number, delta: string) => [
    event({
      type: 'response.reasoning_summary_part.added',
      item_id: 'rs_1',
      output_index: 0,
      summary_index: index,
      part: { type: 'summary_text', text: '' }
    }),
    event({
      type: 'response.reasoning_summary_text.delta',
      item_id: 'rs_1',
      output_index: 0,
      summary_index: index,
      delta
    })
  ];
  return sse([
    event({ type: 'response.created', response: response('in_progress', []) }),
    event({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'reasoning', id: 'rs_1', summary: [] }
    }),
    ...summary(0, 'Checking the run.'),
    ...summary(1, 'Two checks fail.'),
    event({ type: 'response.output_item.done', output_index: 0, item: reasoningItem }),
    event({
      type: 'response.output_item.added',
      output_index: 1,
      item: { ...messageItem, status: 'in_progress', content: [] }
    }),
    event({
      type: 'response.output_text.delta',
      item_id: 'msg_1',
      output_index: 1,
      content_index: 0,
      delta: answer
    }),
    event({ type: 'response.output_item.done', output_index: 1, item: messageItem }),
    event({
      type: 'response.completed',
      response: response('completed', [reasoningItem, messageItem])
    })
  ]);
}

describe('OpenAI reasoning summaries', () => {
  it('streams reasoning separately from the answer, unstored, and replays it encrypted', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests = captureFetch(() => openAiResponsesStream('answer'));
    const { response, events, session } = await ask(
      definition('openai', 'o4-mini', { agent: { provider: 'openai', model: 'o4-mini' } })
    );

    await expect(response).resolves.toMatchObject({ type: 'assistant_message', text: 'answer' });
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(requests[0]!.body).toMatchObject({
      reasoning: { summary: 'auto' },
      store: false,
      include: ['reasoning.encrypted_content']
    });
    const reasoningDeltas = events
      .filter((event) => event.type === 'assistant_reasoning_delta')
      .map((event) => event.payload.delta);
    expect(reasoningDeltas.join('')).toBe('Checking the run.\n\nTwo checks fail.');
    const answer = session.getSnapshot().messages.at(-1)!;
    expect(answer).toMatchObject({
      role: 'assistant',
      text: 'answer',
      reasoning: { text: 'Checking the run.\n\nTwo checks fail.' }
    });
    expect(answer.reasoning!.durationMs).toEqual(expect.any(Number));

    await session.sendMessage('follow-up');
    const replayed = requests[1]!.body.input as Array<Record<string, unknown>>;
    expect(replayed).toContainEqual(
      expect.objectContaining({ type: 'reasoning', encrypted_content: 'encrypted-reasoning' })
    );
    await session.dispose();
  });

  it('keeps non-reasoning OpenAI models on Chat Completions', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const requests = captureFetch(() => openAiStream('answer'));
    const { response, session } = await ask(definition('openai', 'gpt-4o-mini'));
    await expect(response).resolves.toMatchObject({ text: 'answer' });
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(requests[0]!.body.reasoning).toBeUndefined();
    await session.dispose();
  });
});
