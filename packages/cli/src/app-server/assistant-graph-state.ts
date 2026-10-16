import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeMessage,
  AssistantRuntimeEvent,
  AssistantRuntimeResponse,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision,
  ScenarioAssistantSuggestionBundle
} from '@inspectr/mcplab-core';
import { orderedBatchResults, resultPreview } from './assistant-runtime-policy.js';

export type TerminalReason = 'cancelled' | 'superseded' | 'budget' | 'failure' | 'disposed';
export type GraphEvent = {
  id: string;
  type: AssistantRuntimeEvent['type'];
  payload: Record<string, unknown>;
};

export const State = Annotation.Root({
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
  executingId: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined })
});

export type GraphState = typeof State.State;
export const terminalReasonFrom = (
  signal: AbortSignal | undefined,
  fallback: TerminalReason = 'cancelled'
): TerminalReason => (signal?.reason === 'superseded' ? 'superseded' : fallback);
export const graphConfig = (threadId: string) => ({
  configurable: { thread_id: threadId },
  recursionLimit: 1000,
  durability: 'sync' as const
});
export const messageId = () => `msg-${randomUUID()}`;

export const persistNativeMessage = (message: AIMessage, history: BaseMessage[]) => {
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

export const hasResult = (results: Record<string, string>, id: string) =>
  Object.hasOwn(results, id);

export const visibleToolMessage = (
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

export const addResult = (
  state: GraphState,
  callId: string,
  content: string,
  status: AssistantRuntimeToolCall['status'],
  createEvent: (
    type: AssistantRuntimeEvent['type'],
    payload: Record<string, unknown>
  ) => GraphEvent,
  error?: string
) => {
  const preview = resultPreview(content);
  const calls = state.calls.map((call) =>
    call.id !== callId
      ? call
      : { ...call, status, resultPreview: preview, ...(error ? { error } : {}) }
  );
  return {
    calls,
    results: { ...state.results, [callId]: preview },
    events: [
      createEvent('tool_call_resolved', {
        pendingToolCallId: callId,
        pendingToolCall: calls.find((call) => call.id === callId)
      })
    ]
  };
};

export const addResults = (
  state: GraphState,
  callsToResolve: AssistantRuntimeToolCall[],
  resultFor: (call: AssistantRuntimeToolCall) => {
    content: string;
    status: AssistantRuntimeToolCall['status'];
    error?: string;
  },
  createEvent: (type: AssistantRuntimeEvent['type'], payload: Record<string, unknown>) => GraphEvent
) => {
  let current = state;
  const events: GraphEvent[] = [];
  for (const call of callsToResolve) {
    const result = resultFor(call);
    const next = addResult(
      current,
      call.id,
      result.content,
      result.status,
      createEvent,
      result.error
    );
    current = { ...current, ...next };
    events.push(...next.events);
  }
  return { calls: current.calls, results: current.results, events };
};

export const withToolMessages = (state: GraphState) => {
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
