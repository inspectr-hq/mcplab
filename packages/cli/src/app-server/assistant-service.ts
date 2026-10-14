import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';

export class AssistantSessionBusyError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Assistant session is busy');
    this.name = 'AssistantSessionBusyError';
  }
}

export function createAssistantRuntimeService(
  runtime: AssistantRuntimeSession,
  definition: AssistantRuntimeDefinition,
  onActivity?: () => void
): AssistantRuntimeSession {
  let busy = false;
  let disposed = false;
  let activeController: AbortController | undefined;
  let cleanupPromise: Promise<void> | undefined;

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
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      return await operation(controller.signal);
    } finally {
      signal?.removeEventListener('abort', abort);
      busy = false;
      activeController = undefined;
      onActivity?.();
    }
  };

  return {
    sendMessage: (message, signal) => run((activeSignal) => runtime.sendMessage(message, activeSignal), signal),
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
