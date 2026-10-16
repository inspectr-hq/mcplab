import { HumanMessage } from '@langchain/core/messages';
import { Command, MemorySaver } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeFactory,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantRuntimeSnapshot,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';
import { callAssistantModel, type AssistantModelCall } from './assistant-model.js';
import { withAssistantTraceExportDisabled } from './assistant-tracing.js';
import { createAssistantGraph } from './assistant-graph-nodes.js';
import {
  graphConfig,
  messageId,
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
        messages: structuredClone(definition.initialMessages ?? []),
        pendingToolCalls: []
      };
      let queuedEvents: GraphEvent[] = [];
      let observerFailure: unknown;
      let disposed = false;
      let disposalPromise: Promise<void> | undefined;
      // The service serializes mutations. This handle only lets disposal and observer failures abort work.
      let inFlight:
        | { controller: AbortController; promise: Promise<AssistantRuntimeResponse> }
        | undefined;
      let failedClosed = false;

      const { graph, event, hasResult, cleanupUpdate } = createAssistantGraph(
        definition,
        modelCall,
        saver
      );

      const config = graphConfig(threadId);
      const project = (current: GraphState) => {
        projection = {
          messages: structuredClone(current.uiMessages),
          pendingToolCalls: structuredClone(current.calls)
        };
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
      let recoverEngine: (error: unknown) => Promise<GraphState>;
      const pump = async (
        input: unknown,
        requestSignal?: AbortSignal,
        recovering = false
      ): Promise<GraphState> => {
        let last: GraphState | undefined;
        try {
          for await (const chunk of await withAssistantTraceExportDisabled(() =>
            graph.stream(
              input as never,
              {
                ...config,
                // Keep the signal configurable so interrupted cancellation cleanup can checkpoint its terminal state.
                configurable: { ...config.configurable, requestSignal },
                streamMode: ['values', 'custom']
              } as never
            )
          )) {
            if (Array.isArray(chunk) && chunk[0] === 'custom') {
              queuedEvents.push(chunk[1] as (typeof queuedEvents)[number]);
              continue;
            }
            const value = Array.isArray(chunk) && chunk[0] === 'values' ? chunk[1] : chunk;
            if (!value || typeof value !== 'object' || !('messages' in value)) continue;
            last = value as GraphState;
            project(last);
            deliverEvents();
          }
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
        externalSignal?: AbortSignal
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
        inFlight = { controller, promise };
        return promise;
      };

      try {
        await withAssistantTraceExportDisabled(async () => {
          await graph.updateState(config, {
            uiMessages: structuredClone(definition.initialMessages ?? [])
          });
        });
      } catch (error) {
        await saver.deleteThread(threadId);
        throw error;
      }

      return {
        async sendMessage(text, signal) {
          return withAssistantTraceExportDisabled(async () => {
            if (disposed) throw new Error('Assistant session is disposed');
            return trackOperation(async (requestSignal) => {
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
              if (disposed || requestSignal.aborted) throw new Error('Request aborted');
              if (latest.tasks.some((task) => task.interrupts.length))
                await resumeTerminal('superseded', requestSignal);
              if (disposed) throw new Error('Assistant session is disposed');
              if (requestSignal.aborted) throw new Error('Request aborted');
              const turnId = randomUUID();
              queuedEvents.push(event('turn_started'));
              const result = await pump(
                {
                  messages: [new HumanMessage({ content: text })],
                  uiMessages: [
                    { id: messageId(), role: 'user', text, createdAt: new Date().toISOString() }
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
              return result.response ?? { type: 'assistant_message', text: '' };
            }, signal);
          });
        },
        async resolveToolCalls(decisions, signal) {
          return withAssistantTraceExportDisabled(async () => {
            if (disposed) throw new Error('Assistant session is disposed');
            if (failedClosed)
              throw new Error('Assistant session is closed after a checkpoint failure');
            return trackOperation(async (requestSignal) => {
              let latest;
              try {
                latest = await checkpoint();
              } catch (error) {
                await recoverEngine(error);
                throw error;
              }
              if (disposed || requestSignal.aborted) throw new Error('Request aborted');
              const current = latest.values as GraphState;
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
              return result.response ?? { type: 'assistant_message', text: '' };
            }, signal);
          });
        },
        getSnapshot: () => structuredClone(projection),
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
