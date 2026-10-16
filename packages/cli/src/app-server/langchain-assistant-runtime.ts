import { HumanMessage } from '@langchain/core/messages';
import { Command, MemorySaver } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeFactory,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantRuntimeSnapshot
} from '@inspectr/mcplab-core';
import { callAssistantModel, type AssistantModelCall } from './assistant-model.js';
import { withAssistantTraceExportDisabled } from './assistant-tracing.js';
import { createAssistantGraph } from './assistant-graph-nodes.js';
import {
  graphConfig,
  terminalReasonFrom,
  type GraphEvent,
  type GraphState,
  type TerminalReason
} from './assistant-graph-state.js';
import {
  AssistantTurnBudgetExceededError,
  validateToolCallDecisions
} from './assistant-runtime-policy.js';

export function createLangChainAssistantRuntimeFactory(
  modelCall: AssistantModelCall = callAssistantModel
): AssistantRuntimeFactory {
  return {
    async create(definition) {
      const saver = new MemorySaver();
      const threadId = `assistant-${randomUUID()}`;
      let projection: AssistantRuntimeSnapshot = {
        revision: 0,
        messages: structuredClone(definition.initialMessages ?? []),
        pendingToolCalls: []
      };
      let graphState: GraphState | undefined;
      let streamingMessage: AssistantRuntimeSnapshot['streamingMessage'];
      let queuedEvents: GraphEvent[] = [];
      let observerFailure: unknown;
      let disposed = false;
      let disposalPromise: Promise<void> | undefined;
      // The service serializes mutations. This handle targets cancellation, disposal and observer failures.
      let inFlight:
        | {
            controller: AbortController;
            promise: Promise<AssistantRuntimeResponse>;
            turnId?: string;
          }
        | undefined;
      let cancellation: { turnId: string; promise: Promise<void> } | undefined;
      let failedClosed = false;

      const { graph, event, hasResult, cleanupUpdate } = createAssistantGraph(
        definition,
        modelCall,
        saver
      );

      const config = graphConfig(threadId);
      const derivedActiveTurnId = () => {
        const current = graphState;
        if (
          !current?.turnId ||
          current.terminal !== undefined ||
          current.response?.type === 'assistant_message'
        )
          return undefined;
        return current.batchIds.length || inFlight ? current.turnId : undefined;
      };
      const updateProjection = () => {
        const activeTurnId = derivedActiveTurnId();
        const next = {
          messages: structuredClone(graphState?.uiMessages ?? projection.messages),
          pendingToolCalls: structuredClone(graphState?.calls ?? projection.pendingToolCalls),
          ...(activeTurnId ? { activeTurnId } : {}),
          ...(streamingMessage ? { streamingMessage: structuredClone(streamingMessage) } : {})
        };
        projection = { ...next, revision: projection.revision + 1 };
      };
      const project = (current: GraphState) => {
        graphState = structuredClone(current);
        if (
          streamingMessage &&
          graphState.uiMessages.some((message) => message.id === streamingMessage?.id)
        )
          streamingMessage = undefined;
        if (current.terminal !== undefined || current.response?.type === 'assistant_message')
          streamingMessage = undefined;
        updateProjection();
      };
      const publishDelta = (next: GraphEvent) => {
        const payload = next.payload;
        const turnId = typeof payload.turnId === 'string' ? payload.turnId : undefined;
        const id = typeof payload.messageId === 'string' ? payload.messageId : undefined;
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        const offset = typeof payload.offset === 'number' ? payload.offset : -1;
        const createdAt =
          typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString();
        if (!turnId || !id || !delta || offset < 0 || graphState?.turnId !== turnId) return;
        if (!derivedActiveTurnId()) return;
        const existing = streamingMessage?.id === id ? streamingMessage : undefined;
        const text = existing?.text ?? '';
        if (offset > text.length) return;
        const suffix = offset < text.length ? delta.slice(text.length - offset) : delta;
        if (!suffix) return;
        streamingMessage = { id, turnId, text: text + suffix, createdAt };
        updateProjection();
        try {
          definition.onEvent?.({
            type: next.type,
            ts: new Date().toISOString(),
            payload: { ...structuredClone(next.payload), revision: projection.revision }
          });
        } catch (error) {
          observerFailure = observerFailure ?? error;
          inFlight?.controller.abort('observer-failure');
        }
      };
      const deliverEvents = () => {
        for (const next of queuedEvents) {
          try {
            definition.onEvent?.({
              type: next.type,
              ts: new Date().toISOString(),
              payload: structuredClone(next.payload)
            });
          } catch (error) {
            observerFailure = observerFailure ?? error;
            inFlight?.controller.abort('observer-failure');
          }
        }
        queuedEvents = [];
      };
      const publishSessionSnapshot = () => {
        try {
          definition.onEvent?.({
            type: 'session_snapshot',
            ts: new Date().toISOString(),
            payload: {}
          });
        } catch (error) {
          observerFailure = observerFailure ?? error;
          inFlight?.controller.abort('observer-failure');
        }
      };
      let recoverEngine: (error: unknown) => Promise<GraphState>;
      const pump = async (
        input: unknown,
        requestSignal?: AbortSignal,
        recovering = false
      ): Promise<GraphState> => {
        let last: GraphState | undefined;
        try {
          await withAssistantTraceExportDisabled(async () => {
            for await (const chunk of await graph.stream(
              input as never,
              {
                ...config,
                // Keep the signal configurable so interrupted cancellation cleanup can checkpoint its terminal state.
                configurable: { ...config.configurable, requestSignal },
                streamMode: ['values', 'custom']
              } as never
            )) {
              if (Array.isArray(chunk) && chunk[0] === 'custom') {
                const next = chunk[1] as (typeof queuedEvents)[number];
                if (next.type === 'assistant_message_delta') publishDelta(next);
                else queuedEvents.push(next);
                continue;
              }
              const value = Array.isArray(chunk) && chunk[0] === 'values' ? chunk[1] : chunk;
              if (!value || typeof value !== 'object' || !('messages' in value)) continue;
              last = value as GraphState;
              const priorActiveTurnId = derivedActiveTurnId();
              project(last);
              if (priorActiveTurnId && !derivedActiveTurnId()) publishSessionSnapshot();
              deliverEvents();
            }
          });
          const result = last ?? ((await graph.getState(config)).values as GraphState);
          // The consumer may receive an abort after the approval node has already paused.
          if (requestSignal?.aborted && result.batchIds.length) {
            const saved = await graph.getState(config);
            if (saved.tasks.some((task) => task.interrupts.length)) {
              const terminal = terminalReasonFrom(requestSignal);
              return await pump(new Command({ resume: { terminal } }), undefined, recovering);
            }
          }
          return result;
        } catch (error) {
          if (recovering) {
            failedClosed = true;
            throw error;
          }
          await recoverEngine(error);
          throw error;
        }
      };
      recoverEngine = async (error) => {
        try {
          const latest = await graph.getState(config);
          if (latest.tasks.some((task) => task.interrupts.length)) {
            return await pump(
              new Command({
                resume: {
                  terminal: 'failure',
                  error: error instanceof Error ? error.message : String(error)
                }
              }),
              undefined,
              true
            );
          }
          // MemorySaver can retain a successful pending write when a later checkpoint put fails.
          // Commit cleanup against those writes so recovery does not rerun a tool side effect.
          await graph.updateState(
            config,
            (() => {
              const update = cleanupUpdate(latest.values as GraphState, 'failure', error) as Record<
                string,
                unknown
              >;
              queuedEvents.push(...((update.events ?? []) as typeof queuedEvents));
              delete update.events;
              delete update.goto;
              return update;
            })(),
            'cleanup'
          );
          return await pump(null, undefined, true);
        } catch (recoveryError) {
          failedClosed = true;
          throw recoveryError;
        }
      };
      const consumeObserverFailure = () => {
        if (!observerFailure) return;
        const error = observerFailure;
        observerFailure = undefined;
        throw error;
      };
      const checkpoint = async () => graph.getState(config);
      const paused = async () =>
        (await checkpoint()).tasks.some((task) => task.interrupts.length > 0);
      const resumeTerminal = async (reason: TerminalReason, requestSignal?: AbortSignal) => {
        const result = await pump(new Command({ resume: { terminal: reason } }), requestSignal);
        consumeObserverFailure();
        return result;
      };
      const trackOperation = (
        fn: (signal: AbortSignal) => Promise<AssistantRuntimeResponse>,
        externalSignal?: AbortSignal,
        turnId?: string
      ) => {
        const controller = new AbortController();
        const abort = () => controller.abort(externalSignal?.reason);
        externalSignal?.addEventListener('abort', abort, { once: true });
        if (externalSignal?.aborted) abort();
        const promise = Promise.resolve()
          .then(() => fn(controller.signal))
          .finally(() => {
            externalSignal?.removeEventListener('abort', abort);
            if (inFlight?.promise === promise) inFlight = undefined;
          });
        inFlight = { controller, promise, turnId };
        return promise;
      };

      try {
        await withAssistantTraceExportDisabled(async () => {
          await graph.updateState(config, {
            uiMessages: structuredClone(definition.initialMessages ?? [])
          });
          project((await graph.getState(config)).values as GraphState);
        });
      } catch (error) {
        await saver.deleteThread(threadId);
        throw error;
      }

      return {
        async sendMessage(text, signal, requestedTurnId) {
          return withAssistantTraceExportDisabled(async () => {
            if (disposed) throw new Error('Assistant session is disposed');
            const turnId = requestedTurnId ?? randomUUID();
            let operationTurnId: string | undefined;
            const operation = trackOperation(
              async (requestSignal) => {
                if (disposed) throw new Error('Assistant session is disposed');
                if (failedClosed)
                  throw new Error('Assistant session is closed after a checkpoint failure');
                if (requestSignal.aborted) throw new Error('Request aborted');
                let latest;
                try {
                  latest = await checkpoint();
                } catch (error) {
                  await recoverEngine(error);
                  throw error;
                }
                if (
                  (latest.values as GraphState).uiMessages.some((message) => message.id === turnId)
                ) {
                  const error = new Error('Assistant turn ID has already been used') as Error & {
                    statusCode: number;
                  };
                  error.statusCode = 409;
                  throw error;
                }
                if (disposed || requestSignal.aborted) throw new Error('Request aborted');
                if (latest.tasks.some((task) => task.interrupts.length))
                  await resumeTerminal('superseded', requestSignal);
                if (disposed) throw new Error('Assistant session is disposed');
                if (requestSignal.aborted) throw new Error('Request aborted');
                operationTurnId = turnId;
                queuedEvents.push(event('turn_started'));
                const result = await pump(
                  {
                    messages: [new HumanMessage({ content: text })],
                    uiMessages: [
                      { id: turnId, role: 'user', text, createdAt: new Date().toISOString() }
                    ],
                    rounds: 0,
                    turnId,
                    response: undefined,
                    batchIds: [],
                    results: {},
                    proposals: [],
                    terminal: undefined,
                    error: undefined,
                    budgetExceeded: false
                  },
                  requestSignal
                );
                if (observerFailure) {
                  const error = observerFailure;
                  observerFailure = undefined;
                  throw error;
                }
                if (requestSignal.aborted) throw new Error('Request aborted');
                if (result.budgetExceeded) throw new AssistantTurnBudgetExceededError();
                if (result.terminal === 'failure')
                  throw new Error(result.error ?? 'Assistant turn failed');
                project(result);
                return result.response ?? { type: 'assistant_message', text: '' };
              },
              signal,
              turnId
            );
            return operation.finally(async () => {
              if (!operationTurnId) return;
              try {
                const latest = await checkpoint();
                project(latest.values as GraphState);
              } catch {
                streamingMessage = undefined;
                updateProjection();
              }
            });
          });
        },
        async resolveToolCalls(decisions, signal) {
          return withAssistantTraceExportDisabled(async () => {
            if (disposed) throw new Error('Assistant session is disposed');
            if (failedClosed)
              throw new Error('Assistant session is closed after a checkpoint failure');
            return trackOperation(
              async (requestSignal) => {
                let latest;
                try {
                  latest = await checkpoint();
                } catch (error) {
                  await recoverEngine(error);
                  throw error;
                }
                if (disposed || requestSignal.aborted) throw new Error('Request aborted');
                const current = latest.values as GraphState;
                project(current);
                const pending = current.calls.filter((call) => current.batchIds.includes(call.id));
                validateToolCallDecisions(decisions, pending, pending, (id) =>
                  hasResult(current.results, id)
                );
                if (!latest.tasks.some((task) => task.interrupts.length))
                  throw new Error('Tool batch is not pending');
                if (disposed || requestSignal.aborted) throw new Error('Request aborted');
                const result = await pump(new Command({ resume: decisions }), requestSignal);
                consumeObserverFailure();
                if (requestSignal.aborted) throw new Error('Request aborted');
                if (result.batchIds.length)
                  return (
                    result.response ?? {
                      type: 'tool_call_resolved',
                      text: '',
                      pendingToolCalls: result.calls.filter(
                        (call) =>
                          result.batchIds.includes(call.id) && !hasResult(result.results, call.id)
                      )
                    }
                  );
                if (result.budgetExceeded) throw new AssistantTurnBudgetExceededError();
                if (result.terminal === 'failure')
                  throw new Error(result.error ?? 'Assistant turn failed');
                project(result);
                return result.response ?? { type: 'assistant_message', text: '' };
              },
              signal,
              graphState?.turnId
            );
          });
        },
        getSnapshot: () => structuredClone(projection),
        async cancel(turnId) {
          if (disposed || !turnId) return;
          if (inFlight ? inFlight.turnId !== turnId : derivedActiveTurnId() !== turnId) return;
          if (cancellation?.turnId === turnId) return cancellation.promise;
          const promise = (async () => {
            const running = inFlight;
            if (running) {
              running.controller.abort('cancelled');
              try {
                await running.promise;
              } catch {
                // Cancellation commits its terminal graph state before the turn rejects.
              }
              return;
            }
            if (failedClosed) return;
            await trackOperation(
              async () => {
                const latest = await checkpoint();
                if (
                  latest.values.turnId !== turnId ||
                  !latest.tasks.some((task) => task.interrupts.length)
                )
                  return { type: 'assistant_message' as const, text: '' };
                await resumeTerminal('cancelled');
                const settled = await checkpoint();
                streamingMessage = undefined;
                project(settled.values as GraphState);
                return { type: 'assistant_message' as const, text: '' };
              },
              undefined,
              turnId
            );
          })();
          cancellation = { turnId, promise };
          try {
            await promise;
          } finally {
            if (cancellation?.promise === promise) cancellation = undefined;
          }
        },
        async dispose() {
          if (disposalPromise) return disposalPromise;
          if (disposed) return;
          disposed = true;
          const running = inFlight;
          disposalPromise = withAssistantTraceExportDisabled(async () => {
            try {
              if (running) {
                running.controller.abort('disposed');
                try {
                  await running.promise;
                } catch {
                  /* terminal graph state is committed before rejection */
                }
              }
              if (await paused()) await resumeTerminal('disposed');
            } catch (error) {
              failedClosed = true;
              throw error;
            } finally {
              await saver.deleteThread(threadId);
            }
          });
          return disposalPromise;
        }
      } satisfies AssistantRuntimeSession;
    }
  };
}
