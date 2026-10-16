import { randomUUID } from 'node:crypto';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import {
  Command,
  MemorySaver,
  type BaseCheckpointSaver,
  type StateSnapshot
} from '@langchain/langgraph';
import {
  createAgent,
  createMiddleware,
  dynamicSystemPromptMiddleware,
  humanInTheLoopMiddleware,
  isToolApprovalInterrupt,
  MiddlewareError,
  modelCallLimitMiddleware,
  toolErrorMiddleware
} from 'langchain';
import {
  isAbortError,
  type AssistantReasoning,
  type AssistantRuntimeEvent,
  type AssistantRuntimeMessage,
  type AssistantRuntimeResponse,
  type AssistantRuntimeSnapshot,
  type AssistantRuntimeToolCall,
  type AssistantToolCallDecision,
  type ScenarioAssistantSuggestionBundle
} from '@inspectr/mcplab-core';
import { createAssistantChatModel, type AssistantChatModelFactory } from './assistant-model.js';
import { withAssistantTracing } from './assistant-tracing.js';
import {
  AssistantToolDecisionConflictError,
  AssistantTurnBudgetExceededError,
  MAX_ASSISTANT_MODEL_CALLS,
  mergeAssistantSuggestions,
  resultPreview,
  uniqueToolCallId,
  validateToolCallDecisions
} from './assistant-runtime-policy.js';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeFactory,
  AssistantRuntimeSession
} from './assistant-runtime-contract.js';

export interface LangChainAssistantRuntimeOptions {
  /** Defaults to MCPlab's provider configuration on LangChain chat models. */
  createChatModel?: AssistantChatModelFactory;
  /** One checkpointer for all sessions, one thread per session. Defaults to in-memory. */
  checkpointer?: BaseCheckpointSaver;
}

/** The slice of the compiled agent the runtime uses; createAgent's generics are not needed here. */
interface AssistantAgent {
  stream(input: unknown, options: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
  getState(config: { configurable: { thread_id: string } }): Promise<StateSnapshot>;
  updateState(
    config: { configurable: { thread_id: string } },
    values: Record<string, unknown>,
    asNode?: string
  ): Promise<unknown>;
}

type SettleReason = 'superseded' | 'cancelled' | 'budget' | 'failure';

interface ActiveTurn {
  id: string;
  proposals: ScenarioAssistantSuggestionBundle[];
  /** Calls the user already decided; LangGraph keeps listing them until the batch settles. */
  decided: Set<string>;
  streaming?: StreamingMessage;
  paused: boolean;
}

interface StreamingMessage {
  id: string;
  text: string;
  createdAt: string;
  reasoning?: StreamingReasoning;
}

interface StreamingReasoning {
  text: string;
  startedAt: number;
  durationMs?: number;
  /** Summary part being streamed; a new part starts a new paragraph. */
  part?: number;
}

const DENIED_REASON = 'User denied tool call';
const MAX_DENY_MESSAGE_CHARS = 2000;
// Each model round and tool batch is a few graph steps; the model-call budget is the real limit.
const GRAPH_RECURSION_LIMIT = MAX_ASSISTANT_MODEL_CALLS * 10;

export function createLangChainAssistantRuntimeFactory(
  options: LangChainAssistantRuntimeOptions = {}
): AssistantRuntimeFactory {
  const checkpointer = options.checkpointer ?? new MemorySaver();
  return {
    async create(definition) {
      const runtime = new LangChainAssistantRuntime(definition, checkpointer);
      await runtime.initialize(options.createChatModel ?? createAssistantChatModel);
      return runtime.session();
    }
  };
}

class LangChainAssistantRuntime {
  private readonly config = { configurable: { thread_id: `assistant-${randomUUID()}` } };
  private agent!: AssistantAgent;
  private readonly calls: AssistantRuntimeToolCall[] = [];
  private readonly validationErrors = new Map<string, string>();
  private readonly executing = new Set<string>();
  /** Calls answered by settling; a late tool completion must not change them again. */
  private readonly settled = new Set<string>();
  private readonly suggestionsByMessageId = new Map<string, ScenarioAssistantSuggestionBundle>();
  private readonly reasoningByMessageId = new Map<string, AssistantReasoning>();
  private readonly createdAt = new Map<string, string>();
  private readonly turnIds = new Set<string>();
  /** Which turn and streamed message each model run started for; late tokens are matched against it. */
  private readonly modelRuns = new Map<string, { turn: ActiveTurn; messageId: string }>();
  private history: BaseMessage[] = [];
  private turn: ActiveTurn | undefined;
  private running: Promise<unknown> | undefined;
  private runController: AbortController | undefined;
  private revision = 0;
  private projection: AssistantRuntimeSnapshot;
  private disposed = false;

  constructor(
    private readonly definition: AssistantRuntimeDefinition,
    private readonly checkpointer: BaseCheckpointSaver
  ) {
    this.projection = {
      revision: 0,
      messages: structuredClone(definition.initialMessages ?? []),
      pendingToolCalls: []
    };
  }

  async initialize(createChatModel: AssistantChatModelFactory) {
    const tokens = new TokenSink(
      (runId) => this.onModelRunStart(runId),
      (token, runId) => this.onToken(token, runId),
      (text, part, runId) => this.onReasoning(text, part, runId)
    );
    const setup = await createChatModel(this.definition, {
      callbacks: [tokens],
      hasStreamedText: () => Boolean(this.turn?.streaming?.text)
    });
    const interruptOn = Object.fromEntries(
      this.definition.tools
        .filter((item) => this.definition.approvalPolicy(item.name) === 'approval_required')
        .map((item) => [
          item.name,
          {
            allowedDecisions: ['approve', 'edit', 'reject'] as Array<'approve' | 'edit' | 'reject'>
          }
        ])
    );
    this.agent = createAgent({
      model: setup.model,
      tools: this.definition.tools.map((item) => this.toLangChainTool(item)),
      middleware: [
        this.turnMiddleware(),
        // Tool failures are feedback for the model, not a failed turn.
        toolErrorMiddleware({
          onError: (error) =>
            isAbortError(error) ? undefined : JSON.stringify({ error: errorText(error) })
        }),
        dynamicSystemPromptMiddleware(() => this.definition.getSystemPrompt()),
        ...setup.middleware,
        humanInTheLoopMiddleware({ interruptMode: 'per_call', interruptOn }),
        modelCallLimitMiddleware({ runLimit: MAX_ASSISTANT_MODEL_CALLS, exitBehavior: 'error' })
      ],
      checkpointer: this.checkpointer,
      name: 'MCPLab Assistant'
    }) as unknown as AssistantAgent;
  }

  session(): AssistantRuntimeSession {
    return {
      sendMessage: (text, signal, turnId) => this.track(this.sendMessage(text, signal, turnId)),
      resolveToolCalls: (decisions, signal) => this.track(this.resolveToolCalls(decisions, signal)),
      getSnapshot: () => structuredClone(this.projection),
      cancel: (turnId) => this.cancel(turnId),
      dispose: () => this.dispose()
    };
  }

  // ---- Session operations (the service serializes them) ----

  private async sendMessage(text: string, signal?: AbortSignal, requestedTurnId?: string) {
    this.assertUsable();
    const turnId = requestedTurnId ?? randomUUID();
    if (this.turnIds.has(turnId))
      throw Object.assign(new Error('Assistant turn ID has already been used'), {
        statusCode: 409
      });
    // A new message replaces a paused batch; earlier interrupted runs may also have left calls open.
    await this.settleOpenToolCalls(this.turn?.paused ? 'superseded' : 'cancelled');
    await this.resetTurnBudget();
    this.turnIds.add(turnId);
    this.createdAt.set(turnId, new Date().toISOString());
    this.turn = { id: turnId, proposals: [], decided: new Set(), paused: false };
    this.publish();
    this.emit('turn_started');
    return this.run({ messages: [new HumanMessage({ id: turnId, content: text })] }, signal);
  }

  private async resolveToolCalls(decisions: AssistantToolCallDecision[], signal?: AbortSignal) {
    this.assertUsable();
    const turn = this.turn;
    if (!turn?.paused) throw new AssistantToolDecisionConflictError();
    const interrupts = await this.pendingInterrupts();
    const pending = this.calls.filter((call) => interrupts.has(call.id));
    const validated = validateToolCallDecisions(decisions, pending);
    // Validate the whole batch before recording any decision, so a rejected request changes nothing.
    if (
      validated.some(
        ({ decision }) =>
          decision.decision === 'approve' &&
          decision.arguments !== undefined &&
          !isRecord(decision.arguments)
      )
    )
      throw Object.assign(new Error('Edited tool arguments must be a JSON object'), {
        statusCode: 400
      });
    if (
      validated.some(
        ({ decision }) =>
          decision.message !== undefined &&
          (decision.decision !== 'deny' ||
            typeof decision.message !== 'string' ||
            decision.message.length > MAX_DENY_MESSAGE_CHARS)
      )
    )
      throw Object.assign(
        new Error(`A deny reason must be text of at most ${MAX_DENY_MESSAGE_CHARS} characters`),
        { statusCode: 400 }
      );
    const resume: Record<string, unknown> = {};
    for (const { decision, call } of validated) {
      turn.decided.add(call.id);
      if (decision.decision === 'deny') {
        const message = decision.message?.trim();
        this.updateCall(call.id, {
          status: 'denied',
          error: DENIED_REASON,
          ...(message ? { denyMessage: message } : {})
        });
        this.emit('tool_call_denied', { pendingToolCallId: call.id });
        resume[interrupts.get(call.id)!] = {
          type: 'reject',
          message: JSON.stringify({
            denied: true,
            reason: DENIED_REASON,
            ...(message ? { message } : {})
          })
        };
      } else {
        const edited = decision.arguments !== undefined;
        this.updateCall(call.id, {
          status: 'approved',
          ...(edited ? { arguments: decision.arguments } : {})
        });
        this.emit('tool_call_approved', { pendingToolCallId: call.id });
        resume[interrupts.get(call.id)!] = edited
          ? { type: 'edit', edited_action: { name: call.publicToolName, args: decision.arguments } }
          : { type: 'approve' };
      }
    }
    turn.paused = false;
    return this.run(new Command({ resume }), signal);
  }

  private async cancel(turnId: string) {
    if (this.disposed || this.turn?.id !== turnId) return;
    if (this.running) {
      // Abort the run directly; it settles its own calls before rejecting.
      this.runController?.abort('cancelled');
      await this.running.catch(() => undefined);
      return;
    }
    if (!this.turn.paused) return;
    await this.settleOpenToolCalls('cancelled');
    this.endTurn();
    this.emit('session_snapshot');
  }

  private async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.runController?.abort('disposed');
    await this.running?.catch(() => undefined);
    await this.checkpointer.deleteThread(this.config.configurable.thread_id);
  }

  // ---- Agent execution ----

  private async run(input: unknown, external?: AbortSignal): Promise<AssistantRuntimeResponse> {
    // The runtime owns the run's signal so disposal can stop it without the service.
    const controller = new AbortController();
    const abort = () => controller.abort(external?.reason);
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    this.runController = controller;
    const signal = controller.signal;
    try {
      await withAssistantTracing(async () => {
        const stream = await this.agent.stream(input, {
          ...this.config,
          signal,
          recursionLimit: GRAPH_RECURSION_LIMIT,
          streamMode: 'values'
        });
        for await (const values of stream) this.onValues(values as { messages: BaseMessage[] });
      });
      if (signal.aborted) throw new Error('Request aborted');
    } catch (error) {
      return this.failTurn(error, signal);
    } finally {
      external?.removeEventListener('abort', abort);
      if (this.runController === controller) this.runController = undefined;
    }
    return this.finishRun();
  }

  private async finishRun(): Promise<AssistantRuntimeResponse> {
    const turn = this.turn!;
    const interrupts = await this.pendingInterrupts();
    if (interrupts.size) {
      const waiting = this.calls.filter((call) => interrupts.has(call.id));
      const firstPause = !turn.paused && turn.decided.size === 0;
      turn.paused = true;
      this.publish();
      if (firstPause)
        this.emit('tool_call_requested', {
          pendingToolCalls: waiting,
          pendingToolCallId: waiting[0]?.id
        });
      return {
        type: firstPause ? 'tool_call_request' : 'tool_call_resolved',
        text: firstPause ? this.lastAssistantText() : '',
        pendingToolCalls: structuredClone(waiting)
      };
    }
    const last = [...this.history].reverse().find((message) => AIMessage.isInstance(message));
    const text = last ? messageText(last) : '';
    const suggestions = mergeAssistantSuggestions(turn.proposals);
    if (last?.id && suggestions) this.suggestionsByMessageId.set(last.id, suggestions);
    this.endTurn();
    this.emit('assistant_message_completed', { text, ...(suggestions ? { suggestions } : {}) });
    return { type: 'assistant_message', text, ...(suggestions ? { suggestions } : {}) };
  }

  private async failTurn(wrapped: unknown, signal?: AbortSignal): Promise<never> {
    const error = unwrapMiddlewareError(wrapped);
    const cancelled = Boolean(signal?.aborted) || isAbortError(error);
    const budget = error instanceof Error && error.name === 'ModelCallLimitMiddlewareError';
    if (this.disposed) throw error;
    try {
      await this.settleOpenToolCalls(
        cancelled ? 'cancelled' : budget ? 'budget' : 'failure',
        error
      );
    } catch {
      // Keep the original failure; the next message settles any remaining calls.
    }
    this.endTurn();
    this.emit('session_snapshot');
    if (budget) throw new AssistantTurnBudgetExceededError();
    throw error;
  }

  /**
   * Gives every unanswered tool call a result so the model history stays valid: calls that
   * finished keep their result, the rest are skipped or cancelled. Pending writes from a
   * partially resumed batch are committed first, so no call is answered twice.
   */
  private async settleOpenToolCalls(reason: SettleReason, error?: unknown) {
    let state = await this.agent.getState(this.config);
    if (state.tasks.length) {
      await this.agent.updateState(this.config, { messages: [] }, 'tools');
      state = await this.agent.getState(this.config);
    }
    const messages = (state.values as { messages?: BaseMessage[] }).messages ?? [];
    const answered = new Set(
      messages.filter((message) => ToolMessage.isInstance(message)).map((m) => m.tool_call_id)
    );
    const open = messages
      .filter((message): message is AIMessage => AIMessage.isInstance(message))
      .flatMap((message) => message.tool_calls ?? [])
      .filter((call) => call.id && !answered.has(call.id));
    if (open.length) {
      const results = open.map((call) => {
        const known = this.calls.find((item) => item.id === call.id);
        // A call that finished before the interruption keeps its real result.
        if (known?.status === 'approved' && known.resultPreview !== undefined)
          return new ToolMessage({
            content: known.resultPreview,
            tool_call_id: call.id!,
            name: call.name
          });
        this.settled.add(call.id!);
        const feedback = settleFeedback(reason, this.executing.has(call.id!), error);
        this.updateCall(call.id!, {
          status: reason === 'superseded' && !this.executing.has(call.id!) ? 'denied' : 'error',
          error: feedback
        });
        return new ToolMessage({
          content: JSON.stringify({ error: feedback }),
          tool_call_id: call.id!,
          name: call.name,
          status: 'error'
        });
      });
      await this.agent.updateState(this.config, { messages: results }, 'tools');
      state = await this.agent.getState(this.config);
    }
    this.executing.clear();
    this.onValues(state.values as { messages: BaseMessage[] });
  }

  /**
   * modelCallLimitMiddleware resets its run counter only when the agent finishes normally; a
   * failed or cancelled run would otherwise carry its count into the next user turn.
   */
  private async resetTurnBudget() {
    const state = await this.agent.getState(this.config);
    if ((state.values as { runModelCallCount?: number }).runModelCallCount)
      await this.agent.updateState(this.config, { runModelCallCount: 0 });
  }

  private async pendingInterrupts(): Promise<Map<string, string>> {
    const state = await this.agent.getState(this.config);
    const pending = new Map<string, string>();
    for (const task of state.tasks) {
      for (const item of task.interrupts) {
        if (!item.id) continue;
        const approval = { id: item.id, value: item.value as unknown };
        if (!isToolApprovalInterrupt(approval)) continue;
        const callId = approval.value!.tool_call_id;
        if (!this.turn?.decided.has(callId)) pending.set(callId, approval.id);
      }
    }
    return pending;
  }

  // ---- Middleware: MCPlab bookkeeping around standard model and tool calls ----

  private turnMiddleware() {
    return createMiddleware({
      name: 'McplabAssistantTurn',
      wrapModelCall: async (request, handler) => {
        const id = `msg-${randomUUID()}`;
        const createdAt = new Date().toISOString();
        if (this.turn) this.turn.streaming = { id, text: '', createdAt };
        this.createdAt.set(id, createdAt);
        const response = await handler(request);
        this.keepReasoning(id);
        return this.normalizeModelResponse(response as AIMessage, id);
      },
      wrapToolCall: async (request, handler) => {
        const call = request.toolCall;
        const callId = call.id ?? '';
        const validationError = this.validationErrors.get(callId);
        if (validationError) {
          this.updateCall(callId, { status: 'error', error: validationError });
          return new ToolMessage({
            content: JSON.stringify({ error: validationError }),
            tool_call_id: callId,
            name: call.name,
            status: 'error'
          });
        }
        const result = await handler(request);
        if (!ToolMessage.isInstance(result)) return result;
        const normalized = withJsonErrorContent(result);
        this.recordToolResult(callId, normalized);
        return normalized;
      }
    });
  }

  private normalizeModelResponse(response: AIMessage, id: string): AIMessage {
    const usedIds = new Set(this.calls.map((call) => call.id));
    const requested = [
      ...(response.tool_calls ?? []).map((call) => ({
        providerId: call.id,
        name: call.name,
        args: isRecord(call.args) ? call.args : {},
        validationError: isRecord(call.args)
          ? undefined
          : `Invalid arguments for tool '${call.name}': expected a JSON object.`
      })),
      ...(response.invalid_tool_calls ?? []).map((call) => ({
        providerId: call.id,
        name: call.name ?? 'unknown',
        args: {},
        validationError: `Invalid arguments for tool '${call.name ?? 'unknown'}': ${
          call.error ?? 'malformed tool arguments'
        }${call.args ? ` (raw: ${call.args})` : ''}`
      }))
    ];
    const toolCalls = requested.map((call) => {
      const callId = uniqueToolCallId(call.providerId, usedIds);
      const known = this.definition.tools.find((item) => item.name === call.name);
      const display = known?.display;
      const argumentLabels = known ? schemaFieldTitles(known.inputSchema) : undefined;
      this.calls.push({
        id: callId,
        server: known?.server ?? 'unknown',
        tool: known?.tool ?? call.name,
        publicToolName: call.name,
        arguments: call.args,
        ...(call.validationError ? { validationError: call.validationError } : {}),
        status: 'pending',
        createdAt: new Date().toISOString(),
        requiresApproval: this.definition.approvalPolicy(call.name) === 'approval_required',
        ...(display?.title ? { title: display.title } : {}),
        ...(display?.description ? { description: display.description } : {}),
        ...(display?.hints ? { hints: display.hints } : {}),
        ...(argumentLabels ? { argumentLabels } : {})
      });
      if (call.validationError) this.validationErrors.set(callId, call.validationError);
      return { id: callId, name: call.name, args: call.args, type: 'tool_call' as const };
    });
    const additionalKwargs = { ...response.additional_kwargs };
    delete additionalKwargs.tool_calls;
    // OpenAI's Responses API replays its raw output, which carries the provider's call IDs.
    const responseMetadata = { ...response.response_metadata };
    if (toolCalls.some((call, index) => call.id !== requested[index]!.providerId))
      delete responseMetadata.output;
    return new AIMessage({
      content: withNormalizedToolUseBlocks(response.content, toolCalls),
      id,
      additional_kwargs: additionalKwargs,
      response_metadata: responseMetadata,
      usage_metadata: response.usage_metadata,
      tool_calls: toolCalls,
      invalid_tool_calls: []
    });
  }

  private toLangChainTool(definitionTool: AssistantRuntimeDefinition['tools'][number]) {
    return tool(
      async (args: unknown, config?: { signal?: AbortSignal; toolCall?: { id?: string } }) => {
        const callId = config?.toolCall?.id;
        const turn = this.turn;
        if (callId) {
          this.executing.add(callId);
          // Approval happens before the tool runs, so this is when execution really starts.
          this.updateCall(callId, { startedAt: new Date().toISOString() });
          if (this.calls.find((call) => call.id === callId)?.status === 'pending') {
            this.updateCall(callId, { status: 'approved' });
            this.emit('tool_call_approved', { pendingToolCallId: callId });
          }
        }
        try {
          const value = await definitionTool.execute(args, config?.signal);
          const proposal = definitionTool.extractProposal?.(value);
          const stillCurrent = turn && this.turn === turn && !(callId && this.settled.has(callId));
          if (proposal && stillCurrent) turn.proposals.push(proposal);
          return resultPreview(JSON.stringify(value));
        } finally {
          if (callId) this.executing.delete(callId);
        }
      },
      {
        name: definitionTool.name,
        description: definitionTool.description ?? '',
        schema: asJsonSchema(definitionTool.inputSchema)
      }
    ) as StructuredToolInterface;
  }

  private recordToolResult(callId: string, result: ToolMessage) {
    const current = this.calls.find((call) => call.id === callId);
    if (!current || this.settled.has(callId) || this.disposed) return;
    const content = messageText(result);
    if (current.startedAt) this.updateCall(callId, { completedAt: new Date().toISOString() });
    if (current.status === 'denied') {
      this.updateCall(callId, { resultPreview: resultPreview(content) });
    } else if (result.status === 'error') {
      this.updateCall(callId, {
        status: 'error',
        error: errorFromContent(content),
        resultPreview: resultPreview(content)
      });
    } else {
      this.updateCall(callId, { status: 'approved', resultPreview: content });
    }
    this.emit('tool_call_resolved', {
      pendingToolCallId: callId,
      pendingToolCall: this.calls.find((call) => call.id === callId)
    });
  }

  // ---- Snapshot projection ----

  private onModelRunStart(runId: string) {
    const streaming = this.turn?.streaming;
    if (this.turn && streaming)
      this.modelRuns.set(runId, { turn: this.turn, messageId: streaming.id });
  }

  private onToken(token: string, runId: string) {
    const origin = this.modelRuns.get(runId);
    const streaming = this.turn?.streaming;
    // A run abandoned by cancellation can keep emitting; only the current turn's message accepts text.
    if (!origin || origin.turn !== this.turn || !streaming || streaming.id !== origin.messageId)
      return;
    if (!token) return;
    const delta = streaming.text ? token : token.trimStart();
    if (!delta) return;
    if (streaming.reasoning && streaming.reasoning.durationMs === undefined)
      streaming.reasoning.durationMs = Date.now() - streaming.reasoning.startedAt;
    const offset = streaming.text.length;
    streaming.text += delta;
    this.publish();
    this.emit('assistant_message_delta', {
      turnId: this.turn!.id,
      messageId: streaming.id,
      offset,
      delta,
      createdAt: streaming.createdAt,
      revision: this.revision
    });
  }

  private onReasoning(text: string, part: number | undefined, runId: string) {
    const origin = this.modelRuns.get(runId);
    const streaming = this.turn?.streaming;
    if (!origin || origin.turn !== this.turn || !streaming || streaming.id !== origin.messageId)
      return;
    const reasoning = (streaming.reasoning ??= { text: '', startedAt: Date.now() });
    const newPart = reasoning.text !== '' && part !== undefined && part !== reasoning.part;
    reasoning.part = part ?? reasoning.part;
    const delta = reasoning.text ? (newPart ? `\n\n${text}` : text) : text.trimStart();
    if (!delta) return;
    const offset = reasoning.text.length;
    reasoning.text += delta;
    this.publish();
    this.emit('assistant_reasoning_delta', {
      turnId: this.turn!.id,
      messageId: streaming.id,
      offset,
      delta,
      createdAt: streaming.createdAt,
      revision: this.revision
    });
  }

  /** Keeps a finished model call's reasoning for its message, once the call has returned. */
  private keepReasoning(messageId: string) {
    const reasoning = this.turn?.streaming?.reasoning;
    if (this.turn?.streaming?.id !== messageId || !reasoning?.text.trim()) return;
    reasoning.durationMs ??= Date.now() - reasoning.startedAt;
    this.reasoningByMessageId.set(messageId, {
      text: reasoning.text.trim(),
      durationMs: reasoning.durationMs
    });
  }

  private onValues(values: { messages?: BaseMessage[] }) {
    // Interrupt chunks carry no state; keep the history from the last full update.
    if (!Array.isArray(values.messages)) return;
    this.history = values.messages;
    const streaming = this.turn?.streaming;
    if (streaming && this.history.some((message) => message.id === streaming.id))
      this.turn!.streaming = undefined;
    this.publish();
  }

  private publish() {
    if (this.disposed) return;
    this.revision += 1;
    const turn = this.turn;
    const active = turn && (this.running || turn.paused);
    const streaming = active ? turn.streaming : undefined;
    this.projection = {
      revision: this.revision,
      messages: [
        ...structuredClone(this.definition.initialMessages ?? []),
        ...this.history.flatMap((message) => this.toUiMessage(message))
      ],
      pendingToolCalls: structuredClone(this.calls),
      ...(active ? { activeTurnId: turn.id } : {}),
      ...(streaming && (streaming.text || streaming.reasoning?.text)
        ? {
            streamingMessage: {
              id: streaming.id,
              turnId: turn!.id,
              text: streaming.text,
              createdAt: streaming.createdAt,
              ...(streaming.reasoning?.text
                ? {
                    reasoning: {
                      text: streaming.reasoning.text,
                      ...(streaming.reasoning.durationMs !== undefined
                        ? { durationMs: streaming.reasoning.durationMs }
                        : {})
                    }
                  }
                : {})
            }
          }
        : {})
    };
  }

  private toUiMessage(message: BaseMessage): AssistantRuntimeMessage[] {
    const id = message.id ?? '';
    const createdAt = this.createdAt.get(id) ?? new Date().toISOString();
    if (HumanMessage.isInstance(message))
      return [{ id, role: 'user', text: messageText(message), createdAt }];
    if (AIMessage.isInstance(message)) {
      const callIds = (message.tool_calls ?? []).map((call) => call.id ?? '');
      const first = this.calls.find((call) => call.id === callIds[0]);
      const suggestions = this.suggestionsByMessageId.get(id);
      const reasoning = this.reasoningByMessageId.get(id);
      if (!callIds.length)
        return [
          {
            id,
            role: 'assistant',
            text: messageText(message),
            createdAt,
            ...(suggestions ? { suggestions } : {}),
            ...(reasoning ? { reasoning } : {})
          }
        ];
      return [
        {
          id,
          role: 'assistant',
          text: messageText(message),
          createdAt,
          ...(reasoning ? { reasoning } : {}),
          pendingToolCallId: callIds[0],
          pendingToolCallIds: callIds,
          toolRequestServer: first?.server,
          toolRequestName: first?.tool,
          toolRequestPublicName: first?.publicToolName
        }
      ];
    }
    if (ToolMessage.isInstance(message)) {
      const call = this.calls.find((item) => item.id === message.tool_call_id);
      const content = messageText(message);
      const toolId = id || `msg-${message.tool_call_id}`;
      if (!this.createdAt.has(toolId)) this.createdAt.set(toolId, new Date().toISOString());
      return [
        {
          id: toolId,
          role: 'tool',
          text:
            call?.error && message.status === 'error'
              ? `Tool error (${call.server}::${call.tool}): ${call.error}`
              : (call?.resultPreview ?? content),
          createdAt: this.createdAt.get(toolId)!
        }
      ];
    }
    return [];
  }

  // ---- Helpers ----

  private track<T>(operation: Promise<T>): Promise<T> {
    const running = operation.finally(() => {
      if (this.running === running) {
        this.running = undefined;
        this.publish();
      }
    });
    this.running = running;
    return running;
  }

  private endTurn() {
    this.modelRuns.clear();
    this.turn = undefined;
    this.publish();
  }

  private lastAssistantText() {
    const last = [...this.history].reverse().find((message) => AIMessage.isInstance(message));
    return last ? messageText(last) : '';
  }

  private updateCall(id: string, update: Partial<AssistantRuntimeToolCall>) {
    const index = this.calls.findIndex((call) => call.id === id);
    if (index < 0) return;
    this.calls[index] = { ...this.calls[index]!, ...update };
    this.publish();
  }

  private emit(type: AssistantRuntimeEvent['type'], payload: Record<string, unknown> = {}) {
    if (this.disposed) return;
    try {
      this.definition.onEvent?.({
        type,
        ts: new Date().toISOString(),
        payload: structuredClone(payload)
      });
    } catch {
      // Observers (SSE broadcast) must not break the conversation.
    }
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Assistant session is disposed');
  }
}

/** Receives model tokens in order; attached to each model so a token is delivered once. */
class TokenSink extends BaseCallbackHandler {
  name = 'mcplab_assistant_tokens';
  awaitHandlers = true;
  lc_prefer_streaming = true;

  constructor(
    private readonly onStart: (runId: string) => void,
    private readonly onToken: (token: string, runId: string) => void,
    private readonly onReasoning: (text: string, part: number | undefined, runId: string) => void
  ) {
    super();
  }

  handleChatModelStart(_llm: unknown, _messages: unknown, runId: string) {
    this.onStart(runId);
  }

  handleLLMNewToken(
    token: string,
    _index: unknown,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    fields?: { chunk?: unknown }
  ) {
    // Reasoning arrives as standard content blocks next to (empty) answer text.
    for (const block of reasoningBlocks(fields?.chunk))
      this.onReasoning(block.text, block.part, runId);
    this.onToken(token, runId);
  }
}

function reasoningBlocks(chunk: unknown): Array<{ text: string; part?: number }> {
  const content =
    isRecord(chunk) && isRecord(chunk.message) ? (chunk.message.content as unknown) : undefined;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    isRecord(block) && block.type === 'reasoning' && typeof block.reasoning === 'string'
      ? [
          {
            text: block.reasoning,
            ...(typeof block.index === 'number' ? { part: block.index } : {})
          }
        ]
      : []
  );
}

/** Readable labels for argument fields, where the input schema gives property titles. */
function schemaFieldTitles(schema: unknown): Record<string, string> | undefined {
  const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
  const titles = Object.entries(properties).flatMap(([key, property]) =>
    isRecord(property) && typeof property.title === 'string' && property.title.trim()
      ? [[key, property.title.trim()] as const]
      : []
  );
  return titles.length ? Object.fromEntries(titles) : undefined;
}

/** LangChain wraps errors raised in middleware; callers need the original (status codes, categories). */
function unwrapMiddlewareError(error: unknown): unknown {
  let current = error;
  while (current instanceof MiddlewareError && current.cause !== undefined) current = current.cause;
  return current;
}

/** Error results always reach the model as {"error": ...}, whichever layer produced them. */
function withJsonErrorContent(result: ToolMessage): ToolMessage {
  if (result.status !== 'error') return result;
  const text = messageText(result);
  try {
    if (isRecord(JSON.parse(text))) return result;
  } catch {
    // Plain-text error from LangChain's tool node.
  }
  return new ToolMessage({
    content: JSON.stringify({ error: text }),
    tool_call_id: result.tool_call_id,
    name: result.name,
    status: 'error',
    ...(result.id ? { id: result.id } : {})
  });
}

function errorFromContent(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed) && typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON; use the text as-is.
  }
  return content;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settleFeedback(reason: SettleReason, wasExecuting: boolean, error?: unknown): string {
  if (reason === 'budget') return 'Assistant turn model-call budget exhausted';
  if (reason === 'superseded')
    return wasExecuting
      ? 'Tool execution outcome unknown because a new user message superseded the turn'
      : 'Tool call skipped because a new user message superseded the turn';
  if (reason === 'cancelled')
    return wasExecuting
      ? 'Tool execution outcome unknown because cancellation interrupted the response'
      : 'Tool call cancelled before execution';
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return detail || 'Assistant turn failed before the tool call completed';
}

/** Anthropic replays tool_use content blocks, so their IDs must match the normalized calls. */
function withNormalizedToolUseBlocks(
  content: AIMessage['content'],
  calls: Array<{ id: string; args: Record<string, unknown> }>
): AIMessage['content'] {
  if (!Array.isArray(content)) return content;
  let index = 0;
  return content.map((block) => {
    if (!isRecord(block) || block.type !== 'tool_use') return block;
    const call = calls[index++];
    return call ? ({ ...block, id: call.id, input: call.args } as typeof block) : block;
  });
}

function messageText(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('')
    .trim();
}

function asJsonSchema(schema: unknown): Record<string, unknown> {
  if (isRecord(schema)) return { ...schema, type: schema.type ?? 'object' };
  return { type: 'object', properties: {}, additionalProperties: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
