import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeFactory,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';
import { throwIfAborted } from './assistant-common.js';

export class AssistantSessionBusyError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Assistant session is busy');
    this.name = 'AssistantSessionBusyError';
  }
}

export async function createAssistantRuntimeService(
  factory: AssistantRuntimeFactory,
  definition: AssistantRuntimeDefinition,
  onActivity?: () => void
): Promise<AssistantRuntimeSession> {
  let busy = false;
  let disposed = false;
  let suppressRuntimeEvents = false;
  let activeController: AbortController | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const onRuntimeEvent = definition.onEvent;
  definition.onEvent = (event) => {
    if (!disposed && !suppressRuntimeEvents) onRuntimeEvent?.(event);
  };
  let runtime: AssistantRuntimeSession;
  try {
    runtime = await factory.create(definition);
  } catch (error) {
    disposed = true;
    await definition.dispose?.();
    throw error;
  }

  const run = async (
    operation: (signal: AbortSignal) => Promise<AssistantRuntimeResponse>,
    signal?: AbortSignal
  ) => {
    if (disposed) throw new Error('Assistant session is disposed');
    if (busy) throw new AssistantSessionBusyError();
    busy = true;
    onActivity?.();
    const controller = new AbortController();
    activeController = controller;
    let operationSettled = false;
    let operationStarted = false;
    const abort = () => {
      controller.abort();
      if (!operationSettled) suppressRuntimeEvents = true;
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const finish = () => {
      if (operationSettled) return;
      operationSettled = true;
      if (activeController !== controller) return;
      if (suppressRuntimeEvents && operationStarted && !disposed) {
        try {
          onRuntimeEvent?.({
            type: 'session_error',
            ts: new Date().toISOString(),
            payload: { error: 'Assistant operation cancelled' }
          });
        } catch {
          // An observer must not prevent the operation lock from being released.
        }
      }
      busy = false;
      activeController = undefined;
      suppressRuntimeEvents = false;
      if (!disposed) onActivity?.();
    };
    try {
      if (controller.signal.aborted) {
        finish();
        throwIfAborted(controller.signal);
      }
      const operationPromise = Promise.resolve().then(() => {
        throwIfAborted(controller.signal);
        operationStarted = true;
        return operation(controller.signal);
      });
      void operationPromise.then(finish, finish).catch(() => {});
      const result = await Promise.race([
        operationPromise,
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            'abort',
            () => {
              const error = new Error('Assistant operation aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          )
        )
      ]);
      if (disposed || controller.signal.aborted) throw new Error('Assistant operation aborted');
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };

  return {
    sendMessage: (message, signal) =>
      run((activeSignal) => runtime.sendMessage(message, activeSignal), signal),
    resolveToolCalls: (decisions: AssistantToolCallDecision[], signal) =>
      run((activeSignal) => runtime.resolveToolCalls(decisions, activeSignal), signal),
    getSnapshot: () => runtime.getSnapshot(),
    isBusy: () => busy,
    dispose: async () => {
      if (cleanupPromise) return cleanupPromise;
      disposed = true;
      activeController?.abort();
      cleanupPromise = (async () => {
        try {
          await runtime.dispose();
        } finally {
          await definition.dispose?.();
        }
      })();
      return cleanupPromise;
    }
  };
}
