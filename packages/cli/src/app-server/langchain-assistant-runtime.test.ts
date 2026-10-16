import { expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Client, RunTree } from 'langsmith';
import { withRunTree, getCurrentRunTree } from 'langsmith/traceable';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { MemorySaver } from '@langchain/langgraph';
import { assistantRuntimeContract } from '../../test-support/assistant-runtime-contract.js';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeSession
} from '@inspectr/mcplab-core';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';

assistantRuntimeContract('LangGraph assistant runtime', createLangChainAssistantRuntimeFactory);

it('fences an abort-ignoring old model completion from a newer turn', async () => {
  let releaseOld!: (value: { type: 'assistant_message'; text: string }) => void;
  let emitOldText!: (delta: string) => void;
  let started!: () => void;
  const oldStarted = new Promise<void>((resolve) => (started = resolve));
  let calls = 0;
  const session = await createLangChainAssistantRuntimeFactory(
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
  session = await createLangChainAssistantRuntimeFactory(
    async (_definition, _messages, _signal, onText) => {
      onText?.('hel');
      onText?.('lo');
      return { type: 'assistant_message', text: 'hello' };
    }
  ).create({
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
  const session = await createLangChainAssistantRuntimeFactory(async () => ({
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
  const session = await createLangChainAssistantRuntimeFactory(
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
  const session = await createLangChainAssistantRuntimeFactory(async () => ({
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
  session = await createLangChainAssistantRuntimeFactory(
    async (_definition, _messages, _signal, onText) => {
      onText?.('partial');
      throw new Error('provider stream broke');
    }
  ).create({
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

it('keeps UI message IDs unique when the provider repeats its native response ID', async () => {
  const histories: BaseMessage[][] = [];
  const session = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
    histories.push(messages);
    return {
      type: 'assistant_message' as const,
      text: 'answer',
      nativeMessage: new AIMessage({ id: 'reused-provider-id', content: 'answer' })
    };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);

  await session.sendMessage('first');
  await session.sendMessage('second');

  const visibleIds = session.getSnapshot().messages.map((message) => message.id);
  expect(new Set(visibleIds).size).toBe(visibleIds.length);
  expect(histories[1]?.filter((message) => AIMessage.isInstance(message)).at(-1)?.id).toBe(
    'reused-provider-id'
  );
});

it('retains repeated native IDs across three messages and isolates sessions from one factory', async () => {
  const histories: BaseMessage[][] = [];
  const factory = createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
    histories.push(messages);
    return {
      type: 'assistant_message',
      text: 'answer',
      nativeMessage: new AIMessage({
        id: 'same-id',
        content: 'answer',
        response_metadata: { retained: true }
      })
    };
  });
  const definition = {
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition;
  const first = await factory.create(definition);
  const second = await factory.create(definition);
  await first.sendMessage('one');
  await first.sendMessage('two');
  await first.sendMessage('three');
  await second.sendMessage('separate');

  const nativeHistory = histories[2]!.filter((message) => AIMessage.isInstance(message));
  expect(nativeHistory).toHaveLength(2);
  expect(nativeHistory.map((message) => message.id)).toEqual([
    'same-id',
    expect.stringMatching(/^same-id#msg-/)
  ]);
  expect(nativeHistory[1]?.response_metadata).toEqual({ retained: true });
  expect(histories[3]?.filter((message) => AIMessage.isInstance(message))).toHaveLength(0);
  const finalSnapshot = first.getSnapshot();
  await first.dispose();
  expect(first.getSnapshot()).toEqual(finalSnapshot);
  await second.sendMessage('still isolated');
  expect(histories[4]?.filter((message) => AIMessage.isInstance(message))).toHaveLength(1);
  await Promise.all([second.dispose(), second.dispose()]);
});

it('cancels a client turn during checkpoint preflight before its first snapshot', async () => {
  const modelCall = vi.fn(async () => ({ type: 'assistant_message' as const, text: 'unused' }));
  const session = await createLangChainAssistantRuntimeFactory(modelCall).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'automatic'
  });
  const originalRead = MemorySaver.prototype.getTuple;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = vi.spyOn(MemorySaver.prototype, 'getTuple').mockImplementationOnce(async function (
    this: MemorySaver,
    config: Parameters<MemorySaver['getTuple']>[0]
  ) {
    enter();
    await gate;
    return originalRead.call(this, config);
  });
  try {
    const turn = session.sendMessage('question', undefined, 'client-preflight');
    const outcome = expect(turn).rejects.toThrow('aborted');
    await entered;
    expect(session.getSnapshot().activeTurnId).toBeUndefined();
    const cancelling = session.cancel('client-preflight');
    release();
    await cancelling;
    await outcome;
    expect(modelCall).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    await session.dispose();
  }
});

it('settles checkpoint preflight before disposal deletes its thread', async () => {
  const originalGetTuple = MemorySaver.prototype.getTuple;
  let gate = false;
  let entered!: () => void;
  let release!: () => void;
  const enteredRead = new Promise<void>((resolve) => (entered = resolve));
  const gateRead = new Promise<void>((resolve) => (release = resolve));
  let saver: MemorySaver | undefined;
  let config: Parameters<MemorySaver['getTuple']>[0] | undefined;
  vi.spyOn(MemorySaver.prototype, 'getTuple').mockImplementation(async function (
    this: MemorySaver,
    threadConfig: Parameters<MemorySaver['getTuple']>[0]
  ) {
    if (gate) {
      gate = false;
      saver = this;
      config = threadConfig;
      entered();
      await gateRead;
    }
    return originalGetTuple.call(this, threadConfig);
  });
  let modelCalls = 0;
  const session = await createLangChainAssistantRuntimeFactory(async () => {
    modelCalls++;
    return { type: 'assistant_message', text: 'should not run' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  gate = true;
  const pending = session.sendMessage('dispose during preflight');
  await enteredRead;
  const disposal = session.dispose();
  release();
  await expect(pending).rejects.toThrow();
  await disposal;
  expect(modelCalls).toBe(0);
  expect(await saver!.getTuple(config!)).toBeUndefined();
  vi.restoreAllMocks();
});

it('stops supersession after terminal cleanup when an observer fails, then permits a fresh turn', async () => {
  let modelCalls = 0;
  let failObserver = true;
  const execute = vi.fn(async () => ({ ok: true }));
  const session = await createLangChainAssistantRuntimeFactory(async () => {
    modelCalls++;
    return modelCalls === 1
      ? {
          type: 'tool_call_request',
          text: 'write',
          toolCalls: [{ id: 'paused-write', name: 'write', arguments: {} }]
        }
      : { type: 'assistant_message', text: 'fresh answer' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute }],
    approvalPolicy: () => 'approval_required',
    onEvent: (event) => {
      if (failObserver && event.type === 'tool_call_resolved') {
        failObserver = false;
        throw new Error('observer failed during supersession');
      }
    }
  } satisfies AssistantRuntimeDefinition);
  await session.sendMessage('pause');
  await expect(session.sendMessage('must not begin')).rejects.toThrow(
    'observer failed during supersession'
  );
  expect(modelCalls).toBe(1);
  expect(session.getSnapshot().messages.filter((message) => message.role === 'tool')).toHaveLength(
    1
  );
  expect(execute).not.toHaveBeenCalled();
  await expect(session.sendMessage('fresh turn')).resolves.toMatchObject({
    type: 'assistant_message',
    text: 'fresh answer'
  });
  expect(modelCalls).toBe(2);
  expect(execute).not.toHaveBeenCalled();
  await session.dispose();
});

it('updates the snapshot before tool observers run and isolates event payload mutation', async () => {
  let session: AssistantRuntimeSession;
  let rounds = 0;
  let observedStatus: string | undefined;
  const definition = {
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'lookup', server: 's', tool: 'lookup', execute: async () => ({ ok: true }) }],
    approvalPolicy: () => 'local',
    onEvent: (event: { type: string; payload: Record<string, any> }) => {
      if (event.type !== 'tool_call_resolved') return;
      const call = event.payload.pendingToolCall;
      observedStatus = session
        .getSnapshot()
        .pendingToolCalls.find((item) => item.id === call.id)?.status;
      call.status = 'error';
    }
  } satisfies AssistantRuntimeDefinition;
  session = await createLangChainAssistantRuntimeFactory(async () => {
    rounds++;
    return rounds === 1
      ? {
          type: 'tool_call_request',
          text: 'lookup',
          toolCalls: [{ id: 'observer-call', name: 'lookup', arguments: {} }]
        }
      : { type: 'assistant_message', text: 'done' };
  }).create(definition);
  await session.sendMessage('lookup');
  expect(observedStatus).toBe('approved');
  expect(session.getSnapshot().pendingToolCalls[0]).toMatchObject({
    id: 'observer-call',
    status: 'approved'
  });
  await session.dispose();
});

it('checkpoints a pending batch, its proposal, and model-call budget before approval', async () => {
  const originalGetTuple = MemorySaver.prototype.getTuple;
  const reads: Array<{ saver: MemorySaver; config: Parameters<MemorySaver['getTuple']>[0] }> = [];
  vi.spyOn(MemorySaver.prototype, 'getTuple').mockImplementation(async function (
    this: MemorySaver,
    config: Parameters<MemorySaver['getTuple']>[0]
  ) {
    reads.push({ saver: this, config });
    return originalGetTuple.call(this, config);
  });
  let rounds = 0;
  const modelHistories: BaseMessage[][] = [];
  const execute = vi.fn(async ({ id }: { id: string }) => ({ id, artifact: 'x'.repeat(10_000) }));
  const extractProposal = vi.fn(() => ({ prompt: { replacement: 'proposed prompt' } }));
  let session: AssistantRuntimeSession | undefined;
  try {
    session = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
      rounds++;
      modelHistories.push(messages);
      return rounds === 1
        ? {
            type: 'tool_call_request',
            text: 'write',
            toolCalls: [
              { id: 'proposal', name: 'suggest', arguments: {} },
              { id: 'write-1', name: 'write', arguments: { id: 'write-1' } },
              { id: 'write-2', name: 'write', arguments: { id: 'write-2' } }
            ]
          }
        : { type: 'assistant_message', text: 'done' };
    }).create({
      assistant: 'scenario',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'Prompt',
      tools: [
        {
          name: 'suggest',
          server: 'local',
          tool: 'suggest',
          execute: async () => ({ ok: true }),
          extractProposal
        },
        { name: 'write', server: 's', tool: 'write', execute }
      ],
      approvalPolicy: (name) => (name === 'suggest' ? 'local' : 'approval_required')
    } satisfies AssistantRuntimeDefinition);

    await expect(session.sendMessage('write')).resolves.toMatchObject({
      type: 'tool_call_request'
    });
    const latestRead = reads.at(-1)!;
    const saved = await latestRead.saver.getTuple(latestRead.config);
    expect(saved).toBeTruthy();
    const values = saved?.checkpoint.channel_values as Record<string, unknown>;
    expect(values).not.toHaveProperty('route');
    expect(values).not.toHaveProperty('events');
    expect(values.rounds).toBe(1);
    expect(values.batchIds).toEqual(['proposal', 'write-1', 'write-2']);
    expect(values.results).toMatchObject({ proposal: expect.stringContaining('ok') });
    expect(values.proposals).toEqual([{ prompt: { replacement: 'proposed prompt' } }]);
    expect(saved?.pendingWrites?.some(([, channel]) => String(channel).includes('interrupt'))).toBe(
      true
    );
    expect(rounds).toBe(1);
    await expect(
      session.resolveToolCalls([{ toolCallId: 'write-2', decision: 'approve' }])
    ).resolves.toMatchObject({ type: 'tool_call_resolved', pendingToolCalls: [{ id: 'write-1' }] });
    const partialRead = reads.at(-1)!;
    const partial = await partialRead.saver.getTuple(partialRead.config);
    const partialValues = partial?.checkpoint.channel_values as Record<string, unknown>;
    expect(partialValues.rounds).toBe(1);
    expect(partialValues.results).toMatchObject({ 'write-2': expect.stringContaining('write-2') });
    expect((partialValues.results as Record<string, string>)['write-2'].length).toBeLessThanOrEqual(
      4001
    );
    expect(
      partial?.pendingWrites?.some(([, channel]) => String(channel).includes('interrupt'))
    ).toBe(true);
    await expect(
      session.resolveToolCalls([{ toolCallId: 'write-1', decision: 'approve' }])
    ).resolves.toMatchObject({ type: 'assistant_message', text: 'done' });
    expect(rounds).toBe(2);
    expect(execute.mock.calls.map(([args]) => args.id)).toEqual(['write-2', 'write-1']);
    expect(extractProposal).toHaveBeenCalledOnce();
    expect(
      modelHistories[1]
        ?.filter((message) => ToolMessage.isInstance(message))
        .map((message) => message.tool_call_id)
    ).toEqual(['proposal', 'write-1', 'write-2']);
    const threadConfig = reads.at(-1)!.config;
    const saver = reads.at(-1)!.saver;
    await session.dispose();
    expect(await saver.getTuple(threadConfig)).toBeUndefined();
  } finally {
    await session?.dispose();
    vi.restoreAllMocks();
  }
});

it('keeps the first committed result when its observer cancels before the next call starts', async () => {
  const controller = new AbortController();
  const execute = vi.fn(async ({ id }: { id: string }) => ({ id }));
  let session: AssistantRuntimeSession;
  session = await createLangChainAssistantRuntimeFactory(async () => ({
    type: 'tool_call_request',
    text: 'three calls',
    toolCalls: ['one', 'two', 'three'].map((id) => ({ id, name: 'write', arguments: { id } }))
  })).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute }],
    approvalPolicy: () => 'approval_required',
    onEvent: (event) => {
      if (event.type === 'tool_call_resolved' && event.payload.pendingToolCallId === 'one')
        controller.abort();
    }
  } satisfies AssistantRuntimeDefinition);
  const pending = await session.sendMessage('write');
  expect(pending.type).toBe('tool_call_request');
  await expect(
    session.resolveToolCalls(
      ['one', 'two', 'three'].map((toolCallId) => ({ toolCallId, decision: 'approve' as const })),
      controller.signal
    )
  ).rejects.toThrow();
  expect(execute.mock.calls.map(([args]) => args.id)).toEqual(['one']);
  expect(session.getSnapshot().pendingToolCalls).toMatchObject([
    { id: 'one', status: 'approved' },
    { id: 'two', status: 'error', error: 'Tool call cancelled before execution' },
    { id: 'three', status: 'error', error: 'Tool call cancelled before execution' }
  ]);
  expect(session.getSnapshot().messages.filter((message) => message.role === 'tool')).toHaveLength(
    3
  );
  await session.dispose();
});

it('commits an approved tool error before pausing again for its batch sibling', async () => {
  let rounds = 0;
  const failing = vi.fn(async () => {
    throw new Error('write failed');
  });
  const session = await createLangChainAssistantRuntimeFactory(async () => {
    rounds++;
    return rounds === 1
      ? {
          type: 'tool_call_request',
          text: 'two writes',
          toolCalls: [
            { id: 'fails', name: 'write', arguments: {} },
            { id: 'waits', name: 'write', arguments: {} }
          ]
        }
      : { type: 'assistant_message', text: 'recovered' };
  }).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute: failing }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  await session.sendMessage('write');
  await expect(
    session.resolveToolCalls([{ toolCallId: 'fails', decision: 'approve' }])
  ).resolves.toMatchObject({ type: 'tool_call_resolved', pendingToolCalls: [{ id: 'waits' }] });
  expect(session.getSnapshot().pendingToolCalls).toMatchObject([
    { id: 'fails', status: 'error', error: 'write failed' },
    { id: 'waits', status: 'pending' }
  ]);
  await expect(
    session.resolveToolCalls([{ toolCallId: 'waits', decision: 'deny' }])
  ).resolves.toMatchObject({ type: 'assistant_message', text: 'recovered' });
  expect(failing).toHaveBeenCalledOnce();
  await session.dispose();
});

it('terminalizes an active batch after a transient checkpoint read failure without replay', async () => {
  const originalGetTuple = MemorySaver.prototype.getTuple;
  let failNextRead = false;
  const spy = vi.spyOn(MemorySaver.prototype, 'getTuple').mockImplementation(async function (
    this: MemorySaver,
    config: Parameters<MemorySaver['getTuple']>[0]
  ) {
    if (failNextRead) {
      failNextRead = false;
      throw new Error('transient checkpoint read failure');
    }
    return originalGetTuple.call(this, config);
  });
  let rounds = 0;
  const execute = vi.fn(async () => ({ ok: true }));
  let session: AssistantRuntimeSession | undefined;
  try {
    session = await createLangChainAssistantRuntimeFactory(async () => {
      rounds++;
      return rounds === 1
        ? {
            type: 'tool_call_request',
            text: 'write',
            toolCalls: [{ id: 'write-once', name: 'write', arguments: {} }]
          }
        : { type: 'assistant_message', text: 'continued' };
    }).create({
      assistant: 'result',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'Prompt',
      tools: [{ name: 'write', server: 's', tool: 'write', execute }],
      approvalPolicy: () => 'approval_required'
    } satisfies AssistantRuntimeDefinition);
    await session.sendMessage('write');
    failNextRead = true;
    await expect(
      session.resolveToolCalls([{ toolCallId: 'write-once', decision: 'approve' }])
    ).rejects.toThrow('transient checkpoint read failure');
    expect(execute).not.toHaveBeenCalled();
    expect(session.getSnapshot().pendingToolCalls).toMatchObject([
      { id: 'write-once', status: 'error', error: 'transient checkpoint read failure' }
    ]);
    expect(
      session.getSnapshot().messages.filter((message) => message.role === 'tool')
    ).toHaveLength(1);
    await expect(
      session.resolveToolCalls([{ toolCallId: 'write-once', decision: 'approve' }])
    ).rejects.toThrow();
    await expect(session.sendMessage('continue')).resolves.toMatchObject({
      type: 'assistant_message',
      text: 'continued'
    });
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await session?.dispose();
    spy.mockRestore();
  }
});

it('recovers a checkpoint write failure without replaying the completed tool', async () => {
  const originalPut = MemorySaver.prototype.put;
  let failNextPut = false;
  const spy = vi.spyOn(MemorySaver.prototype, 'put').mockImplementation(async function (
    this: MemorySaver,
    ...args: Parameters<MemorySaver['put']>
  ) {
    if (failNextPut) {
      failNextPut = false;
      throw new Error('transient checkpoint write failure');
    }
    return originalPut.apply(this, args);
  });
  let session: AssistantRuntimeSession | undefined;
  let rounds = 0;
  const histories: BaseMessage[][] = [];
  const events: AssistantRuntimeEvent[] = [];
  const execute = vi.fn(async () => {
    failNextPut = true;
    return { ok: true };
  });
  try {
    session = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
      histories.push(messages);
      return ++rounds === 1
        ? {
            type: 'tool_call_request',
            text: 'write',
            toolCalls: [{ id: 'write-once', name: 'write', arguments: {} }]
          }
        : { type: 'assistant_message', text: 'fresh turn' };
    }).create({
      assistant: 'result',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'Prompt',
      onEvent: (event) => events.push(event),
      tools: [{ name: 'write', server: 's', tool: 'write', execute }],
      approvalPolicy: () => 'approval_required'
    } satisfies AssistantRuntimeDefinition);
    await session.sendMessage('write');
    await expect(
      session.resolveToolCalls([{ toolCallId: 'write-once', decision: 'approve' }])
    ).rejects.toThrow('transient checkpoint write failure');
    expect(execute).toHaveBeenCalledOnce();
    expect(rounds).toBe(1);
    expect(session.getSnapshot().pendingToolCalls).toMatchObject([
      { id: 'write-once', status: 'approved', resultPreview: '{"ok":true}' }
    ]);
    expect(
      session.getSnapshot().messages.filter((message) => message.role === 'tool')
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool_call_resolved')).toHaveLength(1);
    await expect(
      session.resolveToolCalls([{ toolCallId: 'write-once', decision: 'approve' }])
    ).rejects.toThrow();
    await expect(session.sendMessage('continue')).resolves.toMatchObject({ text: 'fresh turn' });
    expect(histories[1].filter((message) => ToolMessage.isInstance(message))).toHaveLength(1);
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await session?.dispose();
    spy.mockRestore();
  }
});

it.each(['abort', 'observer failure'] as const)(
  'completes a batch when %s occurs before its approval interrupt',
  async (mode) => {
    const controller = new AbortController();
    const execute = vi.fn(async () => ({ ok: true }));
    let rounds = 0;
    const histories: BaseMessage[][] = [];
    const session = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
      histories.push(messages);
      return ++rounds === 1
        ? {
            type: 'tool_call_request',
            text: 'write',
            toolCalls: [{ id: 'waiting', name: 'write' }]
          }
        : { type: 'assistant_message', text: 'fresh turn' };
    }).create({
      assistant: 'result',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'Prompt',
      tools: [{ name: 'write', server: 's', tool: 'write', execute }],
      approvalPolicy: () => 'approval_required',
      onEvent: (event) => {
        if (event.type !== 'tool_call_requested') return;
        if (mode === 'abort') controller.abort();
        else throw new Error('approval observer failed');
      }
    });
    try {
      await expect(session.sendMessage('write', controller.signal)).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(session.getSnapshot().pendingToolCalls).toMatchObject([
        { id: 'waiting', status: 'error' }
      ]);
      expect(
        session.getSnapshot().messages.filter((message) => message.role === 'tool')
      ).toHaveLength(1);
      await session.sendMessage('continue');
      expect(histories[1].slice(-2)).toMatchObject([
        { tool_call_id: 'waiting' },
        { content: 'continue' }
      ]);
    } finally {
      await session.dispose();
    }
  }
);

it('closes an unrecoverable checkpoint session and still releases its storage on disposal', async () => {
  const originalGetTuple = MemorySaver.prototype.getTuple;
  let unavailable = false;
  let saver: MemorySaver | undefined;
  let config: Parameters<MemorySaver['getTuple']>[0] | undefined;
  const spy = vi.spyOn(MemorySaver.prototype, 'getTuple').mockImplementation(async function (
    this: MemorySaver,
    input
  ) {
    saver = this;
    config = input;
    if (unavailable) throw new Error('checkpoint unavailable');
    return originalGetTuple.call(this, input);
  });
  const model = vi.fn(async () => ({ type: 'assistant_message' as const, text: 'answer' }));
  let session: AssistantRuntimeSession | undefined;
  try {
    session = await createLangChainAssistantRuntimeFactory(model).create({
      assistant: 'result',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'Prompt',
      tools: [],
      approvalPolicy: () => 'approval_required'
    });
    unavailable = true;
    await expect(session.sendMessage('fail')).rejects.toThrow('checkpoint unavailable');
    await expect(session.sendMessage('retry')).rejects.toThrow('closed after a checkpoint failure');
    expect(model).not.toHaveBeenCalled();
    await expect(session.dispose()).rejects.toThrow('checkpoint unavailable');
    expect(await originalGetTuple.call(saver!, config!)).toBeUndefined();
  } finally {
    unavailable = false;
    await Promise.resolve(session?.dispose()).catch(() => {});
    spy.mockRestore();
  }
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
  const session = await createLangChainAssistantRuntimeFactory(async () => {
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

it('returns malformed calls individually while approving valid siblings and preserving native history', async () => {
  const execute = vi.fn(async () => ({ value: 'ok' }));
  const seen: unknown[][] = [];
  const modelCall = async (_definition: AssistantRuntimeDefinition, messages: any[]) => {
    seen.push(messages);
    if (seen.length === 1)
      return {
        type: 'tool_call_request' as const,
        text: 'Working',
        toolCalls: [
          {
            id: 'malformed',
            name: 'write',
            arguments: {},
            validationError: 'Malformed JSON: {broken'
          },
          { id: 'valid', name: 'write', arguments: { value: 1 } }
        ],
        nativeMessage: new AIMessage({
          id: 'provider-response-1',
          content: [{ type: 'text', text: 'Working' }],
          response_metadata: { provider: 'openai' },
          tool_calls: [
            { id: 'malformed', name: 'write', args: {}, type: 'tool_call' },
            { id: 'valid', name: 'write', args: { value: 1 }, type: 'tool_call' }
          ]
        })
      };
    return { type: 'assistant_message' as const, text: 'Done' };
  };
  const session = await createLangChainAssistantRuntimeFactory(modelCall).create({
    assistant: 'result',
    agent: { provider: 'openai', model: 'test' },
    context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
    getSystemPrompt: () => 'Prompt',
    tools: [{ name: 'write', server: 's', tool: 'write', execute }],
    approvalPolicy: () => 'approval_required'
  } satisfies AssistantRuntimeDefinition);
  const pending = await session.sendMessage('write');
  expect(pending).toMatchObject({ type: 'tool_call_request', pendingToolCalls: [{ id: 'valid' }] });
  expect(session.getSnapshot().pendingToolCalls).toMatchObject([
    { id: 'malformed', status: 'error', error: 'Malformed JSON: {broken' },
    { id: 'valid', status: 'pending' }
  ]);
  expect(execute).not.toHaveBeenCalled();
  await session.resolveToolCalls([{ toolCallId: 'valid', decision: 'approve' }]);
  expect(execute).toHaveBeenCalledTimes(1);
  const followup = seen[1] as Array<AIMessage | ToolMessage | HumanMessage>;
  const assistant = followup.find((message) => AIMessage.isInstance(message));
  expect(assistant).toMatchObject({
    id: 'provider-response-1',
    content: [{ type: 'text', text: 'Working' }],
    response_metadata: { provider: 'openai' },
    tool_calls: [
      { id: 'malformed', args: {} },
      { id: 'valid', args: { value: 1 } }
    ]
  });
  expect(
    followup
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message.tool_call_id)
  ).toEqual(['malformed', 'valid']);
});
