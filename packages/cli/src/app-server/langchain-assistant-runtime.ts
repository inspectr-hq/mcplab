import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  messagesStateReducer,
  START,
  StateGraph
} from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeFactory,
  AssistantRuntimeMessage,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantRuntimeSnapshot,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision,
  ScenarioAssistantSuggestionBundle
} from '@inspectr/mcplab-core';
import { callAssistantModel, type AssistantModelCall } from './assistant-model.js';
import { withAssistantTraceExportDisabled } from './assistant-tracing.js';
import {
  classifyToolCalls,
  createPendingToolCall,
  AssistantTurnBudgetExceededError,
  MAX_ASSISTANT_MODEL_CALLS,
  mergeAssistantSuggestions,
  OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR,
  orderedBatchResults,
  raceAssistantAbort,
  resultPreview,
  terminalToolFeedback,
  terminalToolStatus,
  validateToolCallDecisions
} from './assistant-runtime-policy.js';

type Route =
  | 'idle'
  | 'model'
  | 'policy'
  | 'approval'
  | 'apply'
  | 'select'
  | 'execute'
  | 'finish'
  | 'cleanup'
  | 'end';
type TerminalReason = 'cancelled' | 'superseded' | 'budget' | 'failure' | 'disposed';
const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  uiMessages: Annotation<AssistantRuntimeMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  calls: Annotation<AssistantRuntimeToolCall[]>({ reducer: (_a, b) => b, default: () => [] }),
  batchIds: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  results: Annotation<Record<string, string>>({ reducer: (_a, b) => b, default: () => ({}) }),
  proposals: Annotation<ScenarioAssistantSuggestionBundle[]>({
    reducer: (_a, b) => b,
    default: () => []
  }),
  rounds: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  turnId: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  route: Annotation<Route>({ reducer: (_a, b) => b, default: () => 'idle' }),
  response: Annotation<AssistantRuntimeResponse | undefined>({
    reducer: (_a, b) => b,
    default: () => undefined
  }),
  decisions: Annotation<AssistantToolCallDecision[]>({ reducer: (_a, b) => b, default: () => [] }),
  terminal: Annotation<TerminalReason | undefined>({
    reducer: (_a, b) => b,
    default: () => undefined
  }),
  error: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  budgetExceeded: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  executingId: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  events: Annotation<
    Array<{ id: string; type: AssistantRuntimeEvent['type']; payload: Record<string, unknown> }>
  >({ reducer: (_a, b) => b, default: () => [] })
});
type GraphState = typeof State.State;
const graphConfig = (threadId: string) => ({
  configurable: { thread_id: threadId },
  recursionLimit: 1000,
  durability: 'sync' as const
});
const messageId = () => `msg-${randomUUID()}`;
const persistNativeMessage = (message: AIMessage, history: BaseMessage[]) => {
  if (!message.id || !history.some((existing) => existing.id === message.id)) return message;
  return new AIMessage({
    content: message.content,
    id: `${String(message.id)}#${messageId()}`,
    additional_kwargs: { ...message.additional_kwargs, original_provider_id: message.id },
    response_metadata: message.response_metadata,
    usage_metadata: message.usage_metadata,
    tool_calls: message.tool_calls
  });
};
const routeTo = (source: string, route: Route, allowed: string[]) => {
  const destination = route === 'end' ? END : route;
  if (destination !== END && !allowed.includes(destination))
    throw new Error(`Invalid ${source} graph route: ${route}`);
  return destination;
};
const visibleToolMessage = (
  call: AssistantRuntimeToolCall,
  content: string
): AssistantRuntimeMessage => ({
  id: messageId(),
  role: 'tool',
  text: call.error
    ? `Tool error (${call.server}::${call.tool}): ${call.error}`
    : (call.resultPreview ?? content),
  createdAt: new Date().toISOString()
});

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
      const deliveredEvents = new Set<string>();
      let observerFailure: unknown;
      let disposed = false;
      let disposalPromise: Promise<void> | undefined;
      let active:
        | { controller: AbortController; promise: Promise<AssistantRuntimeResponse> }
        | undefined;
      let failedClosed = false;

      const event = (
        type: AssistantRuntimeEvent['type'],
        payload: Record<string, unknown> = {}
      ) => ({ id: randomUUID(), type, payload });
      const hasResult = (results: Record<string, string>, id: string) => Object.hasOwn(results, id);
      const addResult = (
        state: GraphState,
        callId: string,
        content: string,
        status: AssistantRuntimeToolCall['status'],
        error?: string
      ) => {
        const preview = resultPreview(content);
        const calls = state.calls.map((call) =>
          call.id !== callId
            ? call
            : {
                ...call,
                status,
                resultPreview: preview,
                ...(error ? { error } : {})
              }
        );
        return {
          calls,
          results: { ...state.results, [callId]: preview },
          events: [
            event('tool_call_resolved', {
              pendingToolCallId: callId,
              pendingToolCall: calls.find((call) => call.id === callId)
            })
          ]
        };
      };
      const withToolMessages = (state: GraphState) => {
        const batch = state.calls.filter((call) => state.batchIds.includes(call.id));
        const results = orderedBatchResults(batch, (id) => state.results[id]);
        if (!results) return {};
        return {
          messages: results.map(
            ({ call, content }) =>
              new ToolMessage({
                content: call.resultPreview ?? content,
                tool_call_id: call.id,
                name: call.publicToolName
              })
          ),
          uiMessages: results.map(({ call, content }) => visibleToolMessage(call, content)),
          batchIds: []
        };
      };
      const cleanupUpdate = (state: GraphState, reason: TerminalReason, error?: unknown) => {
        const detail = error instanceof Error ? error.message : String(error ?? '');
        const updates: Partial<GraphState> = {
          terminal: reason,
          proposals: [],
          route: 'finish',
          error: detail || undefined,
          budgetExceeded: reason === 'budget'
        };
        let calls = state.calls;
        let results = state.results;
        let events: GraphState['events'] = [...state.events];
        for (const id of state.batchIds) {
          const call = calls.find((item) => item.id === id);
          if (!call || hasResult(results, id)) continue;
          const content = JSON.stringify({
            error: terminalToolFeedback(reason, call, state.executingId, error)
          });
          const next = addResult(
            { ...state, calls, results },
            id,
            content,
            terminalToolStatus(reason, call, state.executingId),
            terminalToolFeedback(reason, call, state.executingId, error)
          );
          calls = next.calls;
          results = next.results;
          events = [...events, ...next.events];
        }
        Object.assign(updates, { calls, results, events, executingId: undefined });
        const combined = { ...state, ...updates } as GraphState;
        return { ...withToolMessages(combined), ...updates, results: {}, route: 'finish' as Route };
      };

      const graph = new StateGraph(State)
        .addNode('idle', () => ({ route: 'end' as Route }))
        .addNode(
          'model',
          async (state: GraphState, config: { configurable?: { requestSignal?: AbortSignal } }) => {
            const signal = config.configurable?.requestSignal;
            if (signal?.aborted)
              return cleanupUpdate(
                { ...state, executingId: undefined },
                signal.reason === 'superseded' ? 'superseded' : (state.terminal ?? 'cancelled')
              );
            if (state.rounds >= MAX_ASSISTANT_MODEL_CALLS) return cleanupUpdate(state, 'budget');
            const rounds = state.rounds + 1;
            try {
              const output = await raceAssistantAbort(
                modelCall(definition, [...state.messages], signal),
                signal
              );
              if (signal?.aborted)
                return cleanupUpdate(
                  state,
                  signal.reason === 'superseded' ? 'superseded' : 'cancelled'
                );
              if (output.type === 'assistant_message') {
                const suggestions = mergeAssistantSuggestions(state.proposals);
                const ui: AssistantRuntimeMessage = {
                  id: messageId(),
                  role: 'assistant',
                  text: output.text,
                  createdAt: new Date().toISOString(),
                  ...(suggestions ? { suggestions } : {})
                };
                const ai = output.nativeMessage ?? new AIMessage({ content: output.text });
                const persisted = persistNativeMessage(ai, state.messages);
                return {
                  messages: [persisted],
                  uiMessages: [ui],
                  proposals: [],
                  rounds,
                  response: {
                    type: 'assistant_message',
                    text: output.text,
                    ...(suggestions ? { suggestions } : {})
                  },
                  route: 'end',
                  terminal: undefined,
                  events: [
                    event('assistant_message_completed', {
                      text: output.text,
                      ...(suggestions ? { suggestions } : {})
                    })
                  ]
                };
              }
              const ids = new Set(state.calls.map((call) => call.id));
              const calls = output.toolCalls.map((call) =>
                createPendingToolCall(definition, call, ids)
              );
              const native = output.nativeMessage;
              const kwargs = { ...(native?.additional_kwargs ?? {}) };
              delete kwargs.tool_calls;
              let nativeToolIndex = 0;
              const content = Array.isArray(native?.content)
                ? native.content.map((block) => {
                    if (
                      !block ||
                      typeof block !== 'object' ||
                      (block as { type?: unknown }).type !== 'tool_use'
                    )
                      return block;
                    const call = calls[nativeToolIndex++];
                    return call
                      ? ({
                          ...(block as Record<string, unknown>),
                          id: call.id,
                          input: call.arguments
                        } as unknown as typeof block)
                      : block;
                  })
                : (native?.content ?? output.text);
              const incoming = new AIMessage({
                content,
                id: native?.id ?? messageId(),
                additional_kwargs: kwargs,
                response_metadata: native?.response_metadata,
                usage_metadata: native?.usage_metadata,
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  name: call.publicToolName,
                  args: call.arguments as Record<string, unknown>,
                  type: 'tool_call' as const
                }))
              });
              const persisted = persistNativeMessage(incoming, state.messages);
              const ui: AssistantRuntimeMessage = {
                id: messageId(),
                role: 'assistant',
                text: output.text,
                createdAt: new Date().toISOString(),
                pendingToolCallId: calls[0]?.id,
                pendingToolCallIds: calls.map((call) => call.id),
                toolRequestServer: calls[0]?.server,
                toolRequestName: calls[0]?.tool,
                toolRequestPublicName: calls[0]?.publicToolName
              };
              return {
                messages: [persisted],
                uiMessages: [ui],
                calls: [...state.calls, ...calls],
                batchIds: calls.map((call) => call.id),
                results: {},
                rounds,
                response: { type: 'tool_call_request', text: output.text, pendingToolCalls: calls },
                route: 'policy',
                events: []
              };
            } catch (error) {
              return cleanupUpdate(
                state,
                signal?.aborted
                  ? signal.reason === 'superseded'
                    ? 'superseded'
                    : 'cancelled'
                  : 'failure',
                error
              );
            }
          }
        )
        .addNode('policy', (state: GraphState) => {
          const batch = state.calls.filter((call) => state.batchIds.includes(call.id));
          if (state.rounds >= MAX_ASSISTANT_MODEL_CALLS) return cleanupUpdate(state, 'budget');
          const { oversized, unknown, invalid, local, validExternal, needsApproval } =
            classifyToolCalls(definition, batch);
          if (oversized) {
            let update: Partial<GraphState> = {};
            let current = state;
            for (const call of batch) {
              const next = addResult(
                current,
                call.id,
                JSON.stringify({ error: OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR }),
                'error',
                OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR
              );
              current = { ...current, ...next };
              update = { ...update, ...next, events: [...(update.events ?? []), ...next.events] };
            }
            return {
              ...update,
              ...withToolMessages({ ...state, ...update }),
              results: {},
              route: 'model'
            };
          }
          let current: GraphState = state;
          let update: Partial<GraphState> = {};
          for (const call of [...unknown, ...invalid]) {
            const message =
              call.validationError ?? `Unknown assistant tool '${call.publicToolName}'`;
            const next = addResult(
              current,
              call.id,
              JSON.stringify({ error: message }),
              'error',
              message
            );
            current = { ...current, ...next };
            update = { ...update, ...next, events: [...(update.events ?? []), ...next.events] };
          }
          const localPending = local.find((call) => !hasResult(current.results, call.id));
          if (localPending) {
            const calls = current.calls.map((call) =>
              call.id === localPending.id ? { ...call, status: 'approved' as const } : call
            );
            return { ...update, calls, executingId: undefined, route: 'select' };
          }
          const waiting = validExternal.filter((call) => !hasResult(current.results, call.id));
          if (needsApproval && waiting.length)
            return {
              ...update,
              route: 'approval',
              response: {
                type: 'tool_call_request',
                text: state.response?.text ?? '',
                pendingToolCalls: waiting
              },
              events: [
                ...(update.events ?? []),
                event('tool_call_requested', {
                  pendingToolCalls: waiting,
                  pendingToolCallId: waiting[0]?.id
                })
              ]
            };
          if (waiting.length) {
            const calls = current.calls.map((call) =>
              waiting.some((item) => item.id === call.id)
                ? { ...call, status: 'approved' as const }
                : call
            );
            return {
              ...update,
              calls,
              decisions: waiting.map((call) => ({
                toolCallId: call.id,
                decision: 'approve' as const
              })),
              executingId: undefined,
              route: 'select',
              events: [
                ...(update.events ?? []),
                ...waiting.map((call) =>
                  event('tool_call_approved', { pendingToolCallId: call.id })
                )
              ]
            };
          }
          return {
            ...update,
            ...withToolMessages({ ...state, ...update }),
            results: {},
            route: 'model'
          };
        })
        .addNode(
          'approval',
          (state: GraphState, config: { configurable?: { requestSignal?: AbortSignal } }) => {
            const signal = config.configurable?.requestSignal;
            if (signal?.aborted)
              return {
                terminal: signal.reason === 'superseded' ? 'superseded' : 'cancelled',
                route: 'cleanup'
              };
            const resume = interrupt({
              calls: state.calls.filter(
                (call) => state.batchIds.includes(call.id) && !hasResult(state.results, call.id)
              )
            });
            if (
              resume &&
              typeof resume === 'object' &&
              !Array.isArray(resume) &&
              'terminal' in resume
            )
              return {
                terminal: (resume as { terminal: TerminalReason }).terminal,
                error: (resume as { error?: string }).error,
                route: 'cleanup'
              };
            return { decisions: resume as AssistantToolCallDecision[], route: 'apply' };
          }
        )
        .addNode('apply', (state: GraphState) => {
          let calls = state.calls;
          let results = state.results;
          const events: GraphState['events'] = [];
          for (const decision of state.decisions) {
            const call = calls.find((item) => item.id === decision.toolCallId);
            if (!call || hasResult(results, call.id)) continue;
            if (decision.decision === 'deny') {
              const error = 'User denied tool call';
              const next = addResult(
                { ...state, calls, results },
                call.id,
                JSON.stringify({ denied: true, reason: error }),
                'denied',
                error
              );
              calls = next.calls;
              results = next.results;
              events.push(
                event('tool_call_denied', { pendingToolCallId: call.id }),
                ...next.events
              );
            } else {
              calls = calls.map((item) =>
                item.id === call.id
                  ? {
                      ...item,
                      status: 'approved' as const,
                      ...(decision.arguments !== undefined ? { arguments: decision.arguments } : {})
                    }
                  : item
              );
              events.push(event('tool_call_approved', { pendingToolCallId: call.id }));
            }
          }
          const nextExec = state.decisions
            .map((decision) => decision.toolCallId)
            .find(
              (id) =>
                calls.find((call) => call.id === id)?.status === 'approved' &&
                !hasResult(results, id)
            );
          if (nextExec)
            return {
              calls,
              results,
              decisions: state.decisions,
              executingId: undefined,
              route: 'select',
              events
            };
          const unresolved = state.batchIds.filter((id) => !hasResult(results, id));
          if (unresolved.length)
            return {
              calls,
              results,
              decisions: [],
              route: 'approval',
              response: {
                type: 'tool_call_resolved',
                text: '',
                pendingToolCalls: calls.filter((call) => unresolved.includes(call.id))
              },
              events
            };
          return {
            calls,
            results: {},
            decisions: [],
            ...withToolMessages({ ...state, calls, results }),
            route: 'model',
            events
          };
        })
        .addNode(
          'select',
          (state: GraphState, config: { configurable?: { requestSignal?: AbortSignal } }) => {
            const signal = config.configurable?.requestSignal;
            if (signal?.aborted)
              return cleanupUpdate(
                state,
                signal.reason === 'superseded' ? 'superseded' : 'cancelled'
              );
            const next =
              state.decisions
                .map((decision) => decision.toolCallId)
                .find(
                  (id) =>
                    state.calls.find((call) => call.id === id)?.status === 'approved' &&
                    !hasResult(state.results, id)
                ) ??
              state.batchIds.find(
                (id) =>
                  state.calls.find((call) => call.id === id)?.status === 'approved' &&
                  !hasResult(state.results, id)
              );
            return next
              ? { executingId: next, route: 'execute' }
              : { executingId: undefined, route: 'policy' };
          }
        )
        .addNode(
          'execute',
          async (state: GraphState, config: { configurable?: { requestSignal?: AbortSignal } }) => {
            const id = state.executingId;
            const call = state.calls.find((item) => item.id === id);
            if (!id || !call) return { route: 'policy', executingId: undefined };
            const signal = config.configurable?.requestSignal;
            if (signal?.aborted)
              return cleanupUpdate(
                { ...state, executingId: undefined },
                signal.reason === 'superseded' ? 'superseded' : (state.terminal ?? 'cancelled')
              );
            const tool = definition.tools.find(
              (candidate) => candidate.name === call.publicToolName
            );
            if (!tool) {
              const next = addResult(
                state,
                id,
                JSON.stringify({ error: `Unknown assistant tool '${call.publicToolName}'` }),
                'error',
                `Unknown assistant tool '${call.publicToolName}'`
              );
              return { ...next, executingId: undefined, route: 'policy' };
            }
            try {
              const value = await raceAssistantAbort(tool.execute(call.arguments, signal), signal);
              const proposal = tool.extractProposal?.(value);
              const next = addResult(state, id, JSON.stringify(value), 'approved');
              if (signal?.aborted) {
                const updated = {
                  ...state,
                  ...next,
                  proposals: proposal ? [...state.proposals, proposal] : state.proposals,
                  executingId: undefined
                };
                return cleanupUpdate(
                  updated,
                  signal.reason === 'superseded' ? 'superseded' : 'cancelled'
                );
              }
              const calls = next.calls;
              const rest = state.decisions.some(
                (decision) =>
                  decision.toolCallId !== id &&
                  calls.find((item) => item.id === decision.toolCallId)?.status === 'approved' &&
                  !hasResult(next.results, decision.toolCallId)
              );
              const unresolved = state.batchIds.filter(
                (candidate) => candidate !== id && !hasResult(next.results, candidate)
              );
              const partial = !rest && state.decisions.length > 0 && unresolved.length > 0;
              return {
                ...next,
                proposals: proposal ? [...state.proposals, proposal] : state.proposals,
                decisions: rest ? state.decisions : [],
                executingId: undefined,
                route: rest ? 'select' : partial ? 'approval' : 'policy',
                ...(partial
                  ? {
                      response: {
                        type: 'tool_call_resolved' as const,
                        text: '',
                        pendingToolCalls: calls.filter((item) => unresolved.includes(item.id))
                      }
                    }
                  : {})
              };
            } catch (error) {
              if (signal?.aborted)
                return cleanupUpdate(
                  state,
                  signal.reason === 'superseded' ? 'superseded' : 'cancelled',
                  error
                );
              const message = error instanceof Error ? error.message : String(error);
              const next = addResult(
                state,
                id,
                JSON.stringify({ error: message }),
                'error',
                message
              );
              const rest = state.decisions.some(
                (decision) =>
                  decision.toolCallId !== id &&
                  next.calls.find((item) => item.id === decision.toolCallId)?.status ===
                    'approved' &&
                  !hasResult(next.results, decision.toolCallId)
              );
              const unresolved = state.batchIds.filter(
                (candidate) => !hasResult(next.results, candidate)
              );
              const partial = !rest && state.decisions.length > 0 && unresolved.length > 0;
              return {
                ...next,
                decisions: rest ? state.decisions : [],
                executingId: undefined,
                route: rest ? 'select' : partial ? 'approval' : 'policy',
                ...(partial
                  ? {
                      response: {
                        type: 'tool_call_resolved' as const,
                        text: '',
                        pendingToolCalls: next.calls.filter((item) => unresolved.includes(item.id))
                      }
                    }
                  : {})
              };
            }
          }
        )
        .addNode('finish', (state: GraphState) => {
          const update = withToolMessages(state);
          return { ...update, route: state.budgetExceeded ? 'end' : 'end' };
        })
        .addNode('cleanup', (state: GraphState) =>
          cleanupUpdate(state, state.terminal ?? 'failure', state.error)
        )
        .addConditionalEdges(
          START,
          (state: GraphState) =>
            routeTo('start', state.route, [
              'idle',
              'model',
              'policy',
              'approval',
              'apply',
              'select',
              'execute',
              'finish',
              'cleanup'
            ]),
          [
            'idle',
            'model',
            'policy',
            'approval',
            'apply',
            'select',
            'execute',
            'finish',
            'cleanup',
            END
          ]
        )
        .addConditionalEdges(
          'model',
          (state: GraphState) => routeTo('model', state.route, ['policy', 'finish']),
          ['policy', 'finish', END]
        )
        .addConditionalEdges(
          'policy',
          (state: GraphState) =>
            routeTo('policy', state.route, ['approval', 'select', 'model', 'finish']),
          ['approval', 'select', 'model', 'finish']
        )
        .addConditionalEdges(
          'approval',
          (state: GraphState) => routeTo('approval', state.route, ['apply', 'cleanup']),
          ['apply', 'cleanup']
        )
        .addConditionalEdges(
          'apply',
          (state: GraphState) => routeTo('apply', state.route, ['select', 'approval', 'model']),
          ['select', 'approval', 'model']
        )
        .addConditionalEdges(
          'select',
          (state: GraphState) => routeTo('select', state.route, ['execute', 'policy', 'finish']),
          ['execute', 'policy', 'finish']
        )
        .addConditionalEdges(
          'execute',
          (state: GraphState) =>
            routeTo('execute', state.route, ['select', 'policy', 'approval', 'finish']),
          ['select', 'policy', 'approval', 'finish', END]
        )
        .addConditionalEdges('finish', () => END, [END])
        .addConditionalEdges('cleanup', () => 'finish', ['finish'])
        .addEdge('idle', END)
        .compile({ name: 'MCPLab Assistant', checkpointer: saver });

      const config = graphConfig(threadId);
      const project = (current: GraphState) => {
        projection = {
          messages: structuredClone(current.uiMessages),
          pendingToolCalls: structuredClone(current.calls)
        };
        for (const next of current.events) {
          if (deliveredEvents.has(next.id)) continue;
          deliveredEvents.add(next.id);
          try {
            definition.onEvent?.({
              type: next.type,
              ts: new Date().toISOString(),
              payload: structuredClone(next.payload)
            });
          } catch (error) {
            observerFailure = observerFailure ?? error;
            active?.controller.abort('observer-failure');
          }
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
          for await (const value of await withAssistantTraceExportDisabled(() =>
            graph.stream(input as never, {
              ...config,
              configurable: { ...config.configurable, requestSignal },
              streamMode: 'values'
            })
          )) {
            if (!value || typeof value !== 'object' || !('messages' in value)) continue;
            last = value as GraphState;
            project(last);
          }
          const result = last ?? ((await graph.getState(config)).values as GraphState);
          // The consumer may receive an abort after the approval node has already paused.
          if (requestSignal?.aborted && result.batchIds.length) {
            const saved = await graph.getState(config);
            if (saved.tasks.some((task) => task.interrupts.length)) {
              const terminal = requestSignal.reason === 'superseded' ? 'superseded' : 'cancelled';
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
          // Commit successful pending writes before cleanup, without rerunning their nodes.
          await graph.updateState(
            config,
            cleanupUpdate(latest.values as GraphState, 'failure', error),
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
      const run = (
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
            if (active?.promise === promise) active = undefined;
          });
        active = { controller, promise };
        return promise;
      };

      try {
        await withAssistantTraceExportDisabled(async () => {
          await pump({
            uiMessages: structuredClone(definition.initialMessages ?? []),
            route: 'idle'
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
            const previous = active;
            return run(async (requestSignal) => {
              if (previous) {
                previous.controller.abort('superseded');
                try {
                  await previous.promise;
                } catch {
                  /* superseded run has committed terminal state */
                }
              }
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
              const result = await pump(
                {
                  messages: [new HumanMessage({ content: text })],
                  uiMessages: [
                    { id: messageId(), role: 'user', text, createdAt: new Date().toISOString() }
                  ],
                  rounds: 0,
                  turnId,
                  route: 'model',
                  response: undefined,
                  batchIds: [],
                  results: {},
                  proposals: [],
                  terminal: undefined,
                  error: undefined,
                  budgetExceeded: false,
                  events: [event('turn_started')]
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
            if (active)
              throw Object.assign(new Error('Tool batch is no longer pending'), {
                statusCode: 409
              });
            return run(async (requestSignal) => {
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
          const running = active;
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
