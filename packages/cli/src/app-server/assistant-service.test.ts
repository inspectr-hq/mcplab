import { describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeDefinition, AssistantRuntimeSession } from '@inspectr/mcplab-core';
import { createAssistantRuntimeService } from './assistant-service.js';

describe('assistant runtime service', () => {
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
    const service = createAssistantRuntimeService(runtime, definition, onActivity);

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
    expect(onActivity).toHaveBeenCalledTimes(2);
    const decisionService = createAssistantRuntimeService(runtime, definition, onActivity);
    await decisionService.resolveToolCalls([]);
    expect(onActivity).toHaveBeenCalledTimes(4);
    await decisionService.dispose();
    await expect(service.sendMessage('after disposal')).rejects.toThrow('disposed');
  });
});
