import { describe, expect, it, vi } from 'vitest';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeModelOutput,
  AssistantRuntimeSession
} from '@inspectr/mcplab-core';
import { createAssistantRuntimeService } from './assistant-service.js';
import { createLangChainAssistantRuntimeFactory } from './langchain-assistant-runtime.js';

describe('assistant runtime service', () => {
  it('guards callbacks cached by a factory after service disposal', async () => {
    let cached!: (event: AssistantRuntimeEvent) => void;
    const onEvent = vi.fn();
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      dispose: vi.fn()
    };
    const definition = { onEvent } as unknown as AssistantRuntimeDefinition;
    const service = await createAssistantRuntimeService(
      {
        create: async (def) => {
          cached = def.onEvent!;
          return runtime;
        }
      },
      definition
    );
    await service.dispose();
    cached({ type: 'turn_started', ts: '', payload: {} });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('disposes definition resources and guards cached callbacks when factory initialization fails', async () => {
    let cached!: (event: any) => void;
    const onEvent = vi.fn();
    const dispose = vi.fn();
    const definition = { onEvent, dispose } as unknown as AssistantRuntimeDefinition;
    await expect(
      createAssistantRuntimeService(
        {
          create: async (def) => {
            cached = def.onEvent!;
            throw new Error('factory failed');
          }
        },
        definition
      )
    ).rejects.toThrow('factory failed');
    cached({ type: 'turn_started', ts: '', payload: {} });
    expect(onEvent).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('preserves the factory error when definition cleanup also fails', async () => {
    const factoryError = new Error('factory failed');
    const definition = {
      dispose: vi.fn().mockRejectedValue(new Error('cleanup failed'))
    } as unknown as AssistantRuntimeDefinition;
    await expect(
      createAssistantRuntimeService(
        { create: async () => Promise.reject(factoryError) },
        definition
      )
    ).rejects.toBe(factoryError);
    expect(definition.dispose).toHaveBeenCalledOnce();
  });

  it('holds its lock after abort until an opaque runtime settles and suppresses its late events', async () => {
    let finishOld!: (value: { type: 'assistant_message'; text: string }) => void;
    const oldResult = new Promise<{ type: 'assistant_message'; text: string }>((resolve) => {
      finishOld = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let cached!: (event: any) => void;
    const onEvent = vi.fn();
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn((message) => {
        if (message === 'old') {
          markStarted();
          return oldResult;
        }
        return Promise.resolve({ type: 'assistant_message' as const, text: 'new' });
      }),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      dispose: vi.fn()
    };
    const service = await createAssistantRuntimeService(
      {
        create: async (definition) => {
          cached = definition.onEvent!;
          return runtime;
        }
      },
      { onEvent } as unknown as AssistantRuntimeDefinition
    );
    const controller = new AbortController();
    const oldOperation = service.sendMessage('old', controller.signal);
    await started;
    controller.abort();
    await expect(oldOperation).rejects.toThrow('aborted');
    expect(service.isBusy?.()).toBe(true);
    await expect(service.sendMessage('too soon')).rejects.toMatchObject({ statusCode: 409 });
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1);

    cached({ type: 'turn_started', ts: '', payload: {} });
    expect(onEvent).not.toHaveBeenCalled();
    finishOld({ type: 'assistant_message', text: 'late' });
    await vi.waitFor(() => expect(service.isBusy?.()).toBe(false));
    expect(await service.sendMessage('new')).toMatchObject({ text: 'new' });
    await service.dispose();
  });
  it('publishes one settled cancellation snapshot after partial tool execution', async () => {
    let finishSlow!: (value: unknown) => void;
    const slowResult = new Promise((resolve) => {
      finishSlow = resolve;
    });
    let slowStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    let runtime!: AssistantRuntimeSession;
    const events: AssistantRuntimeEvent[] = [];
    let snapshotAtCancellation!: ReturnType<AssistantRuntimeSession['getSnapshot']>;
    const definition: AssistantRuntimeDefinition = {
      assistant: 'result',
      agent: { provider: 'openai', model: 'test' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'prompt',
      tools: [
        { name: 'first', server: 's', tool: 'first', execute: async () => ({ value: 'kept' }) },
        {
          name: 'slow',
          server: 's',
          tool: 'slow',
          execute: async () => {
            slowStarted();
            return slowResult;
          }
        }
      ],
      approvalPolicy: () => 'automatic',
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'session_error') snapshotAtCancellation = runtime.getSnapshot();
      }
    };
    runtime = await createLangChainAssistantRuntimeFactory(async () => ({
      type: 'tool_call_request',
      text: 'Reading',
      toolCalls: [
        { id: 'first-id', name: 'first' },
        { id: 'slow-id', name: 'slow' },
        { id: 'third-id', name: 'first' }
      ]
    })).create(definition);
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      definition
    );
    const controller = new AbortController();
    const operation = service.sendMessage('read', controller.signal);
    await started;
    controller.abort();
    await expect(operation).rejects.toThrow('aborted');
    await vi.waitFor(() => expect(service.isBusy?.()).toBe(false));

    const settledSnapshot = runtime.getSnapshot();
    expect(snapshotAtCancellation).toEqual(settledSnapshot);
    const cancellationEvents = events.filter((event) => event.type === 'session_error');
    expect(cancellationEvents).toHaveLength(1);
    expect(cancellationEvents[0]?.payload).toMatchObject({
      error: 'Assistant operation cancelled'
    });
    expect(settledSnapshot.pendingToolCalls.map(({ id, status }) => [id, status])).toEqual([
      ['first-id', 'approved'],
      ['slow-id', 'error'],
      ['third-id', 'error']
    ]);
    expect(settledSnapshot.pendingToolCalls[1]?.error).toContain('outcome unknown');
    expect(settledSnapshot.pendingToolCalls[2]?.error).toContain('before execution');

    finishSlow({ value: 'late' });
    await Promise.resolve();
    expect(runtime.getSnapshot()).toEqual(settledSnapshot);
    expect(events.filter((event) => event.type === 'session_error')).toHaveLength(1);
    await service.dispose();
  });
  it('releases the lock when a request is already aborted before runtime work starts', async () => {
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'ok' }),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      dispose: vi.fn()
    };
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      {} as AssistantRuntimeDefinition
    );
    const controller = new AbortController();
    controller.abort();
    await expect(service.sendMessage('cancelled', controller.signal)).rejects.toThrow('aborted');
    expect(runtime.sendMessage).not.toHaveBeenCalled();
    expect(service.isBusy?.()).toBe(false);
    await expect(service.sendMessage('next')).resolves.toMatchObject({ text: 'ok' });
    await service.dispose();
  });
  it('serializes operations and disposes an opaque runtime that settles only during cleanup', async () => {
    let finish!: (value: { type: 'assistant_message'; text: string }) => void;
    const inFlight = new Promise<{ type: 'assistant_message'; text: string }>((resolve) => {
      finish = resolve;
    });
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(() => inFlight),
      resolveToolCalls: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'resolved' }),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      dispose: vi.fn(() => {
        finish({ type: 'assistant_message', text: 'done' });
      })
    };
    const disposeResources = vi.fn();
    const definition = { dispose: disposeResources } as unknown as AssistantRuntimeDefinition;
    const onActivity = vi.fn();
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      definition,
      onActivity
    );

    const send = service.sendMessage('hello');
    expect(service.isBusy?.()).toBe(true);
    expect(onActivity).toHaveBeenCalledOnce();
    await expect(service.resolveToolCalls([])).rejects.toThrow('busy');
    expect(onActivity).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(runtime.sendMessage).toHaveBeenCalledOnce());
    await service.dispose();
    await service.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(disposeResources).toHaveBeenCalledOnce();
    await expect(send).rejects.toThrow('aborted');
    expect(onActivity).toHaveBeenCalledTimes(1);
    const decisionService = await createAssistantRuntimeService(
      { create: async () => runtime },
      definition,
      onActivity
    );
    await decisionService.resolveToolCalls([]);
    expect(onActivity).toHaveBeenCalledTimes(3);
    await decisionService.dispose();
    await expect(service.sendMessage('after disposal')).rejects.toThrow('disposed');
  });

  it('keeps a late abort-ignoring model response from cancelling a newer LangGraph batch', async () => {
    let finishOldModel!: (value: AssistantRuntimeModelOutput) => void;
    let oldModelStarted!: () => void;
    const oldStarted = new Promise<void>((resolve) => {
      oldModelStarted = resolve;
    });
    const oldResponse = new Promise<AssistantRuntimeModelOutput>((resolve) => {
      finishOldModel = resolve;
    });
    const modelHistories: Array<Array<any>> = [];
    let modelCalls = 0;
    const events: string[] = [];
    const definition = {
      assistant: 'result',
      agent: { provider: 'openai', model: 'fake' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'prompt',
      tools: [{ name: 'write', server: 's', tool: 'write', execute: async () => ({ ok: true }) }],
      approvalPolicy: () => 'approval_required',
      onEvent: (event: { type: string }) => events.push(event.type)
    } as unknown as AssistantRuntimeDefinition;
    const runtime = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
      modelHistories.push([...messages]);
      modelCalls += 1;
      if (modelCalls === 1) {
        oldModelStarted();
        return oldResponse;
      }
      if (modelCalls === 2) {
        return {
          type: 'tool_call_request',
          text: 'New turn write',
          toolCalls: [{ id: 'new-call', name: 'write' }]
        };
      }
      return { type: 'assistant_message', text: 'New turn done' };
    }).create(definition);
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      definition
    );
    const controller = new AbortController();
    const oldTurn = service.sendMessage('old turn', controller.signal);
    await oldStarted;
    controller.abort();
    await expect(oldTurn).rejects.toThrow('aborted');
    await vi.waitFor(() => expect(service.isBusy?.()).toBe(false));

    const newTurn = await service.sendMessage('new turn');
    expect(newTurn).toMatchObject({
      type: 'tool_call_request',
      pendingToolCalls: [{ id: 'new-call' }]
    });
    const currentSnapshot = service.getSnapshot();
    const currentEvents = [...events];
    finishOldModel({
      type: 'tool_call_request',
      text: 'Stale tool request',
      toolCalls: [{ id: 'old-call', name: 'write' }]
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.getSnapshot()).toEqual(currentSnapshot);
    expect(events).toEqual(currentEvents);

    await service.resolveToolCalls([{ toolCallId: 'new-call', decision: 'approve' }]);
    const finalHistory = modelHistories.at(-1)!;
    expect(
      finalHistory.flatMap((message) => message.tool_calls?.map((call: any) => call.id) ?? [])
    ).toEqual(['new-call']);
    expect(
      finalHistory
        .filter((message) => message.getType() === 'tool')
        .map((message) => message.tool_call_id)
    ).toEqual(['new-call']);
    expect(service.getSnapshot().pendingToolCalls.map((call) => call.id)).toEqual(['new-call']);
    await service.dispose();
  });

  it('owns active tool cancellation, rejects overlap, and keeps late tool results stale', async () => {
    let release!: (value: unknown) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const slowResult = new Promise((resolve) => (release = resolve));
    const slowExecute = vi.fn(() => slowResult);
    const siblingExecute = vi.fn(async () => ({ sibling: true }));
    const histories: any[][] = [];
    let round = 0;
    const events: AssistantRuntimeEvent[] = [];
    const definition = {
      assistant: 'result',
      agent: { provider: 'openai', model: 'fake' },
      context: { scope: 'all_runs', runId: null, resultSummary: null, referenceReportsForRun: [] },
      getSystemPrompt: () => 'prompt',
      onEvent: (event: AssistantRuntimeEvent) => events.push(event),
      tools: [
        {
          name: 'slow',
          server: 's',
          tool: 'slow',
          execute: () => {
            markStarted();
            return slowExecute();
          }
        },
        { name: 'sibling', server: 's', tool: 'sibling', execute: siblingExecute }
      ],
      approvalPolicy: () => 'automatic'
    } as unknown as AssistantRuntimeDefinition;
    const runtime = await createLangChainAssistantRuntimeFactory(async (_definition, messages) => {
      histories.push([...messages]);
      round++;
      return round === 1
        ? {
            type: 'tool_call_request',
            text: 'Run both tools',
            toolCalls: [
              { id: 'executing-call', name: 'slow' },
              { id: 'sibling-call', name: 'sibling' }
            ]
          }
        : { type: 'assistant_message', text: 'New turn finished' };
    }).create(definition);
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      definition
    );
    const controller = new AbortController();
    const oldTurn = service.sendMessage('Old turn', controller.signal);
    await started;
    await expect(service.sendMessage('overlapping turn')).rejects.toMatchObject({
      statusCode: 409
    });
    controller.abort();
    await expect(oldTurn).rejects.toThrow();
    await vi.waitFor(() => expect(service.isBusy?.()).toBe(false));
    const terminalSnapshot = service.getSnapshot();
    expect(terminalSnapshot.pendingToolCalls).toMatchObject([
      { id: 'executing-call', status: 'error', error: expect.stringContaining('outcome unknown') },
      {
        id: 'sibling-call',
        status: 'error',
        error: expect.stringContaining('cancelled before execution')
      }
    ]);
    expect(siblingExecute).not.toHaveBeenCalled();
    await expect(service.sendMessage('New turn')).resolves.toMatchObject({
      type: 'assistant_message',
      text: 'New turn finished'
    });
    const snapshotBeforeLateTool = service.getSnapshot();
    const eventsBeforeLateTool = [...events];
    release({ late: true });
    await Promise.resolve();
    expect(service.getSnapshot()).toEqual(snapshotBeforeLateTool);
    expect(events).toEqual(eventsBeforeLateTool);
    expect(histories[1].filter((message) => message.getType?.() === 'tool')).toHaveLength(2);
    expect(slowExecute).toHaveBeenCalledOnce();
    await service.dispose();
  });
});
