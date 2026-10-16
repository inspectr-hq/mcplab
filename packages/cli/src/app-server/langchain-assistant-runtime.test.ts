import { expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Client, RunTree } from 'langsmith';
import { withRunTree, getCurrentRunTree } from 'langsmith/traceable';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { MemorySaver } from '@langchain/langgraph';
import { assistantRuntimeContract } from '../../test-support/assistant-runtime-contract.js';
import type { AssistantRuntimeEvent } from '@inspectr/mcplab-core';
import { createScriptedRuntimeFactory } from '../../test-support/scripted-chat-model.js';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeSession
} from './assistant-runtime-contract.js';

assistantRuntimeContract('LangGraph assistant runtime', createScriptedRuntimeFactory);

it('fences an abort-ignoring old model completion from a newer turn', async () => {
  let releaseOld!: (value: { type: 'assistant_message'; text: string }) => void;
  let emitOldText!: (delta: string) => void;
  let started!: () => void;
  const oldStarted = new Promise<void>((resolve) => (started = resolve));
  let calls = 0;
  const session = await createScriptedRuntimeFactory(
    async (_definition, _messages, _signal, onText) => {
      calls++;
      if (calls === 1) {
        started();
        emitOldText = onText!;
        return new Promise((resolve) => (releaseOld = resolve));
      }
      return { type: 'assistant_message', text: 'new answer' };
    }
  ).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  const controller = new AbortController();
  const oldTurn = session.sendMessage('old request', controller.signal);
  await oldStarted;
  controller.abort();
  await expect(oldTurn).rejects.toThrow();
  await expect(session.sendMessage('new request')).resolves.toMatchObject({ text: 'new answer' });
  const current = session.getSnapshot();
  releaseOld({ type: 'assistant_message', text: 'late old answer' });
  emitOldText('late old token');
  await Promise.resolve();
  expect(session.getSnapshot()).toEqual(current);
});

it('publishes each streamed fragment with a live snapshot and reuses its message ID', async () => {
  const observed: Array<{
    event: AssistantRuntimeEvent;
    snapshot: AssistantRuntimeSession['getSnapshot'] extends () => infer S ? S : never;
  }> = [];
  let session!: AssistantRuntimeSession;
  session = await createScriptedRuntimeFactory(async (_definition, _messages, _signal, onText) => {
    onText?.('hel');
    onText?.('lo');
    return { type: 'assistant_message', text: 'hello' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required',
    onEvent: (event) => observed.push({ event, snapshot: session.getSnapshot() })
  } satisfies AssistantRuntimeDefinition);

  await expect(session.sendMessage('question')).resolves.toMatchObject({
    type: 'assistant_message',
    text: 'hello'
  });
  const deltas = observed.filter(({ event }) => event.type === 'assistant_message_delta');
  expect(deltas.map(({ event }) => event.payload)).toMatchObject([
    { offset: 0, delta: 'hel', revision: expect.any(Number) },
    { offset: 3, delta: 'lo', revision: expect.any(Number) }
  ]);
  expect(deltas.map(({ snapshot }) => snapshot.streamingMessage?.text)).toEqual(['hel', 'hello']);
  expect(deltas.every(({ snapshot }) => snapshot.activeTurnId)).toBe(true);
  expect(deltas.map(({ event }) => event.payload.revision)).toEqual(
    deltas.map(({ snapshot }) => snapshot.revision)
  );
  expect(deltas[1]!.snapshot.revision).toBeGreaterThan(deltas[0]!.snapshot.revision);
  expect(deltas[0]?.event.payload.messageId).toBe(
    session.getSnapshot().messages.find((message) => message.role === 'assistant')?.id
  );
  expect(session.getSnapshot()).not.toHaveProperty('streamingMessage');
  expect(session.getSnapshot()).not.toHaveProperty('activeTurnId');
  await session.dispose();
});

it('uses the supplied logical turn ID and rejects reusing it', async () => {
  const session = await createScriptedRuntimeFactory(async () => ({
    type: 'tool_call_request',
    text: 'Need approval',
    toolCalls: [{ id: 'pending-call', name: 'write', arguments: {} }]
  })).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute: async () => ({ ok: true }) }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);

  await session.sendMessage('write', undefined, 'client-turn-1');
  expect(session.getSnapshot().activeTurnId).toBe('client-turn-1');
  expect(session.getSnapshot().messages).toContainEqual(
    expect.objectContaining({ id: 'client-turn-1', role: 'user', text: 'write' })
  );
  await expect(session.sendMessage('again', undefined, 'client-turn-1')).rejects.toMatchObject({
    statusCode: 409
  });
  await session.cancel('client-turn-1');
  await expect(session.sendMessage('new', undefined, 'client-turn-2')).resolves.toBeDefined();
  expect(session.getSnapshot().activeTurnId).toBe('client-turn-2');
  await session.cancel('client-turn-1');
  expect(session.getSnapshot().activeTurnId).toBe('client-turn-2');
  await session.cancel('client-turn-2');
  expect(session.getSnapshot()).not.toHaveProperty('activeTurnId');
  await session.dispose();
});

it('reuses the streamed message ID when that model round requests tools', async () => {
  const events: AssistantRuntimeEvent[] = [];
  const session = await createScriptedRuntimeFactory(
    async (_definition, _messages, _signal, onText) => {
      onText?.('Looking it up');
      return {
        type: 'tool_call_request',
        text: 'Looking it up',
        toolCalls: [{ id: 'lookup-call', name: 'lookup', arguments: {} }]
      };
    }
  ).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'lookup', server: 's', tool: 'lookup', execute: async () => 'unused' }],
    approvalPolicy: () => 'approval_required',
    onEvent: (event) => events.push(event)
  } satisfies AssistantRuntimeDefinition);

  await session.sendMessage('lookup');
  const streamedId = events.find((event) => event.type === 'assistant_message_delta')?.payload
    .messageId;
  expect(
    session.getSnapshot().messages.find((message) => message.role === 'assistant')
  ).toMatchObject({
    id: streamedId,
    text: 'Looking it up',
    pendingToolCallId: 'lookup-call'
  });
  expect(session.getSnapshot()).not.toHaveProperty('streamingMessage');
  expect(session.getSnapshot().activeTurnId).toBeTruthy();
  await session.dispose();
});

it('cancels a paused batch by logical turn ID and ignores stale IDs', async () => {
  const session = await createScriptedRuntimeFactory(async () => ({
    type: 'tool_call_request',
    text: 'Need approval',
    toolCalls: [{ id: 'pending-call', name: 'write', arguments: {} }]
  })).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute: async () => ({ ok: true }) }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);

  await session.sendMessage('write');
  const turnId = session.getSnapshot().activeTurnId!;
  expect(session.getSnapshot().pendingToolCalls[0]?.status).toBe('pending');
  await session.cancel('stale-turn');
  expect(session.getSnapshot().activeTurnId).toBe(turnId);
  await session.cancel(turnId);
  expect(session.getSnapshot()).not.toHaveProperty('activeTurnId');
  expect(session.getSnapshot()).not.toHaveProperty('streamingMessage');
  expect(session.getSnapshot().pendingToolCalls[0]).toMatchObject({
    id: 'pending-call',
    status: 'error'
  });
  await session.cancel(turnId);
  expect(session.getSnapshot().pendingToolCalls[0]?.status).toBe('error');
  await session.dispose();
});

it('publishes a cleared snapshot after a streamed model failure', async () => {
  let session!: AssistantRuntimeSession;
  const observations: Array<{
    type: string;
    snapshot: ReturnType<AssistantRuntimeSession['getSnapshot']>;
  }> = [];
  session = await createScriptedRuntimeFactory(async (_definition, _messages, _signal, onText) => {
    onText?.('partial');
    throw new Error('provider stream broke');
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required',
    onEvent: (event) => observations.push({ type: event.type, snapshot: session.getSnapshot() })
  } satisfies AssistantRuntimeDefinition);

  await expect(session.sendMessage('question')).rejects.toThrow('provider stream broke');
  const terminal = observations.find(({ type }) => type === 'session_snapshot');
  expect(terminal?.snapshot).not.toHaveProperty('streamingMessage');
  expect(terminal?.snapshot).not.toHaveProperty('activeTurnId');
  expect(observations.map(({ type }) => type)).toContain('assistant_message_delta');
  const delta = observations.find(({ type }) => type === 'assistant_message_delta')?.snapshot;
  expect(delta?.revision).toBeGreaterThan(0);
  expect(terminal?.snapshot.revision).toBeGreaterThan(delta?.revision ?? 0);
  await session.dispose();
});

const definitionWith = (
  overrides: Partial<AssistantRuntimeDefinition> = {}
): AssistantRuntimeDefinition => ({
  assistant: 'result',
  agent: { provider: 'openai', model: 'test' },
  context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
  getSystemPrompt: () => 'Prompt',
  tools: [],
  approvalPolicy: () => 'approval_required',
  ...overrides
});

it('stamps each model reply with its own ID even when the provider repeats one', async () => {
  const histories: BaseMessage[][] = [];
  const session = await createScriptedRuntimeFactory(async (_definition, messages) => {
    histories.push(messages);
    return {
      type: 'assistant_message',
      text: `answer-${histories.length}`,
      nativeMessage: new AIMessage({
        id: 'same-provider-id',
        content: `answer-${histories.length}`
      })
    };
  }).create(definitionWith());
  await session.sendMessage('first');
  await session.sendMessage('second');
  await session.sendMessage('third');
  const assistantIds = session
    .getSnapshot()
    .messages.filter((message) => message.role === 'assistant')
    .map((message) => message.id);
  expect(new Set(assistantIds).size).toBe(3);
  // The model still sees every earlier answer: no reply was overwritten by the repeated ID.
  expect(
    histories[2]!.filter((message) => AIMessage.isInstance(message)).map((m) => m.content)
  ).toEqual(['answer-1', 'answer-2']);
  await session.dispose();
});

it('answers every call exactly once when a new message supersedes a partly approved batch', async () => {
  const histories: BaseMessage[][] = [];
  const write = vi.fn(async (args: unknown) => ({ wrote: args }));
  let round = 0;
  const session = await createScriptedRuntimeFactory(async (_definition, messages) => {
    histories.push(messages);
    round += 1;
    return round === 1
      ? {
          type: 'tool_call_request',
          text: 'Two writes',
          toolCalls: [
            { id: 'w1', name: 'write', arguments: { n: 1 } },
            { id: 'w2', name: 'write', arguments: { n: 2 } }
          ]
        }
      : { type: 'assistant_message', text: 'New topic' };
  }).create(
    definitionWith({ tools: [{ name: 'write', server: 's', tool: 'write', execute: write }] })
  );

  const request = await session.sendMessage('Write twice');
  expect(request).toMatchObject({ type: 'tool_call_request' });
  const partial = await session.resolveToolCalls([
    { toolCallId: 'w1', decision: 'approve', arguments: { n: 10 } }
  ]);
  expect(partial).toMatchObject({ type: 'tool_call_resolved', pendingToolCalls: [{ id: 'w2' }] });
  expect(write).toHaveBeenCalledExactlyOnceWith({ n: 10 }, expect.any(AbortSignal));

  await expect(session.sendMessage('Something else')).resolves.toMatchObject({
    text: 'New topic'
  });
  const results = histories[1]!.filter((message) => ToolMessage.isInstance(message));
  expect(results.map((message) => message.tool_call_id).sort()).toEqual(['w1', 'w2']);
  expect(String(results.find((m) => m.tool_call_id === 'w1')?.content)).toContain('10');
  expect(String(results.find((m) => m.tool_call_id === 'w2')?.content)).toContain('skipped');
  expect(histories[1]!.at(-1)).toBeInstanceOf(HumanMessage);
  expect(session.getSnapshot().pendingToolCalls.map((call) => call.status)).toEqual([
    'approved',
    'denied'
  ]);
  expect(write).toHaveBeenCalledOnce();
  await session.dispose();
});

it('answers provider-malformed calls with an error while approving valid siblings', async () => {
  const execute = vi.fn(async () => ({ value: 'ok' }));
  const seen: BaseMessage[][] = [];
  const session = await createScriptedRuntimeFactory(async (_definition, messages) => {
    seen.push(messages);
    if (seen.length > 1) return { type: 'assistant_message', text: 'Done' };
    return {
      type: 'tool_call_request',
      text: 'Working',
      toolCalls: [],
      nativeMessage: new AIMessage({
        content: [{ type: 'text', text: 'Working' }],
        response_metadata: { provider: 'openai' },
        tool_calls: [{ id: 'valid', name: 'write', args: { value: 1 }, type: 'tool_call' }],
        invalid_tool_calls: [
          {
            id: 'malformed',
            name: 'write',
            args: '{broken',
            error: 'Malformed JSON',
            type: 'invalid_tool_call'
          }
        ]
      })
    };
  }).create(definitionWith({ tools: [{ name: 'write', server: 's', tool: 'write', execute }] }));

  const pending = await session.sendMessage('write');
  expect(pending).toMatchObject({ type: 'tool_call_request', pendingToolCalls: [{ id: 'valid' }] });
  expect(session.getSnapshot().pendingToolCalls).toMatchObject([
    { id: 'valid', status: 'pending' },
    { id: 'malformed', status: 'error', error: expect.stringContaining('Malformed JSON') }
  ]);
  await session.resolveToolCalls([{ toolCallId: 'valid', decision: 'approve' }]);
  expect(execute).toHaveBeenCalledOnce();
  const followup = seen[1]!;
  const assistant = followup.find((message) => AIMessage.isInstance(message)) as AIMessage;
  expect(assistant.response_metadata).toMatchObject({ provider: 'openai' });
  expect(assistant.tool_calls?.map((call) => call.id).sort()).toEqual(['malformed', 'valid']);
  expect(assistant.invalid_tool_calls ?? []).toEqual([]);
  expect(
    followup
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message.tool_call_id)
      .sort()
  ).toEqual(['malformed', 'valid']);
  await session.dispose();
});

it('isolates assistant trace export inside an inherited evaluation trace', async () => {
  vi.stubEnv('LANGSMITH_TRACING', 'true');
  vi.stubEnv('LANGCHAIN_TRACING_V2', 'true');
  vi.stubEnv('LANGCHAIN_TRACING', 'true');
  vi.stubEnv('LANGSMITH_ENDPOINT', 'https://assistant-export-leak.invalid');
  const exportedRequests: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body =
        init.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : String(init.body ?? '');
      exportedRequests.push({ url, body });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const observed: boolean[] = [];
  let modelRounds = 0;
  let releaseTool!: () => void;
  let markToolStarted!: () => void;
  const toolStarted = new Promise<void>((resolve) => (markToolStarted = resolve));
  const toolGate = new Promise<void>((resolve) => (releaseTool = resolve));
  const execute = vi.fn(async () => {
    markToolStarted();
    await toolGate;
    return { ok: true };
  });
  const session = await createScriptedRuntimeFactory(async () => {
    observed.push(getCurrentRunTree().tracingEnabled === true);
    modelRounds++;
    if (modelRounds === 1)
      return {
        type: 'tool_call_request' as const,
        text: 'Using the tool.',
        toolCalls: [
          { id: 'private-tool-call', name: 'lookup', arguments: { secret: 'private-input' } }
        ],
        nativeMessage: new AIMessage({
          content: 'Using the tool.',
          tool_calls: [
            {
              id: 'private-tool-call',
              name: 'lookup',
              args: { secret: 'private-input' },
              type: 'tool_call'
            }
          ]
        })
      };
    return { type: 'assistant_message', text: 'answer' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'lookup', server: 'private', tool: 'lookup', execute }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  const evaluationClient = new Client({
    apiUrl: 'https://trace.test',
    apiKey: 'test-key',
    tracingSamplingRate: 1
  });
  const evaluationRun = new RunTree({
    name: 'MCPLab Assistant',
    run_type: 'chain',
    tracingEnabled: true,
    inputs: { evaluation: 'eval-only' },
    client: evaluationClient
  });
  try {
    await withRunTree(evaluationRun, async () => {
      expect(getCurrentRunTree().tracingEnabled).toBe(true);
      const pending = await session.sendMessage('hello');
      expect(pending.type).toBe('tool_call_request');
      const approval = session.resolveToolCalls([
        { toolCallId: 'private-tool-call', decision: 'approve' }
      ]);
      await toolStarted;
      const concurrentEvaluation = new RunTree({
        name: 'Concurrent Evaluation',
        run_type: 'chain',
        tracingEnabled: true,
        inputs: { evaluation: 'eval-only' },
        client: evaluationClient
      });
      await concurrentEvaluation.postRun();
      await evaluationClient.awaitPendingTraceBatches();
      releaseTool();
      await approval;
      await awaitAllCallbacks();
      await session.dispose();
      expect(getCurrentRunTree().tracingEnabled).toBe(true);
    });
    expect(observed).toEqual([true, true]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(evaluationRun.tracingEnabled).toBe(true);
    expect(exportedRequests).toHaveLength(1);
    expect(exportedRequests[0]!.body).toContain('eval-only');
    expect(exportedRequests.some((request) => request.body.includes('private-input'))).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

it('exports assistant traces only when MCPLAB_ASSISTANT_TRACING opts in', async () => {
  vi.stubEnv('LANGSMITH_TRACING', 'true');
  vi.stubEnv('LANGSMITH_API_KEY', 'test-key');
  vi.stubEnv('LANGSMITH_ENDPOINT', 'https://assistant-trace.test');
  vi.stubEnv('MCPLAB_ASSISTANT_TRACING', 'true');
  const exported: string[] = [];
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST')
      exported.push(
        init.body instanceof ReadableStream
          ? await new Response(init.body).text()
          : String(init.body ?? '')
      );
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const session = await createScriptedRuntimeFactory(async () => ({
      type: 'assistant_message',
      text: 'traced answer'
    })).create(definitionWith());
    await session.sendMessage('opt-in question');
    await awaitAllCallbacks();
    await new Client().awaitPendingTraceBatches();
    expect(exported.some((body) => body.includes('opt-in question'))).toBe(true);
    await session.dispose();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

it('keeps every session on its own thread of one shared checkpointer', async () => {
  const checkpointer = new MemorySaver();
  const factory = createScriptedRuntimeFactory(
    async (_definition, messages) => ({
      type: 'assistant_message',
      text: `seen ${messages.length}`
    }),
    { checkpointer }
  );
  const first = await factory.create(definitionWith());
  const second = await factory.create(definitionWith());
  await first.sendMessage('one');
  await first.sendMessage('two');
  await expect(second.sendMessage('alone')).resolves.toMatchObject({ text: 'seen 1' });
  const threads = () => new Set(Object.keys((checkpointer as any).storage));
  expect(threads().size).toBe(2);
  await first.dispose();
  expect(threads().size).toBe(1);
  await expect(second.sendMessage('still here')).resolves.toMatchObject({ text: 'seen 3' });
  await second.dispose();
  expect(threads().size).toBe(0);
});

it('drops tokens from an abandoned model run while a newer turn is streaming', async () => {
  let emitOld!: (delta: string) => void;
  let oldStarted!: () => void;
  const oldReady = new Promise<void>((resolve) => (oldStarted = resolve));
  let releaseNew!: () => void;
  let newStreaming!: () => void;
  const newReady = new Promise<void>((resolve) => (newStreaming = resolve));
  const newGate = new Promise<void>((resolve) => (releaseNew = resolve));
  let calls = 0;
  const events: AssistantRuntimeEvent[] = [];
  const session = await createScriptedRuntimeFactory(
    async (_definition, _messages, _signal, onText) => {
      calls += 1;
      if (calls === 1) {
        emitOld = onText!;
        oldStarted();
        return new Promise(() => undefined); // ignores abort, never settles
      }
      onText?.('new');
      newStreaming();
      await newGate;
      return { type: 'assistant_message', text: 'new answer' };
    }
  ).create(definitionWith({ onEvent: (event) => events.push(event) }));
  const controller = new AbortController();
  const oldTurn = session.sendMessage('old', controller.signal);
  await oldReady;
  controller.abort();
  await expect(oldTurn).rejects.toThrow();
  const newTurn = session.sendMessage('new');
  await newReady;
  emitOld(' OLD LEAK');
  await Promise.resolve();
  expect(session.getSnapshot().streamingMessage?.text).toBe('new');
  releaseNew();
  await expect(newTurn).resolves.toMatchObject({ text: 'new answer' });
  const streamed = events
    .filter((event) => event.type === 'assistant_message_delta')
    .map((event) => event.payload.delta)
    .join('');
  expect(streamed).not.toContain('OLD LEAK');
  await session.dispose();
});

it('does not attach a cancelled turn’s late proposal to the next answer', async () => {
  let finishProposal!: (value: unknown) => void;
  let proposalStarted!: () => void;
  const started = new Promise<void>((resolve) => (proposalStarted = resolve));
  let round = 0;
  let secondModelStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => (secondModelStarted = resolve));
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
  const session = await createScriptedRuntimeFactory(async () => {
    round += 1;
    if (round === 1)
      return {
        type: 'tool_call_request',
        text: 'Proposing',
        toolCalls: [{ id: 'late-proposal', name: 'propose', arguments: {} }]
      };
    secondModelStarted();
    await secondGate;
    return { type: 'assistant_message', text: 'Unrelated answer' };
  }).create(
    definitionWith({
      tools: [
        {
          name: 'propose',
          server: 'local',
          tool: 'propose',
          execute: () => {
            proposalStarted();
            return new Promise((resolve) => (finishProposal = resolve));
          },
          extractProposal: (value) => value as any
        }
      ],
      approvalPolicy: () => 'local'
    })
  );
  const controller = new AbortController();
  const first = session.sendMessage('propose', controller.signal);
  await started;
  controller.abort();
  await expect(first).rejects.toThrow();
  const second = session.sendMessage('something else');
  // The cancelled tool finishes while the new turn is in progress.
  await secondStarted;
  finishProposal({ prompt: { replacement: 'leaked' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseSecond();
  await expect(second).resolves.not.toHaveProperty('suggestions');
  expect(session.getSnapshot().messages.at(-1)).not.toHaveProperty('suggestions');
  await session.dispose();
});

it('rejects a decision batch with invalid edited arguments without changing any call', async () => {
  const execute = vi.fn(async () => ({ ok: true }));
  let round = 0;
  const session = await createScriptedRuntimeFactory(async () => {
    round += 1;
    return round === 1
      ? {
          type: 'tool_call_request',
          text: 'Two writes',
          toolCalls: [
            { id: 'a', name: 'write', arguments: {} },
            { id: 'b', name: 'write', arguments: {} }
          ]
        }
      : { type: 'assistant_message', text: 'Done' };
  }).create(definitionWith({ tools: [{ name: 'write', server: 's', tool: 'write', execute }] }));
  await session.sendMessage('write');
  await expect(
    session.resolveToolCalls([
      { toolCallId: 'a', decision: 'approve' },
      { toolCallId: 'b', decision: 'approve', arguments: 'not an object' }
    ])
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(session.getSnapshot().pendingToolCalls.map((call) => call.status)).toEqual([
    'pending',
    'pending'
  ]);
  expect(execute).not.toHaveBeenCalled();
  await expect(
    session.resolveToolCalls([{ toolCallId: 'a', decision: 'approve' }])
  ).resolves.toMatchObject({ type: 'tool_call_resolved', pendingToolCalls: [{ id: 'b' }] });
  expect(execute).toHaveBeenCalledOnce();
  await session.dispose();
});

it('cancels a running turn directly, without the service aborting it', async () => {
  let modelStarted!: () => void;
  const started = new Promise<void>((resolve) => (modelStarted = resolve));
  const session = await createScriptedRuntimeFactory(async (_definition, _messages, signal) => {
    modelStarted();
    return new Promise((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(new Error('aborted by cancel')), {
        once: true
      })
    );
  }).create(definitionWith());
  const turn = session.sendMessage('blocked', undefined, 'direct-cancel');
  await started;
  await session.cancel('direct-cancel');
  await expect(turn).rejects.toThrow();
  expect(session.getSnapshot()).not.toHaveProperty('activeTurnId');
  await session.dispose();
});

it('shows each call with its tool details and timing, and passes a deny reason to the model', async () => {
  const histories: BaseMessage[][] = [];
  const session = await createScriptedRuntimeFactory(async (_definition, messages) => {
    histories.push(messages);
    return histories.length === 1
      ? {
          type: 'tool_call_request',
          text: 'Reading, then writing',
          toolCalls: [
            { id: 'r1', name: 'read', arguments: {} },
            { id: 'w1', name: 'write', arguments: { path: '/etc/app' } }
          ]
        }
      : { type: 'assistant_message', text: 'Understood' };
  }).create(
    definitionWith({
      tools: [
        {
          name: 'read',
          server: 's',
          tool: 'read',
          execute: async () => ({ ok: true })
        },
        {
          name: 'write',
          server: 's',
          tool: 'write',
          inputSchema: { properties: { path: { type: 'string', title: 'File path' } } },
          display: {
            title: 'Write a file',
            description: 'Overwrites a file.',
            hints: { destructive: true }
          },
          execute: vi.fn(async () => ({ ok: true }))
        }
      ],
      approvalPolicy: (name) => (name === 'read' ? 'automatic' : 'approval_required')
    })
  );
  await session.sendMessage('go');
  const byId = () =>
    Object.fromEntries(session.getSnapshot().pendingToolCalls.map((call) => [call.id, call]));
  expect(byId().r1).toMatchObject({ requiresApproval: false, status: 'approved' });
  expect(byId().r1!.startedAt).toBeDefined();
  expect(byId().r1!.completedAt).toBeDefined();
  expect(byId().w1).toMatchObject({
    requiresApproval: true,
    status: 'pending',
    title: 'Write a file',
    description: 'Overwrites a file.',
    hints: { destructive: true },
    argumentLabels: { path: 'File path' }
  });

  await expect(
    session.resolveToolCalls([{ toolCallId: 'w1', decision: 'deny', message: 'x'.repeat(2001) }])
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(byId().w1!.status).toBe('pending');

  await expect(
    session.resolveToolCalls([
      { toolCallId: 'w1', decision: 'deny', message: ' Use /tmp instead ' }
    ])
  ).resolves.toMatchObject({ type: 'assistant_message', text: 'Understood' });
  expect(byId().w1).toMatchObject({ status: 'denied', denyMessage: 'Use /tmp instead' });
  expect(byId().w1!.startedAt).toBeUndefined();
  const denial = histories[1]!.find(
    (message): message is ToolMessage =>
      ToolMessage.isInstance(message) && message.tool_call_id === 'w1'
  );
  expect(JSON.parse(String(denial?.content))).toEqual({
    denied: true,
    reason: 'User denied tool call',
    message: 'Use /tmp instead'
  });
  await session.dispose();
});

it('adds no placeholder text when the model requests tools without writing anything', async () => {
  const session = await createScriptedRuntimeFactory(async () => ({
    type: 'tool_call_request',
    text: '',
    toolCalls: [{ id: 'w1', name: 'write', arguments: {} }]
  })).create(
    definitionWith({
      tools: [{ name: 'write', server: 's', tool: 'write', execute: async () => ({}) }]
    })
  );
  await expect(session.sendMessage('go')).resolves.toMatchObject({
    type: 'tool_call_request',
    text: ''
  });
  const request = session.getSnapshot().messages.find((message) => message.role === 'assistant');
  expect(request).toMatchObject({ text: '', pendingToolCallIds: ['w1'] });
  await session.dispose();
});

it('announces a second approval batch that the model requests later in the same turn', async () => {
  const events: AssistantRuntimeEvent[] = [];
  let round = 0;
  const session = await createScriptedRuntimeFactory(async () => {
    round += 1;
    if (round === 1)
      return {
        type: 'tool_call_request',
        text: 'First write',
        toolCalls: [{ id: 'w1', name: 'write', arguments: {} }]
      };
    if (round === 2)
      return {
        type: 'tool_call_request',
        text: 'One more write',
        toolCalls: [{ id: 'w2', name: 'write', arguments: {} }]
      };
    return { type: 'assistant_message', text: 'Done' };
  }).create(
    definitionWith({
      tools: [{ name: 'write', server: 's', tool: 'write', execute: async () => ({ ok: true }) }],
      onEvent: (event) => events.push(event)
    })
  );
  await session.sendMessage('write twice');
  await expect(
    session.resolveToolCalls([{ toolCallId: 'w1', decision: 'approve' }])
  ).resolves.toMatchObject({
    type: 'tool_call_request',
    text: 'One more write',
    pendingToolCalls: [{ id: 'w2' }]
  });
  const requested = events
    .filter((event) => event.type === 'tool_call_requested')
    .map((event) => event.payload.pendingToolCallId);
  expect(requested).toEqual(['w1', 'w2']);
  await session.dispose();
});
