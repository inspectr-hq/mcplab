import { describe, expect, it, vi } from 'vitest';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeModelOutput,
  AssistantRuntimeSession
} from '@inspectr/mcplab-core';
import { createAssistantRuntimeService } from './assistant-service.js';
import { createNativeAssistantRuntimeFactory } from './assistant-runtime.js';

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
        return Promise.resolve({ type: 'assistant_message', text: 'new' });
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
  it('serializes opaque runtime operations and owns idempotent cleanup', async () => {
    let finish!: (value: { type: 'assistant_message'; text: string }) => void;
    const inFlight = new Promise<{ type: 'assistant_message'; text: string }>((resolve) => {
      finish = resolve;
    });
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(() => inFlight),
      resolveToolCalls: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'resolved' }),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      dispose: vi.fn()
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
    await service.dispose();
    await service.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(disposeResources).toHaveBeenCalledOnce();
    finish({ type: 'assistant_message', text: 'done' });
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

  it('keeps a late abort-ignoring model response from cancelling a newer native batch', async () => {
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
    const runtime = await createNativeAssistantRuntimeFactory(async (_definition, messages) => {
      modelHistories.push(structuredClone(messages));
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
        .filter((message) => message.role === 'tool')
        .map((message) => message.tool_call_id)
    ).toEqual(['new-call']);
    expect(service.getSnapshot().pendingToolCalls.map((call) => call.id)).toEqual(['new-call']);
    await service.dispose();
  });
});
