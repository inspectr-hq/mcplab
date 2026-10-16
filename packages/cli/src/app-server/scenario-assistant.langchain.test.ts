import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClientManager } from '@inspectr/mcplab-core';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';
import { scenarioAssistantSessionView } from './scenario-assistant-domain.js';

function harness(
  modelCall: Parameters<typeof createLangChainAssistantRuntimeFactory>[0],
  tools: Array<Record<string, unknown>> = []
) {
  const captured: Array<{ status: number; body: any }> = [];
  const sessions = new Map<string, any>();
  const scenario = {
    id: 'scenario-1',
    name: 'Example',
    prompt: 'Original prompt',
    serverNames: ['server-1'],
    evalRules: [{ type: 'response_contains', value: 'original' }],
    extractRules: [{ name: 'id', pattern: 'id=(.*)' }]
  };
  const body = {
    scenarioId: scenario.id,
    selectedAssistantAgentName: 'assistant-1',
    context: { scenario }
  };
  const factory = createLangChainAssistantRuntimeFactory(modelCall);
  const deps: any = {
    parseBody: vi.fn(async (req: any) => req.body ?? body),
    asJson: vi.fn((_res: any, status: number, result: unknown) =>
      captured.push({ status, body: result })
    ),
    scenarioAssistantSessionView,
    ensureInsideRoot: (_root: string, path: string) => path,
    readLibraries: () => ({
      servers: { 'server-1': { transport: 'http', url: 'https://example.invalid' } },
      agents: { 'assistant-1': { id: 'assistant-1', provider: 'openai', model: 'test' } },
      scenarios: []
    }),
    pickDefaultAssistantAgentName: () => 'assistant-1',
    resolveAssistantAgentFromConfig: vi.fn(),
    resolveAssistantAgentFromLibraries: () => ({
      id: 'assistant-1',
      provider: 'openai',
      model: 'test'
    }),
    assistantRuntimeFactory: factory
  };
  const connectAll = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
  const listTools = vi
    .spyOn(McpClientManager.prototype, 'listTools')
    .mockResolvedValue(tools as any);
  const mcpCall = vi.spyOn(McpClientManager.prototype, 'callTool');
  const invoke = async (method: string, pathname: string, requestBody?: unknown) => {
    const req = Object.assign(new EventEmitter(), {
      headers: { host: 'localhost' },
      body: requestBody
    });
    const res: any = Object.assign(new EventEmitter(), {
      writableEnded: false,
      chunks: [] as string[],
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => res.chunks.push(chunk)),
      end: vi.fn(() => {
        res.writableEnded = true;
      })
    });
    await handleScenarioAssistantRoutes({
      req: req as any,
      res,
      pathname,
      method,
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libs' } as any,
      assistantSessions: sessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn().mockResolvedValue({}) } as any,
      deps
    });
    return { req, res, result: captured.at(-1) };
  };
  return { invoke, sessions, scenario, captured, deps, connectAll, listTools, mcpCall };
}

afterEach(() => vi.restoreAllMocks());

describe('Scenario Assistant LangGraph HTTP runtime', () => {
  it('streams deltas before completion and reconnects with the current text snapshot', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const firstDelta = new Promise<void>((resolve) => (started = resolve));
    const { invoke, sessions } = harness(async (_definition, _messages, _signal, onText) => {
      onText?.('Hello');
      started();
      await gate;
      onText?.(' world');
      return { type: 'assistant_message', text: 'Hello world' };
    });
    await invoke('POST', '/api/scenario-assistant/sessions');
    const id = [...sessions.keys()][0]!;
    const stream = await invoke('GET', `/api/scenario-assistant/sessions/${id}/events`);
    const turn = invoke('POST', `/api/scenario-assistant/sessions/${id}/messages`, {
      message: 'Hello'
    });
    await firstDelta;
    await vi.waitFor(() =>
      expect(
        parseSse(stream.res.chunks.join('')).some(
          (event) => event.type === 'assistant_message_delta'
        )
      ).toBe(true)
    );
    const delta = parseSse(stream.res.chunks.join('')).find(
      (event) => event.type === 'assistant_message_delta'
    );
    if (!delta) throw new Error('Expected streamed text before model completion');
    const beforeCompletion = parseSse(stream.res.chunks.join(''));
    const startedIndex = beforeCompletion.findIndex((event) => event.type === 'turn_started');
    const deltaIndex = beforeCompletion.findIndex(
      (event) => event.type === 'assistant_message_delta'
    );
    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(startedIndex).toBeLessThan(deltaIndex);
    expect(beforeCompletion[startedIndex].payload.session.activeTurnId).toBe(delta.payload.turnId);
    expect(delta.payload).toMatchObject({ sessionId: id, delta: 'Hello', offset: 0 });
    expect(delta.payload).not.toHaveProperty('session');
    stream.res.emit('close');
    const reconnect = await invoke('GET', `/api/scenario-assistant/sessions/${id}/events`);
    const snapshot = parseSse(reconnect.res.chunks.join(''));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].type).toBe('session_snapshot');
    expect(snapshot[0].payload.session.streamingMessage).toMatchObject({ text: 'Hello' });
    release();
    const completed = await turn;
    const message = completed.result?.body.session.messages.at(-1);
    expect(message).toMatchObject({ id: delta.payload.messageId, text: 'Hello world' });
    expect(completed.result?.body.session.streamingMessage).toBeUndefined();
    await invoke('DELETE', `/api/scenario-assistant/sessions/${id}`);
  });

  it.each([
    ['alone', false],
    ['with a read-only tool', true]
  ])(
    'accepts a proposal %s through the real route and preserves the scenario input',
    async (_label, withReadOnlyTool) => {
      let turn = 0;
      const { invoke, sessions, scenario, connectAll, listTools, mcpCall } = harness(
        async (definition) => {
          expect(definition.assistant).toBe('scenario');
          expect('scenario' in definition.context ? definition.context.scenario.prompt : '').toBe(
            'Original prompt'
          );
          if (turn++ > 0) return { type: 'assistant_message', text: 'Suggested edits are ready.' };
          return {
            type: 'tool_call_request',
            text: 'Suggested edits',
            toolCalls: [
              {
                id: 'proposal-1',
                name: 'propose_scenario_changes',
                arguments: { prompt: { replacement: 'Revised prompt' }, notes: ['Try edge cases'] }
              },
              ...(withReadOnlyTool
                ? [{ id: 'read-only-1', name: 'server-1__lookup', arguments: { query: 'check' } }]
                : [])
            ]
          };
        },
        withReadOnlyTool
          ? [
              {
                name: 'lookup',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: true }
              }
            ]
          : []
      );
      const originalScenario = structuredClone(scenario);
      mcpCall.mockResolvedValue('read result');
      await invoke('POST', '/api/scenario-assistant/sessions');
      const id = [...sessions.keys()][0]!;
      const stream = await invoke('GET', `/api/scenario-assistant/sessions/${id}/events`);
      const { result } = await invoke('POST', `/api/scenario-assistant/sessions/${id}/messages`, {
        message: 'Improve it'
      });
      expect(result?.status).toBe(200);
      expect(result?.body.response.type).toBe('assistant_message');
      expect(result?.body.response.suggestions).toEqual({
        prompt: { replacement: 'Revised prompt' },
        notes: ['Try edge cases']
      });
      expect(scenario).toEqual(originalScenario);
      expect(mcpCall).toHaveBeenCalledTimes(withReadOnlyTool ? 1 : 0);
      expect(result?.body.response.pendingToolCalls).toBeUndefined();
      const events = parseSse(stream.res.chunks.join(''));
      expect(
        events.some(
          (event) =>
            event.type === 'assistant_message_completed' &&
            event.payload.suggestions?.prompt?.replacement === 'Revised prompt'
        )
      ).toBe(true);
      expect(connectAll).toHaveBeenCalledOnce();
      expect(listTools).toHaveBeenCalledWith('server-1');
      await invoke('DELETE', `/api/scenario-assistant/sessions/${id}`);
      await invoke('DELETE', `/api/scenario-assistant/sessions/${id}`);
      expect(sessions.has(id)).toBe(false);
    }
  );

  it('buffers a proposal while individually approved calls resolve, then returns ordered results and suggestions', async () => {
    const modelMessages: any[][] = [];
    let turn = 0;
    const { invoke, sessions, mcpCall, scenario } = harness(
      async (_definition, messages) => {
        modelMessages.push(messages);
        if (turn++ === 0)
          return {
            type: 'tool_call_request',
            text: 'I will check both tools.',
            toolCalls: [
              {
                id: 'proposal-2',
                name: 'propose_scenario_changes',
                arguments: {
                  prompt: { replacement: 'Updated prompt' },
                  evalRules: {
                    replacement: [
                      { type: 'tool_sequence', sequence: ['server-1__lookup'] },
                      { type: 'response_regex', value: '^ok$' },
                      { type: 'response_regex', value: '^ok$' },
                      { type: 'required_tool', value: 'server-1__lookup' },
                      { type: 'forbidden_tool', value: 'server-1__lookup' }
                    ]
                  },
                  extractRules: { replacement: [{ name: 'key', pattern: 'key=(.+)' }] },
                  notes: ['Review carefully']
                }
              },
              { id: 'read-1', name: 'server-1__lookup', arguments: { query: 'original' } },
              { id: 'write-1', name: 'server-1__update', arguments: { value: 'original' } }
            ]
          };
        return { type: 'assistant_message', text: 'The checks are complete.' };
      },
      [
        {
          name: 'lookup',
          description: 'Read',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true }
        },
        {
          name: 'update',
          description: 'Write',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: false }
        }
      ]
    );
    const originalScenario = structuredClone(scenario);
    const calls = mcpCall.mockImplementation(
      async (_server: string, tool: string, args: unknown) => `${tool}:${JSON.stringify(args)}`
    );
    await invoke('POST', '/api/scenario-assistant/sessions');
    const id = [...sessions.keys()][0]!;
    const stream = await invoke('GET', `/api/scenario-assistant/sessions/${id}/events`);
    const { result: initial } = await invoke(
      'POST',
      `/api/scenario-assistant/sessions/${id}/messages`,
      { message: 'Check and propose' }
    );
    expect(initial?.status).toBe(200);
    expect(initial?.body.response.pendingToolCalls.map((call: any) => call.id)).toEqual([
      'read-1',
      'write-1'
    ]);
    expect(initial?.body.response.suggestions).toBeUndefined();
    const pendingEvents = parseSse(stream.res.chunks.join(''));
    const pendingEvent = pendingEvents.find((event) => event.type === 'tool_call_requested');
    expect(pendingEvent?.payload.pendingToolCalls?.length).toBe(2);
    expect(pendingEvent?.payload.session.messages.at(-1)).not.toHaveProperty('suggestions');
    expect(pendingEvents.some((event) => event.type === 'assistant_message_completed')).toBe(false);

    const { result: read } = await invoke(
      'POST',
      `/api/scenario-assistant/sessions/${id}/tool-calls/read-1/approve`,
      { argumentsOverride: { query: 'edited' } }
    );
    expect(read?.status).toBe(200);
    expect(read?.body.response.type).toBe('tool_call_resolved');
    expect(read?.body.response.pendingToolCalls.map((call: any) => call.id)).toEqual(['write-1']);
    expect(read?.body.response.suggestions).toBeUndefined();
    expect(calls).toHaveBeenCalledOnce();
    expect(calls.mock.calls[0]?.slice(0, 3)).toEqual(['server-1', 'lookup', { query: 'edited' }]);
    const partialEvent = parseSse(stream.res.chunks.join('')).find(
      (event) => event.type === 'tool_call_resolved' && event.payload.pendingToolCallId === 'read-1'
    );
    expect(partialEvent?.payload.session.pendingToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'read-1',
          status: 'approved',
          arguments: { query: 'edited' }
        }),
        expect.objectContaining({ id: 'write-1', status: 'pending' })
      ])
    );
    expect(partialEvent?.payload.session.messages.at(-1)).not.toHaveProperty('suggestions');
    expect(modelMessages).toHaveLength(1);

    const { result: denied } = await invoke(
      'POST',
      `/api/scenario-assistant/sessions/${id}/tool-calls/write-1/deny`
    );
    expect(denied?.status).toBe(200);
    expect(denied?.body.response).toMatchObject({
      type: 'assistant_message',
      text: 'The checks are complete.'
    });
    expect(denied?.body.response.suggestions).toMatchObject({
      prompt: { replacement: 'Updated prompt' },
      notes: ['Review carefully']
    });
    expect(denied?.body.response.suggestions.evalRules.replacement).toEqual([
      { type: 'tool_sequence', sequence: ['lookup'] },
      { type: 'response_equals', value: 'ok' },
      { type: 'required_tool', value: 'lookup' }
    ]);
    expect(denied?.body.response.suggestions.extractRules.replacement).toEqual([
      { name: 'key', pattern: 'key=(.+)' }
    ]);
    expect(calls).toHaveBeenCalledOnce();
    expect(scenario).toEqual(originalScenario);
    const finalMessages = modelMessages.at(-1)!;
    const toolMessages = finalMessages.filter((message) => message.getType() === 'tool');
    expect(toolMessages.map((message) => (message as any).tool_call_id)).toEqual([
      'proposal-2',
      'read-1',
      'write-1'
    ]);
    expect(toolMessages.map((message) => message.content)).toEqual([
      expect.stringContaining('"replacement":"Updated prompt"'),
      '"lookup:{\\"query\\":\\"edited\\"}"',
      '{"denied":true,"reason":"User denied tool call"}'
    ]);
    const callMessage = finalMessages.find((message) => (message as any).tool_calls?.length);
    expect((callMessage as any).tool_calls.map((call: any) => call.id)).toEqual([
      'proposal-2',
      'read-1',
      'write-1'
    ]);
    const callMessageIndex = finalMessages.indexOf(callMessage!);
    expect(
      finalMessages.slice(callMessageIndex + 1).map((message) => (message as any).tool_call_id)
    ).toEqual(['proposal-2', 'read-1', 'write-1']);
    const completedEvent = parseSse(stream.res.chunks.join('')).find(
      (event) => event.type === 'assistant_message_completed'
    );
    expect(completedEvent?.payload.suggestions).toEqual(denied?.body.response.suggestions);
    expect(completedEvent?.payload.session.messages.at(-1)?.suggestions).toEqual(
      denied?.body.response.suggestions
    );
  });

  it('approves all calls sequentially and rejects a repeated approval without replaying MCP calls', async () => {
    let turn = 0;
    const executionOrder: string[] = [];
    const { invoke, sessions, mcpCall } = harness(
      async (_definition, messages) => {
        if (turn++ === 0)
          return {
            type: 'tool_call_request',
            text: 'Need both.',
            toolCalls: [
              {
                id: 'approve-proposal',
                name: 'propose_scenario_changes',
                arguments: {
                  prompt: { replacement: 'Approved proposal prompt' },
                  notes: ['Captured']
                }
              },
              { id: 'first', name: 'server-1__lookup', arguments: { n: 1 } },
              { id: 'second', name: 'server-1__update', arguments: { n: 2 } }
            ]
          };
        return {
          type: 'assistant_message',
          text: `Completed ${messages.filter((message) => message.getType() === 'tool').length} calls.`
        };
      },
      [
        { name: 'lookup', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
        { name: 'update', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }
      ]
    );
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls = mcpCall.mockImplementation(async (_server: string, tool: string, args: any) => {
      executionOrder.push(tool);
      if (tool === 'lookup') {
        markFirstStarted();
        await firstGate;
      }
      return `done-${args.n}`;
    });
    await invoke('POST', '/api/scenario-assistant/sessions');
    const id = [...sessions.keys()][0]!;
    await invoke('POST', `/api/scenario-assistant/sessions/${id}/messages`, {
      message: 'Run both.'
    });
    const approval = invoke(
      'POST',
      `/api/scenario-assistant/sessions/${id}/tool-calls/approve-all`
    );
    await firstStarted;
    expect(executionOrder).toEqual(['lookup']);
    releaseFirst();
    const { result: approved } = await approval;
    expect(approved?.status).toBe(200);
    expect(approved?.body.response).toMatchObject({
      type: 'assistant_message',
      text: 'Completed 3 calls.'
    });
    expect(executionOrder).toEqual(['lookup', 'update']);
    expect(approved?.body.response.suggestions).toEqual({
      prompt: { replacement: 'Approved proposal prompt' },
      notes: ['Captured']
    });
    const { result: duplicate } = await invoke(
      'POST',
      `/api/scenario-assistant/sessions/${id}/tool-calls/first/approve`
    );
    expect(duplicate?.status).toBe(409);
    expect(executionOrder).toEqual(['lookup', 'update']);
    expect(calls!).toHaveBeenCalledTimes(2);
  });

  it('disposes runtime resources and closes an SSE stream once when deleted repeatedly', async () => {
    const { invoke, sessions } = harness(async () => ({
      type: 'assistant_message',
      text: 'unused'
    }));
    await invoke('POST', '/api/scenario-assistant/sessions');
    const id = [...sessions.keys()][0]!;
    const disconnectAll = vi
      .spyOn(McpClientManager.prototype, 'disconnectAll')
      .mockResolvedValue(undefined);
    const stream = await invoke('GET', `/api/scenario-assistant/sessions/${id}/events`);
    await invoke('DELETE', `/api/scenario-assistant/sessions/${id}`);
    await invoke('DELETE', `/api/scenario-assistant/sessions/${id}`);
    expect(disconnectAll).toHaveBeenCalledOnce();
    expect(stream.res.end).toHaveBeenCalledOnce();
    disconnectAll.mockRestore();
  });
});

function parseSse(input: string): Array<{ type: string; payload: Record<string, any> }> {
  return input.split('\n\n').flatMap((chunk) => {
    const data = chunk
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6);
    if (!data) return [];
    return [JSON.parse(data)];
  });
}
