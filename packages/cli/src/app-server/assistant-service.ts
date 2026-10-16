import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeEvent,
  AssistantRuntimeResponse,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';
import { throwIfAborted } from './assistant-common.js';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeFactory,
  AssistantRuntimeSession
} from './assistant-runtime-contract.js';

export class AssistantSessionBusyError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Assistant session is busy');
    this.name = 'AssistantSessionBusyError';
  }
}

export async function setupAssistantRuntimeSession<TSession extends object>(params: {
  session: TSession;
  prepare(
    emitInitialEvent: (event: AssistantRuntimeEvent) => void
  ): Promise<AssistantRuntimeDefinition>;
  disposeSetup(): Promise<void>;
  factory: AssistantRuntimeFactory;
  initialEvents?: AssistantRuntimeEvent[];
  onEvent(
    event: AssistantRuntimeEvent,
    session: TSession & { runtime: AssistantRuntimeSession }
  ): void;
  onActivity(session: TSession & { runtime: AssistantRuntimeSession }): void;
}): Promise<TSession & { runtime: AssistantRuntimeSession }> {
  type ReadySession = TSession & { runtime: AssistantRuntimeSession };
  let readySession: ReadySession | undefined;
  const startupEvents = [...(params.initialEvents ?? [])];
  try {
    const definition = await params.prepare((event) => startupEvents.push(event));
    definition.onEvent = (event) => {
      if (readySession) params.onEvent(event, readySession);
      else startupEvents.push(event);
    };
    const runtime = await createAssistantRuntimeService(params.factory, definition, () => {
      if (readySession) params.onActivity(readySession);
    });
    readySession = Object.assign(params.session, { runtime });
    for (const event of startupEvents) params.onEvent(event, readySession);
    startupEvents.length = 0;
    return readySession;
  } catch (error) {
    if (readySession) await Promise.resolve(readySession.runtime.dispose()).catch(() => {});
    else await params.disposeSetup().catch(() => {});
    throw error;
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
  let activeOperationKind: 'turn' | 'cancel' | undefined;
  // The mutation target can differ from the projected turn while superseding a paused batch.
  let activeOperationTurnId: string | undefined;
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
    try {
      await definition.dispose?.();
    } catch {
      // Preserve the runtime factory error when setup cleanup also fails.
    }
    throw error;
  }

  const run = async (
    operation: (signal: AbortSignal) => Promise<AssistantRuntimeResponse>,
    signal?: AbortSignal,
    operationKind: 'turn' | 'cancel' = 'turn',
    operationTurnId?: string
  ) => {
    if (disposed) throw new Error('Assistant session is disposed');
    if (busy) throw new AssistantSessionBusyError();
    busy = true;
    activeOperationKind = operationKind;
    activeOperationTurnId = operationTurnId;
    onActivity?.();
    const controller = new AbortController();
    activeController = controller;
    let operationSettled = false;
    let operationStarted = false;
    const abort = () => {
      controller.abort(signal?.reason);
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
      activeOperationKind = undefined;
      activeOperationTurnId = undefined;
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
    sendMessage: (message, signal, requestedTurnId) => {
      const turnId = requestedTurnId ?? randomUUID();
      return run(
        (activeSignal) => runtime.sendMessage(message, activeSignal, turnId),
        signal,
        'turn',
        turnId
      );
    },
    resolveToolCalls: (decisions: AssistantToolCallDecision[], signal) =>
      run(
        (activeSignal) => runtime.resolveToolCalls(decisions, activeSignal),
        signal,
        'turn',
        runtime.getSnapshot().activeTurnId
      ),
    getSnapshot: () => runtime.getSnapshot(),
    isBusy: () => busy,
    cancel: async (turnId) => {
      if (disposed) return;
      if (busy) {
        if (activeOperationTurnId !== turnId) return;
        if (activeOperationKind !== 'cancel') {
          activeController?.abort('cancelled');
        }
        await runtime.cancel(turnId);
        return;
      }
      if (runtime.getSnapshot().activeTurnId !== turnId) return;
      await run(
        async () => {
          await runtime.cancel(turnId);
          return { type: 'assistant_message', text: '' };
        },
        undefined,
        'cancel',
        turnId
      );
    },
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
