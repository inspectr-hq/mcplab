import { AIMessage } from '@langchain/core/messages';
import { Command, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeMessage,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';
import type { AssistantModelCall } from './assistant-model.js';
import {
  classifyToolCalls,
  createPendingToolCall,
  MAX_ASSISTANT_MODEL_CALLS,
  mergeAssistantSuggestions,
  OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR,
  raceAssistantAbort,
  terminalToolFeedback,
  terminalToolStatus
} from './assistant-runtime-policy.js';
import {
  State,
  type GraphEvent,
  type GraphState,
  type TerminalReason,
  messageId,
  persistNativeMessage,
  toPersistedToolRequest,
  hasResult,
  addResult,
  addResults,
  withToolMessages
} from './assistant-graph-state.js';

type NodeName =
  | 'model'
  | 'policy'
  | 'approval'
  | 'apply'
  | 'select'
  | 'execute'
  | 'finish'
  | 'cleanup';
type ApprovalResume = AssistantToolCallDecision[] | { terminal: TerminalReason; error?: string };
type GraphUpdate = Partial<GraphState> & { goto: NodeName | 'end'; events?: GraphEvent[] };
type NodeConfig = {
  configurable?: { requestSignal?: AbortSignal };
  writer?: (event: GraphEvent) => void;
};
const commandNode =
  (handler: (state: GraphState, config: NodeConfig) => GraphUpdate | Promise<GraphUpdate>) =>
  async (state: GraphState, config: NodeConfig) => {
    const { goto, events = [], ...update } = await handler(state, config);
    for (const next of events) config.writer?.(next);
    return new Command({ goto: goto === 'end' ? END : goto, update });
  };

export function createAssistantGraph(
  definition: AssistantRuntimeDefinition,
  modelCall: AssistantModelCall,
  saver: MemorySaver
) {
  const event = (type: AssistantRuntimeEvent['type'], payload: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    type,
    payload
  });
  const cleanupUpdate = (
    state: GraphState,
    reason: TerminalReason,
    error?: unknown
  ): GraphUpdate => {
    const detail = error instanceof Error ? error.message : String(error ?? '');
    const updates: GraphUpdate = {
      terminal: reason,
      proposals: [],
      goto: 'finish',
      error: detail || undefined,
      budgetExceeded: reason === 'budget'
    };
    const callsToResolve = state.calls.filter(
      (call) => state.batchIds.includes(call.id) && !hasResult(state.results, call.id)
    );
    const resolved = addResults(
      state,
      callsToResolve,
      (call) => {
        const feedback = terminalToolFeedback(reason, call, state.executingId, error);
        return {
          content: JSON.stringify({ error: feedback }),
          status: terminalToolStatus(reason, call, state.executingId),
          error: feedback
        };
      },
      event
    );
    Object.assign(updates, { ...resolved, executingId: undefined });
    const combined = { ...state, ...updates } as GraphState;
    return { ...withToolMessages(combined), ...updates, results: {}, goto: 'finish' };
  };
  const executionContinuation = (
    state: GraphState,
    next: { calls: AssistantRuntimeToolCall[]; results: Record<string, string> },
    id: string,
    proposals = state.proposals
  ): GraphUpdate => {
    const rest = state.decisions.some(
      (decision) =>
        decision.toolCallId !== id &&
        next.calls.find((item) => item.id === decision.toolCallId)?.status === 'approved' &&
        !hasResult(next.results, decision.toolCallId)
    );
    const unresolved = state.batchIds.filter((candidate) => !hasResult(next.results, candidate));
    const partial = !rest && state.decisions.length > 0 && unresolved.length > 0;
    return {
      ...next,
      proposals,
      decisions: rest ? state.decisions : [],
      executingId: undefined,
      goto: rest ? 'select' : partial ? 'approval' : 'policy',
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
  };

  const graph = new StateGraph(State)
    .addNode(
      'model',
      commandNode(async (state: GraphState, config: NodeConfig) => {
        const signal = config.configurable?.requestSignal;
        if (signal?.aborted)
          return cleanupUpdate({ ...state, executingId: undefined }, state.terminal ?? 'cancelled');
        if (state.rounds >= MAX_ASSISTANT_MODEL_CALLS) return cleanupUpdate(state, 'budget');
        const rounds = state.rounds + 1;
        const assistantMessageId = messageId();
        const createdAt = new Date().toISOString();
        let textOffset = 0;
        try {
          const output = await raceAssistantAbort(
            modelCall(definition, [...state.messages], signal, (delta) => {
              if (delta && !signal?.aborted) {
                config.writer?.({
                  id: randomUUID(),
                  type: 'assistant_message_delta',
                  payload: {
                    turnId: state.turnId,
                    messageId: assistantMessageId,
                    offset: textOffset,
                    delta,
                    createdAt
                  }
                });
                textOffset += delta.length;
              }
            }),
            signal
          );
          if (signal?.aborted) return cleanupUpdate(state, 'cancelled');
          if (output.type === 'assistant_message') {
            const suggestions = mergeAssistantSuggestions(state.proposals);
            const ui: AssistantRuntimeMessage = {
              id: assistantMessageId,
              role: 'assistant',
              text: output.text,
              createdAt,
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
              goto: 'end',
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
          const incoming = toPersistedToolRequest(
            output.nativeMessage ?? new AIMessage({ content: output.text }),
            calls
          );
          const persisted = persistNativeMessage(incoming, state.messages);
          const ui: AssistantRuntimeMessage = {
            id: assistantMessageId,
            role: 'assistant',
            text: output.text,
            createdAt,
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
            goto: 'policy',
            events: []
          };
        } catch (error) {
          return cleanupUpdate(state, signal?.aborted ? 'cancelled' : 'failure', error);
        }
      }),
      { ends: ['policy', 'finish', END] }
    )
    .addNode(
      'policy',
      commandNode((state: GraphState) => {
        const batch = state.calls.filter((call) => state.batchIds.includes(call.id));
        if (state.rounds >= MAX_ASSISTANT_MODEL_CALLS) return cleanupUpdate(state, 'budget');
        const { oversized, unknown, invalid, local, validExternal, needsApproval } =
          classifyToolCalls(definition, batch);
        if (oversized) {
          const update = addResults(
            state,
            batch,
            () => ({
              content: JSON.stringify({ error: OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR }),
              status: 'error',
              error: OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR
            }),
            event
          );
          return {
            ...update,
            ...withToolMessages({ ...state, ...update }),
            results: {},
            goto: 'model'
          };
        }
        const update = addResults(
          state,
          [...unknown, ...invalid],
          (call) => {
            const message =
              call.validationError ?? `Unknown assistant tool '${call.publicToolName}'`;
            return { content: JSON.stringify({ error: message }), status: 'error', error: message };
          },
          event
        );
        const current = { ...state, ...update };
        const localPending = local.find((call) => !hasResult(current.results, call.id));
        if (localPending) {
          const calls = current.calls.map((call) =>
            call.id === localPending.id ? { ...call, status: 'approved' as const } : call
          );
          return { ...update, calls, executingId: undefined, goto: 'select' };
        }
        const waiting = validExternal.filter((call) => !hasResult(current.results, call.id));
        if (needsApproval && waiting.length)
          return {
            ...update,
            goto: 'approval',
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
            goto: 'select',
            events: [
              ...(update.events ?? []),
              ...waiting.map((call) => event('tool_call_approved', { pendingToolCallId: call.id }))
            ]
          };
        }
        return {
          ...update,
          ...withToolMessages({ ...state, ...update }),
          results: {},
          goto: 'model'
        };
      }),
      { ends: ['approval', 'select', 'model', 'finish'] }
    )
    .addNode(
      'approval',
      commandNode((state: GraphState, config: NodeConfig) => {
        const signal = config.configurable?.requestSignal;
        if (signal?.aborted)
          return {
            terminal: 'cancelled',
            goto: 'cleanup'
          };
        const resume = interrupt({
          calls: state.calls.filter(
            (call) => state.batchIds.includes(call.id) && !hasResult(state.results, call.id)
          )
        }) as ApprovalResume;
        if (!Array.isArray(resume))
          return {
            terminal: resume.terminal,
            error: resume.error,
            goto: 'cleanup'
          };
        return { decisions: resume, goto: 'apply' };
      }),
      { ends: ['apply', 'cleanup'] }
    )
    .addNode(
      'apply',
      commandNode((state: GraphState) => {
        let calls = state.calls;
        let results = state.results;
        const events: GraphEvent[] = [];
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
              event,
              error
            );
            calls = next.calls;
            results = next.results;
            events.push(event('tool_call_denied', { pendingToolCallId: call.id }), ...next.events);
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
              calls.find((call) => call.id === id)?.status === 'approved' && !hasResult(results, id)
          );
        if (nextExec)
          return {
            calls,
            results,
            decisions: state.decisions,
            executingId: undefined,
            goto: 'select',
            events
          };
        const unresolved = state.batchIds.filter((id) => !hasResult(results, id));
        if (unresolved.length)
          return {
            calls,
            results,
            decisions: [],
            goto: 'approval',
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
          goto: 'model',
          events
        };
      }),
      { ends: ['select', 'approval', 'model'] }
    )
    .addNode(
      'select',
      commandNode((state: GraphState, config: NodeConfig) => {
        const signal = config.configurable?.requestSignal;
        if (signal?.aborted) return cleanupUpdate(state, 'cancelled');
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
          ? { executingId: next, goto: 'execute' }
          : { executingId: undefined, goto: 'policy' };
      }),
      { ends: ['execute', 'policy', 'finish'] }
    )
    .addNode(
      'execute',
      commandNode(async (state: GraphState, config: NodeConfig) => {
        const id = state.executingId;
        const call = state.calls.find((item) => item.id === id);
        if (!id || !call) return { goto: 'policy', executingId: undefined };
        const signal = config.configurable?.requestSignal;
        if (signal?.aborted)
          return cleanupUpdate({ ...state, executingId: undefined }, state.terminal ?? 'cancelled');
        const tool = definition.tools.find((candidate) => candidate.name === call.publicToolName);
        if (!tool) {
          const next = addResult(
            state,
            id,
            JSON.stringify({ error: `Unknown assistant tool '${call.publicToolName}'` }),
            'error',
            event,
            `Unknown assistant tool '${call.publicToolName}'`
          );
          return { ...next, executingId: undefined, goto: 'policy' };
        }
        try {
          const value = await raceAssistantAbort(tool.execute(call.arguments, signal), signal);
          const proposal = tool.extractProposal?.(value);
          const next = addResult(state, id, JSON.stringify(value), 'approved', event);
          if (signal?.aborted) {
            const updated = {
              ...state,
              ...next,
              proposals: proposal ? [...state.proposals, proposal] : state.proposals,
              executingId: undefined
            };
            return cleanupUpdate(updated, 'cancelled');
          }
          return executionContinuation(
            state,
            next,
            id,
            proposal ? [...state.proposals, proposal] : state.proposals
          );
        } catch (error) {
          if (signal?.aborted) return cleanupUpdate(state, 'cancelled', error);
          const message = error instanceof Error ? error.message : String(error);
          const next = addResult(
            state,
            id,
            JSON.stringify({ error: message }),
            'error',
            event,
            message
          );
          return executionContinuation(state, next, id);
        }
      }),
      { ends: ['select', 'policy', 'approval', 'finish', END] }
    )
    .addNode(
      'finish',
      commandNode((state: GraphState) => {
        const update = withToolMessages(state);
        return { ...update, goto: 'end' };
      }),
      { ends: [END] }
    )
    .addNode(
      'cleanup',
      commandNode((state: GraphState) =>
        cleanupUpdate(state, state.terminal ?? 'failure', state.error)
      ),
      { ends: ['finish'] }
    )
    .addEdge(START, 'model')
    .compile({ name: 'MCPLab Assistant', checkpointer: saver });

  return { graph, event, hasResult, cleanupUpdate };
}
