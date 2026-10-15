import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
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
import { throwIfAborted } from './assistant-common.js';
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

type Route = 'model' | 'policy' | 'pause' | 'end';
type GraphState = {
  messages: BaseMessage[];
  route: Route;
  output: AssistantRuntimeResponse | undefined;
  calls: AssistantRuntimeToolCall[];
  rounds: number;
  generation: number;
  budgetExceeded: boolean;
};
const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ value: (_old, value) => value, default: () => [] }),
  route: Annotation<Route>({ value: (_old, value) => value, default: () => 'model' }),
  output: Annotation<AssistantRuntimeResponse | undefined>({
    value: (_old, value) => value,
    default: () => undefined
  }),
  calls: Annotation<AssistantRuntimeToolCall[]>({
    value: (_old, value) => value,
    default: () => []
  }),
  rounds: Annotation<number>({ value: (_old, value) => value, default: () => 0 }),
  generation: Annotation<number>({ value: (_old, value) => value, default: () => 0 }),
  budgetExceeded: Annotation<boolean>({ value: (_old, value) => value, default: () => false })
});
type Batch = {
  calls: AssistantRuntimeToolCall[];
  results: Map<string, string>;
  generation: number;
  executing?: string;
};

export function createLangChainAssistantRuntimeFactory(
  modelCall: AssistantModelCall = callAssistantModel
): AssistantRuntimeFactory {
  return {
    async create(definition) {
      const snapshot: AssistantRuntimeSnapshot = {
        messages: structuredClone(definition.initialMessages ?? []),
        pendingToolCalls: []
      };
      let latest: GraphState = {
        messages: [], // initial UI messages are transport-only, as in the native runtime
        route: 'model',
        output: undefined,
        calls: [],
        rounds: 0,
        generation: 0,
        budgetExceeded: false
      };
      let batch: Batch | undefined;
      let disposed = false;
      let generation = 0;
      const proposals: ScenarioAssistantSuggestionBundle[] = [];
      const emit = (type: AssistantRuntimeEvent['type'], payload = {}) => {
        if (!disposed) definition.onEvent?.({ type, ts: new Date().toISOString(), payload });
      };
      const isCurrent = (g: number, owner?: Batch) =>
        !disposed && generation === g && (!owner || batch === owner);
      const publish = (state: GraphState, update: Partial<GraphState>): Partial<GraphState> => {
        latest = { ...state, ...update };
        return latest;
      };
      const graph = new StateGraph(State)
        .addNode('model', async (state: GraphState, config: { signal?: AbortSignal }) => {
          const g = state.generation;
          if (!isCurrent(g)) return { route: 'end', generation: state.generation };
          if (state.rounds >= MAX_ASSISTANT_MODEL_CALLS)
            return publish(state, { rounds: state.rounds, route: 'end', budgetExceeded: true });
          const rounds = state.rounds + 1;
          latest = { ...state, rounds };
          const output = await raceAssistantAbort(
            modelCall(definition, [...state.messages], config.signal),
            config.signal
          );
          if (!isCurrent(g)) return { route: 'end', generation: state.generation };
          if (output.type === 'assistant_message') {
            const suggestions = mergeAssistantSuggestions(proposals);
            const message: AssistantRuntimeMessage = {
              id: `msg-${randomUUID()}`,
              role: 'assistant',
              text: output.text,
              createdAt: new Date().toISOString(),
              ...(suggestions ? { suggestions } : {})
            };
            snapshot.messages.push(message);
            proposals.length = 0;
            const response: AssistantRuntimeResponse = {
              type: 'assistant_message',
              text: output.text,
              ...(suggestions ? { suggestions } : {})
            };
            emit('assistant_message_completed', {
              text: output.text,
              ...(suggestions ? { suggestions } : {})
            });
            return publish(latest, {
              messages: [
                ...state.messages,
                output.nativeMessage ?? new AIMessage({ content: output.text })
              ],
              rounds,
              output: response,
              route: 'end'
            });
          }
          const usedIds = new Set(snapshot.pendingToolCalls.map((call) => call.id));
          const calls = output.toolCalls.map((call) =>
            createPendingToolCall(definition, call, usedIds)
          );
          const native = output.nativeMessage;
          const additionalKwargs = { ...(native?.additional_kwargs ?? {}) };
          delete additionalKwargs.tool_calls;
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
          const aiMessage = new AIMessage({
            content,
            id: native?.id ?? `msg-${randomUUID()}`,
            additional_kwargs: additionalKwargs,
            response_metadata: native?.response_metadata,
            usage_metadata: native?.usage_metadata,
            tool_calls: calls.map((call) => ({
              id: call.id,
              name: call.publicToolName,
              args: call.arguments as Record<string, unknown>,
              type: 'tool_call' as const
            }))
          });
          snapshot.pendingToolCalls.push(...calls);
          snapshot.messages.push({
            id: `msg-${randomUUID()}`,
            role: 'assistant',
            text: output.text,
            createdAt: new Date().toISOString(),
            pendingToolCallId: calls[0]?.id,
            pendingToolCallIds: calls.map((call) => call.id),
            toolRequestServer: calls[0]?.server,
            toolRequestName: calls[0]?.tool,
            toolRequestPublicName: calls[0]?.publicToolName
          });
          const owner: Batch = { calls, results: new Map(), generation: g };
          batch = owner;
          const response: AssistantRuntimeResponse = {
            type: 'tool_call_request',
            text: output.text,
            pendingToolCalls: calls
          };
          return publish(latest, {
            messages: [...state.messages, aiMessage],
            rounds,
            calls,
            output: response,
            route: 'policy'
          });
        })
        .addNode('policy', async (state: GraphState, config: { signal?: AbortSignal }) => {
          const owner = batch;
          if (!owner || !isCurrent(state.generation, owner))
            return { route: 'end', generation: state.generation };
          if (state.rounds >= MAX_ASSISTANT_MODEL_CALLS) {
            cleanup(owner, 'budget');
            return publish(latest, {
              messages: latest.messages,
              route: 'end',
              budgetExceeded: true
            });
          }
          const { oversized, unknown, invalid, local, validExternal, needsApproval } =
            classifyToolCalls(definition, owner.calls);
          if (oversized) {
            owner.calls.forEach((call) => fail(owner, call, OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR));
            finish(owner);
            return publish(latest, { route: 'model', messages: latest.messages });
          }
          unknown.forEach((call) =>
            fail(owner, call, `Unknown assistant tool '${call.publicToolName}'`)
          );
          invalid.forEach((call) => fail(owner, call, call.validationError!));
          for (const call of local) {
            await execute(owner, call, config.signal);
            if (!isCurrent(state.generation, owner))
              return { route: 'end', generation: state.generation };
          }
          const waiting = owner.calls.filter((call) => call.status === 'pending');
          if (waiting.length)
            emit('tool_call_requested', {
              pendingToolCalls: waiting,
              pendingToolCallId: waiting[0]?.id
            });
          if (needsApproval) {
            return publish(latest, {
              output: {
                type: 'tool_call_request',
                text: state.output?.text ?? '',
                pendingToolCalls: waiting
              },
              route: 'pause'
            });
          }
          for (const call of validExternal) {
            call.status = 'approved';
            emit('tool_call_approved', { pendingToolCallId: call.id });
            await execute(owner, call, config.signal);
            if (!isCurrent(state.generation, owner))
              return { route: 'end', generation: state.generation };
          }
          finish(owner);
          return publish(latest, { messages: latest.messages, route: 'model' });
        })
        .addConditionalEdges(
          START,
          (state: GraphState) => (state.route === 'policy' ? 'policy' : 'model'),
          ['model', 'policy']
        )
        .addConditionalEdges(
          'model',
          (state: GraphState) => (state.route === 'policy' ? 'policy' : END),
          ['policy', END]
        )
        .addConditionalEdges(
          'policy',
          (state: GraphState) => (state.route === 'model' ? 'model' : END),
          ['model', END]
        )
        .compile({ name: 'MCPLab Assistant' });

      function record(owner: Batch, call: AssistantRuntimeToolCall, content: string) {
        if (!isCurrent(owner.generation, owner) || owner.results.has(call.id)) return;
        owner.results.set(call.id, content);
        call.resultPreview = resultPreview(content);
        emit('tool_call_resolved', { pendingToolCallId: call.id, pendingToolCall: call });
      }
      function fail(
        owner: Batch,
        call: AssistantRuntimeToolCall,
        message: string,
        status: AssistantRuntimeToolCall['status'] = 'error'
      ) {
        call.status = status;
        call.error = message;
        record(owner, call, JSON.stringify({ error: message }));
      }
      function finish(owner: Batch) {
        const results = orderedBatchResults(owner.calls, (id) => owner.results.get(id));
        if (batch !== owner || !results) return;
        const toolMessages = results.map(
          ({ call, content }) =>
            new ToolMessage({
              content: call.resultPreview ?? content,
              tool_call_id: call.id,
              name: call.publicToolName
            })
        );
        for (const { call, content } of results)
          snapshot.messages.push({
            id: `msg-${randomUUID()}`,
            role: 'tool',
            text: call.error
              ? `Tool error (${call.server}::${call.tool}): ${call.error}`
              : (call.resultPreview ?? content),
            createdAt: new Date().toISOString()
          });
        latest = { ...latest, messages: [...latest.messages, ...toolMessages] };
        batch = undefined;
      }
      function cleanup(
        owner: Batch | undefined,
        reason: 'cancelled' | 'superseded' | 'budget' | 'failure' | 'disposed',
        error?: unknown
      ) {
        if (owner && (owner.generation !== generation || batch !== owner)) return;
        proposals.length = 0;
        if (!owner) return;
        for (const call of owner.calls) {
          if (owner.results.has(call.id)) continue;
          fail(
            owner,
            call,
            terminalToolFeedback(reason, call, owner.executing, error),
            terminalToolStatus(reason, call, owner.executing)
          );
        }
        finish(owner);
      }
      async function execute(owner: Batch, call: AssistantRuntimeToolCall, signal?: AbortSignal) {
        const tool = definition.tools.find((candidate) => candidate.name === call.publicToolName);
        if (!tool) {
          fail(owner, call, `Unknown assistant tool '${call.publicToolName}'`);
          return;
        }
        if (signal?.aborted) throwIfAborted(signal);
        owner.executing = call.id;
        try {
          const value = await raceAssistantAbort(tool.execute(call.arguments, signal), signal);
          if (!isCurrent(owner.generation, owner)) return;
          call.status = 'approved';
          const proposal = tool.extractProposal?.(value);
          if (proposal) proposals.push(proposal);
          record(owner, call, JSON.stringify(value));
        } catch (error) {
          if (isCurrent(owner.generation, owner))
            fail(
              owner,
              call,
              signal?.aborted
                ? terminalToolFeedback('cancelled', call, call.id)
                : error instanceof Error
                  ? error.message
                  : String(error)
            );
          if (signal?.aborted) throw error;
        } finally {
          if (owner.executing === call.id) owner.executing = undefined;
        }
      }
      async function invoke(signal?: AbortSignal): Promise<AssistantRuntimeResponse> {
        const invokedGeneration = latest.generation;
        try {
          const result = await graph.invoke(latest, { recursionLimit: 200, signal });
          if (!isCurrent(invokedGeneration)) throw new Error('Assistant turn was superseded');
          latest = result as GraphState;
          if (latest.budgetExceeded) {
            cleanup(batch, 'budget');
            throw new AssistantTurnBudgetExceededError();
          }
          return latest.output ?? { type: 'assistant_message', text: '' };
        } catch (error) {
          if (isCurrent(invokedGeneration))
            cleanup(batch, signal?.aborted ? 'cancelled' : 'failure', error);
          throw error;
        }
      }
      return {
        async sendMessage(message: string, signal?: AbortSignal) {
          return withAssistantTraceExportDisabled(async () => {
            if (disposed) throw new Error('Assistant session is disposed');
            if (batch) cleanup(batch, 'superseded');
            const nextGeneration = ++generation;
            proposals.length = 0;
            latest = {
              ...latest,
              messages: [...latest.messages, new HumanMessage({ content: message })],
              route: 'model',
              output: undefined,
              calls: [],
              rounds: 0,
              generation: nextGeneration,
              budgetExceeded: false
            };
            snapshot.messages.push({
              id: `msg-${randomUUID()}`,
              role: 'user',
              text: message,
              createdAt: new Date().toISOString()
            });
            emit('turn_started');
            return invoke(signal);
          });
        },
        async resolveToolCalls(decisions: AssistantToolCallDecision[], signal?: AbortSignal) {
          return withAssistantTraceExportDisabled(async () => {
            if (disposed) throw new Error('Assistant session is disposed');
            const owner = batch;
            if (!owner) throw new Error('Tool batch is not pending');
            const validated = validateToolCallDecisions(
              decisions,
              snapshot.pendingToolCalls,
              owner.calls,
              (id) => owner.results.has(id)
            );
            try {
              for (const { decision, call } of validated) {
                if (!isCurrent(owner.generation, owner))
                  throw new Error('Assistant turn was superseded');
                if (decision.decision === 'deny') {
                  call.status = 'denied';
                  call.error = 'User denied tool call';
                  emit('tool_call_denied', { pendingToolCallId: call.id });
                  record(owner, call, JSON.stringify({ denied: true, reason: call.error }));
                } else {
                  if (decision.arguments !== undefined) call.arguments = decision.arguments;
                  call.status = 'approved';
                  emit('tool_call_approved', { pendingToolCallId: call.id });
                  await execute(owner, call, signal);
                }
              }
              throwIfAborted(signal);
              const unresolved = owner.calls.filter((call) => !owner.results.has(call.id));
              if (unresolved.length)
                return { type: 'tool_call_resolved', text: '', pendingToolCalls: unresolved };
              finish(owner);
              latest = { ...latest, route: 'model', output: undefined };
              return await invoke(signal);
            } catch (error) {
              cleanup(owner, signal?.aborted ? 'cancelled' : 'failure', error);
              throw error;
            }
          });
        },
        getSnapshot: () => structuredClone(snapshot),
        async dispose() {
          if (disposed) return;
          cleanup(batch, 'disposed');
          disposed = true;
          generation++;
        }
      } satisfies AssistantRuntimeSession;
    }
  };
}
