import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeFactory,
  AssistantRuntimeModelOutput,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantRuntimeSnapshot,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision,
  LlmMessage,
  ScenarioAssistantSuggestionBundle,
  ToolDef
} from '@inspectr/mcplab-core';
import { throwIfAborted, truncateJson } from './assistant-common.js';
import { chatWithAgent } from '@inspectr/mcplab-core';

type ModelCall = (
  definition: AssistantRuntimeDefinition,
  messages: LlmMessage[],
  signal?: AbortSignal
) => Promise<AssistantRuntimeModelOutput>;
type Batch = {
  calls: AssistantRuntimeToolCall[];
  results: Map<string, string>;
  executing?: string;
  generation: number;
};

export class AssistantTurnBudgetExceededError extends Error {
  readonly statusCode = 422;

  constructor() {
    super('Assistant reached its 25 model-call limit. Start a new message to continue.');
    this.name = 'AssistantTurnBudgetExceededError';
  }
}

class AssistantToolDecisionConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('One or more tool calls are no longer pending');
    this.name = 'AssistantToolDecisionConflictError';
  }
}

export function createNativeAssistantRuntimeFactory(
  modelCall: ModelCall = async (definition, messages, signal) => {
    const tools = definition.tools.map((tool): ToolDef => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema
    }));
    const response = await chatWithAgent({
      agent: definition.agent,
      messages,
      tools,
      system: definition.getSystemPrompt(),
      signal
    });
    if (response.tool_calls?.length)
      return {
        type: 'tool_call_request',
        text: response.content?.trim() || 'I need a tool to help answer.',
        toolCalls: response.tool_calls.map(({ id, name, arguments: args }) => ({
          id,
          name,
          arguments: args
        }))
      };
    return { type: 'assistant_message', text: response.content?.trim() ?? '' };
  }
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
        call.resultPreview = truncateJson(safeParseJson(content), 4000);
        emit('tool_call_resolved', { pendingToolCallId: call.id, pendingToolCall: call });
      };
      const finishBatch = (owner: Batch) => {
        if (batch !== owner || owner.calls.some((call) => !owner.results.has(call.id)))
          return false;
        for (const call of owner.calls) {
          const content = owner.results.get(call.id)!;
          history.push({ role: 'tool', content, tool_call_id: call.id, name: call.publicToolName });
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
          const detail = error instanceof Error ? error.message : String(error ?? '');
          for (const call of owner.calls) {
            if (owner.results.has(call.id)) continue;
            const message =
              reason === 'budget'
                ? 'Assistant turn model-call budget exhausted'
                : reason === 'superseded'
                  ? 'Tool call skipped because a new user message superseded the turn'
                  : reason === 'cancelled' || reason === 'disposed'
                    ? call.id === owner.executing
                      ? 'Tool execution outcome unknown because cancellation interrupted the response'
                      : 'Tool call cancelled before execution'
                    : detail || 'Assistant turn failed before the tool call completed';
            failure(owner, call, message, reason === 'superseded' ? 'denied' : 'error');
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
          const result = await raceAbort(tool.execute(call.arguments, signal), signal);
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
        while (turnRounds < 25) {
          ensureCurrent(generation);
          throwIfAborted(signal);
          turnRounds += 1;
          const output = await raceAbort(
            modelCall(definition, structuredClone(history), signal),
            signal
          );
          ensureCurrent(generation);
          throwIfAborted(signal);
          if (output.type === 'assistant_message') {
            const suggestions = mergeSuggestions(proposals);
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
          const calls = output.toolCalls.map((requested) => {
            const tool = definition.tools.find((candidate) => candidate.name === requested.name);
            let id = requested.id?.trim();
            if (!id || usedIds.has(id)) {
              do {
                id = `tool-${randomUUID()}`;
              } while (usedIds.has(id));
            }
            usedIds.add(id);
            const call: AssistantRuntimeToolCall = {
              id,
              server: tool?.server ?? 'unknown',
              tool: tool?.tool ?? requested.name,
              publicToolName: requested.name,
              arguments: requested.arguments ?? {},
              status: 'pending',
              createdAt: new Date().toISOString()
            };
            pending.push(call);
            return call;
          });
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
          if (turnRounds === 25) {
            terminalCleanup(generation, 'budget', owner);
            break;
          }
          const external = calls.filter((call) => {
            const registered = definition.tools.some((tool) => tool.name === call.publicToolName);
            return !registered || definition.approvalPolicy(call.publicToolName) !== 'local';
          });
          if (external.length > 3) {
            calls.forEach((call) =>
              failure(owner, call, 'Tool batch exceeds the maximum of 3 external calls')
            );
            finishBatch(owner);
            continue;
          }
          const unknown = calls.filter(
            (call) => !definition.tools.some((tool) => tool.name === call.publicToolName)
          );
          for (const call of unknown)
            failure(owner, call, `Unknown assistant tool '${call.publicToolName}'`);
          const local = calls.filter(
            (call) =>
              definition.approvalPolicy(call.publicToolName) === 'local' && !unknown.includes(call)
          );
          const validExternal = external.filter((call) => !unknown.includes(call));
          const needsApproval = validExternal.some(
            (call) => definition.approvalPolicy(call.publicToolName) === 'approval_required'
          );
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
          const seen = new Set<string>();
          const validated = decisions.map((decision) => {
            const call = pending.find((candidate) => candidate.id === decision.toolCallId);
            if (
              (decision.decision !== 'approve' && decision.decision !== 'deny') ||
              seen.has(decision.toolCallId) ||
              !call ||
              !owner.calls.includes(call) ||
              call.status !== 'pending' ||
              owner.results.has(call.id)
            )
              throw new AssistantToolDecisionConflictError();
            seen.add(decision.toolCallId);
            return { decision, call };
          });
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

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function mergeSuggestions(
  bundles: ScenarioAssistantSuggestionBundle[]
): ScenarioAssistantSuggestionBundle | undefined {
  if (!bundles.length) return undefined;
  const merged: ScenarioAssistantSuggestionBundle = {};
  for (const bundle of bundles) {
    if (bundle.prompt) merged.prompt = bundle.prompt;
    if (bundle.evalRules) merged.evalRules = bundle.evalRules;
    if (bundle.extractRules) merged.extractRules = bundle.extractRules;
    if (bundle.notes?.length) merged.notes = [...(merged.notes ?? []), ...bundle.notes];
  }
  return merged;
}
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error('Request aborted'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () =>
      queueMicrotask(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Request aborted'));
      });
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}
