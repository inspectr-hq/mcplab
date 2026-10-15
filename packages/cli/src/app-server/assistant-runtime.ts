import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeFactory,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantRuntimeSnapshot,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision,
  ScenarioAssistantSuggestionBundle
} from '@inspectr/mcplab-core';
import { randomUUID } from 'node:crypto';
import type { LlmMessage } from '@inspectr/mcplab-core';
import { throwIfAborted } from './assistant-common.js';
import { callAssistantModel, type AssistantModelCall } from './assistant-model.js';
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

type Batch = {
  calls: AssistantRuntimeToolCall[];
  results: Map<string, string>;
  executing?: string;
  generation: number;
};

export { AssistantTurnBudgetExceededError } from './assistant-runtime-policy.js';

export function createNativeAssistantRuntimeFactory(
  modelCall: AssistantModelCall = callAssistantModel
): AssistantRuntimeFactory {
  return {
    async create(definition) {
      const history: LlmMessage[] = [];
      const messages: AssistantRuntimeSnapshot['messages'] = structuredClone(
        definition.initialMessages ?? []
      );
      const pending: AssistantRuntimeToolCall[] = [];
      let disposed = false;
      let batch: Batch | undefined;
      let turnRounds = 0;
      let turnGeneration = 0;
      const proposals: ScenarioAssistantSuggestionBundle[] = [];
      const emit = (type: AssistantRuntimeEvent['type'], payload = {}) => {
        if (!disposed) definition.onEvent?.({ type, ts: new Date().toISOString(), payload });
      };
      const snapshot = (): AssistantRuntimeSnapshot =>
        structuredClone({ messages, pendingToolCalls: pending });
      const ensureUsable = () => {
        if (disposed) throw new Error('Assistant session is disposed');
      };
      const isCurrent = (generation: number) => !disposed && turnGeneration === generation;
      const ensureCurrent = (generation: number) => {
        ensureUsable();
        if (turnGeneration !== generation) throw new Error('Assistant turn was superseded');
      };
      const record = (owner: Batch, call: AssistantRuntimeToolCall, content: string) => {
        if (disposed || batch !== owner || owner.results.has(call.id)) return;
        owner.results.set(call.id, content);
        call.resultPreview = resultPreview(content);
        emit('tool_call_resolved', { pendingToolCallId: call.id, pendingToolCall: call });
      };
      const finishBatch = (owner: Batch) => {
        const results = orderedBatchResults(owner.calls, (id) => owner.results.get(id));
        if (batch !== owner || !results) return false;
        for (const { call, content } of results) {
          history.push({
            role: 'tool',
            content: call.resultPreview ?? content,
            tool_call_id: call.id,
            name: call.publicToolName
          });
          messages.push({
            id: `msg-${randomUUID()}`,
            role: 'tool',
            text: call.error
              ? `Tool error (${call.server}::${call.tool}): ${call.error}`
              : (call.resultPreview ?? content),
            createdAt: new Date().toISOString()
          });
        }
        batch = undefined;
        return true;
      };
      const failure = (
        owner: Batch,
        call: AssistantRuntimeToolCall,
        message: string,
        status: AssistantRuntimeToolCall['status'] = 'error'
      ) => {
        call.status = status;
        call.error = message;
        record(owner, call, JSON.stringify({ error: message }));
      };
      const terminalCleanup = (
        generation: number,
        reason: 'cancelled' | 'superseded' | 'budget' | 'failure' | 'disposed',
        owner: Batch | undefined = batch,
        error?: unknown
      ) => {
        if (turnGeneration !== generation) return;
        if (owner && batch === owner) {
          for (const call of owner.calls) {
            if (owner.results.has(call.id)) continue;
            const message = terminalToolFeedback(reason, call, owner.executing, error);
            failure(owner, call, message, terminalToolStatus(reason, call, owner.executing));
          }
          finishBatch(owner);
        }
        proposals.length = 0;
      };
      const execute = async (
        owner: Batch,
        call: AssistantRuntimeToolCall,
        signal?: AbortSignal
      ) => {
        const tool = definition.tools.find((candidate) => candidate.name === call.publicToolName);
        if (!tool) {
          failure(owner, call, `Unknown assistant tool '${call.publicToolName}'`);
          return;
        }
        if (disposed || signal?.aborted) {
          failure(owner, call, 'Tool call cancelled before execution', 'denied');
          throwIfAborted(signal);
          return;
        }
        owner.executing = call.id;
        try {
          const result = await raceAssistantAbort(tool.execute(call.arguments, signal), signal);
          if (!isCurrent(owner.generation) || batch !== owner) return;
          call.status = 'approved';
          const proposal = tool.extractProposal?.(result);
          if (proposal) proposals.push(proposal);
          record(owner, call, JSON.stringify(result));
        } catch (error) {
          if (!isCurrent(owner.generation) || batch !== owner) return;
          const text = signal?.aborted
            ? 'Tool execution outcome unknown because cancellation interrupted the response'
            : error instanceof Error
              ? error.message
              : String(error);
          failure(owner, call, text);
          if (signal?.aborted) throw error;
        } finally {
          if (owner.executing === call.id) owner.executing = undefined;
        }
      };
      const continueModel = async (
        generation: number,
        signal?: AbortSignal
      ): Promise<AssistantRuntimeResponse> => {
        while (turnRounds < MAX_ASSISTANT_MODEL_CALLS) {
          ensureCurrent(generation);
          throwIfAborted(signal);
          turnRounds += 1;
          const output = await raceAssistantAbort(
            modelCall(definition, structuredClone(history), signal),
            signal
          );
          ensureCurrent(generation);
          throwIfAborted(signal);
          if (output.type === 'assistant_message') {
            const suggestions = mergeAssistantSuggestions(proposals);
            messages.push({
              id: `msg-${randomUUID()}`,
              role: 'assistant',
              text: output.text,
              createdAt: new Date().toISOString(),
              ...(suggestions ? { suggestions } : {})
            });
            history.push({ role: 'assistant', content: output.text });
            proposals.length = 0;
            emit('assistant_message_completed', {
              text: output.text,
              ...(suggestions ? { suggestions } : {})
            });
            return {
              type: 'assistant_message',
              text: output.text,
              ...(suggestions ? { suggestions } : {})
            };
          }
          const usedIds = new Set(pending.map((call) => call.id));
          const calls = output.toolCalls.map((requested) =>
            createPendingToolCall(definition, requested, usedIds)
          );
          pending.push(...calls);
          messages.push({
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
          history.push({
            role: 'assistant',
            content: output.text,
            tool_calls: calls.map((call) => ({
              id: call.id,
              name: call.publicToolName,
              arguments: call.arguments
            }))
          });
          const owner: Batch = { calls, results: new Map(), generation };
          batch = owner;
          if (turnRounds === MAX_ASSISTANT_MODEL_CALLS) {
            terminalCleanup(generation, 'budget', owner);
            break;
          }
          const { oversized, unknown, local, validExternal, needsApproval } = classifyToolCalls(
            definition,
            calls
          );
          if (oversized) {
            calls.forEach((call) => failure(owner, call, OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR));
            finishBatch(owner);
            continue;
          }
          for (const call of unknown)
            failure(owner, call, `Unknown assistant tool '${call.publicToolName}'`);
          for (const call of local) {
            await execute(owner, call, signal);
            ensureCurrent(generation);
            throwIfAborted(signal);
          }
          const awaiting = calls.filter((call) => call.status === 'pending');
          if (awaiting.length)
            emit('tool_call_requested', {
              pendingToolCalls: awaiting,
              pendingToolCallId: awaiting[0]?.id
            });
          if (needsApproval) {
            return {
              type: 'tool_call_request',
              text: output.text,
              pendingToolCalls: awaiting
            };
          }
          for (const call of validExternal) {
            call.status = 'approved';
            emit('tool_call_approved', { pendingToolCallId: call.id });
            await execute(owner, call, signal);
            ensureCurrent(generation);
            throwIfAborted(signal);
          }
          finishBatch(owner);
        }
        ensureCurrent(generation);
        terminalCleanup(generation, 'budget');
        throw new AssistantTurnBudgetExceededError();
      };
      const session: AssistantRuntimeSession = {
        async sendMessage(message, signal) {
          ensureUsable();
          if (batch) {
            const superseded = batch;
            terminalCleanup(turnGeneration, 'superseded', superseded);
          }
          const generation = ++turnGeneration;
          turnRounds = 0;
          proposals.length = 0;
          messages.push({
            id: `msg-${randomUUID()}`,
            role: 'user',
            text: message,
            createdAt: new Date().toISOString()
          });
          history.push({ role: 'user', content: message });
          emit('turn_started');
          try {
            return await continueModel(generation, signal);
          } catch (error) {
            terminalCleanup(generation, signal?.aborted ? 'cancelled' : 'failure', batch, error);
            throw error;
          }
        },
        async resolveToolCalls(decisions: AssistantToolCallDecision[], signal) {
          ensureUsable();
          if (!batch) throw new Error('Tool batch is not pending');
          const owner = batch;
          const generation = owner.generation;
          const validated = validateToolCallDecisions(decisions, pending, owner.calls, (id) =>
            owner.results.has(id)
          );
          try {
            for (const { decision, call } of validated) {
              ensureCurrent(generation);
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
                ensureCurrent(generation);
              }
            }
            throwIfAborted(signal);
            const unresolved = owner.calls.filter((call) => !owner.results.has(call.id));
            if (unresolved.length)
              return { type: 'tool_call_resolved', text: '', pendingToolCalls: unresolved };
            finishBatch(owner);
            return await continueModel(generation, signal);
          } catch (error) {
            terminalCleanup(generation, signal?.aborted ? 'cancelled' : 'failure', owner, error);
            throw error;
          }
        },
        getSnapshot: snapshot,
        async dispose() {
          if (disposed) return;
          terminalCleanup(turnGeneration, 'disposed', batch);
          disposed = true;
          turnGeneration += 1;
        }
      };
      return session;
    }
  };
}
