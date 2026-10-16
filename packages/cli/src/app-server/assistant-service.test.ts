import { describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeEvent, AssistantRuntimeResponse } from '@inspectr/mcplab-core';
import { createAssistantRuntimeService } from './assistant-service.js';
import { createScriptedRuntimeFactory } from '../../test-support/scripted-chat-model.js';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeSession
} from './assistant-runtime-contract.js';
import type { AssistantRuntimeModelOutput } from '../../test-support/scripted-chat-model.js';

describe('assistant runtime service', () => {
  it('guards callbacks cached by a factory after service disposal', async () => {
    let cached!: (event: AssistantRuntimeEvent) => void;
    const onEvent = vi.fn();
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
      cancel: vi.fn(),
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
      getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
      cancel: vi.fn(),
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
    expect(await service.sendMessage('new', undefined, 'client-turn')).toMatchObject({
      text: 'new'
    });
    expect(runtime.sendMessage).toHaveBeenLastCalledWith(
      'new',
      expect.any(AbortSignal),
      'client-turn'
    );
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
    runtime = await createScriptedRuntimeFactory(async () => ({
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
    // Tools run in parallel: cancel once the fast calls have finished.
    await vi.waitFor(() =>
      expect(
        events
          .filter((event) => event.type === 'tool_call_resolved')
          .map((event) => event.payload.pendingToolCallId)
      ).toEqual(expect.arrayContaining(['first-id', 'third-id']))
    );
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
      ['third-id', 'approved']
    ]);
    expect(settledSnapshot.pendingToolCalls[1]?.error).toContain('outcome unknown');

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
      getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
      cancel: vi.fn(),
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
  it('routes matching busy cancellation through the runtime and serializes paused cancellation', async () => {
    let activeTurnId: string | undefined;
    let requestSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const cancel = vi.fn(async (turnId: string) => {
      if (turnId === activeTurnId) activeTurnId = undefined;
    });
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn((_message, signal) => {
        requestSignal = signal;
        markStarted();
        return new Promise<AssistantRuntimeResponse>((_, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        );
      }),
      resolveToolCalls: vi.fn(),
      getSnapshot: () => ({ revision: 0, messages: [], pendingToolCalls: [], activeTurnId }),
      cancel,
      dispose: vi.fn()
    };
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      {} as AssistantRuntimeDefinition
    );
    const send = service.sendMessage('question', undefined, 'running-turn');
    await started;
    await service.cancel('stale-turn');
    expect(requestSignal?.aborted).toBe(false);
    await service.cancel('running-turn');
    await expect(send).rejects.toThrow('aborted');
    await vi.waitFor(() => expect(service.isBusy?.()).toBe(false));
    expect(requestSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledWith('running-turn');

    activeTurnId = 'paused-turn';
    let markPausedStarted!: () => void;
    let releasePausedCancel!: () => void;
    const pausedStarted = new Promise<void>((resolve) => (markPausedStarted = resolve));
    const pausedCancel = new Promise<void>((resolve) => (releasePausedCancel = resolve));
    cancel.mockImplementation(async (turnId) => {
      expect(service.isBusy?.()).toBe(true);
      markPausedStarted();
      await pausedCancel;
      if (turnId === activeTurnId) activeTurnId = undefined;
    });
    const cancelling = service.cancel('paused-turn');
    await pausedStarted;
    expect(service.isBusy?.()).toBe(true);
    releasePausedCancel();
    await cancelling;
    expect(service.isBusy?.()).toBe(false);
    await service.dispose();
  });
  it('does not cancel a new send while the old paused graph state is still projected', async () => {
    let activeTurnId: string | undefined;
    let secondSignal: AbortSignal | undefined;
    let releaseSecond!: (value: AssistantRuntimeResponse) => void;
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => (markSecondStarted = resolve));
    const secondResult = new Promise<AssistantRuntimeResponse>((resolve) => {
      releaseSecond = resolve;
    });
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn((message, signal, turnId) => {
        if (message === 'old request') {
          activeTurnId = turnId;
          return Promise.resolve({
            type: 'tool_call_request' as const,
            text: 'Old batch paused',
            pendingToolCalls: []
          });
        }
        secondSignal = signal;
        markSecondStarted();
        return secondResult;
      }),
      resolveToolCalls: vi.fn(),
      getSnapshot: () => ({
        revision: 1,
        messages: [],
        pendingToolCalls: [],
        activeTurnId
      }),
      cancel: vi.fn(async (turnId) => {
        if (turnId === activeTurnId) activeTurnId = undefined;
      }),
      dispose: vi.fn()
    };
    const service = await createAssistantRuntimeService(
      { create: async () => runtime },
      {} as AssistantRuntimeDefinition
    );

    await service.sendMessage('old request', undefined, 'old-turn');
    const newTurn = service.sendMessage('new request', undefined, 'new-turn');
    await secondStarted;
    await service.cancel('old-turn');
    expect(secondSignal?.aborted).toBe(false);
    expect(runtime.cancel).not.toHaveBeenCalled();
    releaseSecond({ type: 'assistant_message', text: 'New answer' });
    await expect(newTurn).resolves.toMatchObject({ text: 'New answer' });
    expect(runtime.sendMessage).toHaveBeenLastCalledWith(
      'new request',
      expect.any(AbortSignal),
      'new-turn'
    );
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
      getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
      cancel: vi.fn(),
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
    const runtime = await createScriptedRuntimeFactory(async (_definition, messages) => {
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
    const runtime = await createScriptedRuntimeFactory(async (_definition, messages) => {
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
    // The sibling runs in parallel; cancel once it has finished.
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.type === 'tool_call_resolved' &&
            event.payload.pendingToolCallId === 'sibling-call'
        )
      ).toBe(true)
    );
    controller.abort();
    await expect(oldTurn).rejects.toThrow();
    await vi.waitFor(() => expect(service.isBusy?.()).toBe(false));
    const terminalSnapshot = service.getSnapshot();
    expect(terminalSnapshot.pendingToolCalls).toMatchObject([
      { id: 'executing-call', status: 'error', error: expect.stringContaining('outcome unknown') },
      { id: 'sibling-call', status: 'approved' }
    ]);
    expect(siblingExecute).toHaveBeenCalledOnce();
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
