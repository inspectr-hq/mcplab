import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';
import type { ScenarioAssistantSuggestionBundle } from '@inspectr/mcplab-core';
import { truncateJson } from './assistant-common.js';

export const MAX_EXTERNAL_ASSISTANT_TOOL_CALLS = 3;
export const OVERSIZED_ASSISTANT_TOOL_BATCH_ERROR =
  'Tool batch exceeds the maximum of 3 external calls';
export const MAX_ASSISTANT_MODEL_CALLS = 25;

export class AssistantTurnBudgetExceededError extends Error {
  readonly statusCode = 422;

  constructor() {
    super('Assistant reached its 25 model-call limit. Start a new message to continue.');
    this.name = 'AssistantTurnBudgetExceededError';
  }
}

export function mergeAssistantSuggestions(
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

export class AssistantToolDecisionConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('One or more tool calls are no longer pending');
    this.name = 'AssistantToolDecisionConflictError';
  }
}

export function uniqueToolCallId(requestedId: string | undefined, usedIds: Set<string>): string {
  let id = requestedId?.trim();
  if (!id || usedIds.has(id)) {
    do {
      id = `tool-${randomUUID()}`;
    } while (usedIds.has(id));
  }
  usedIds.add(id);
  return id;
}

export function createPendingToolCall(
  definition: AssistantRuntimeDefinition,
  requested: { id?: string; name: string; arguments?: unknown; validationError?: string },
  usedIds: Set<string>
): AssistantRuntimeToolCall {
  const tool = definition.tools.find((candidate) => candidate.name === requested.name);
  return {
    id: uniqueToolCallId(requested.id, usedIds),
    server: tool?.server ?? 'unknown',
    tool: tool?.tool ?? requested.name,
    publicToolName: requested.name,
    arguments: requested.arguments ?? {},
    ...(requested.validationError ? { validationError: requested.validationError } : {}),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

export function classifyToolCalls(
  definition: AssistantRuntimeDefinition,
  calls: AssistantRuntimeToolCall[]
) {
  const invalid = calls.filter((call) => call.validationError);
  const unknown = calls.filter(
    (call) =>
      !invalid.includes(call) && !definition.tools.some((tool) => tool.name === call.publicToolName)
  );
  const external = calls.filter(
    (call) =>
      !definition.tools.some((tool) => tool.name === call.publicToolName) ||
      definition.approvalPolicy(call.publicToolName) !== 'local'
  );
  const local = calls.filter(
    (call) =>
      definition.approvalPolicy(call.publicToolName) === 'local' &&
      !unknown.includes(call) &&
      !invalid.includes(call)
  );
  const validExternal = external.filter(
    (call) => !unknown.includes(call) && !invalid.includes(call)
  );
  return {
    unknown,
    invalid,
    external,
    oversized: external.length > MAX_EXTERNAL_ASSISTANT_TOOL_CALLS,
    local,
    validExternal,
    needsApproval: validExternal.some(
      (call) => definition.approvalPolicy(call.publicToolName) === 'approval_required'
    )
  };
}

export function validateToolCallDecisions(
  decisions: AssistantToolCallDecision[],
  pending: AssistantRuntimeToolCall[],
  ownerCalls: AssistantRuntimeToolCall[],
  hasResult: (id: string) => boolean
) {
  const seen = new Set<string>();
  return decisions.map((decision) => {
    const call = pending.find((candidate) => candidate.id === decision.toolCallId);
    if (
      (decision.decision !== 'approve' && decision.decision !== 'deny') ||
      seen.has(decision.toolCallId) ||
      !call ||
      !ownerCalls.some((ownerCall) => ownerCall.id === call.id) ||
      call.status !== 'pending' ||
      hasResult(call.id)
    )
      throw new AssistantToolDecisionConflictError();
    seen.add(decision.toolCallId);
    return { decision, call };
  });
}

export function orderedBatchResults(
  calls: AssistantRuntimeToolCall[],
  getResult: (id: string) => string | undefined
): Array<{ call: AssistantRuntimeToolCall; content: string }> | undefined {
  const results = calls.map((call) => ({ call, content: getResult(call.id) }));
  if (results.some((result) => result.content === undefined)) return undefined;
  return results.map(({ call, content }) => ({ call, content: content! }));
}

export function resultPreview(content: string): string {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    value = content;
  }
  return truncateJson(value, 4000);
}

export function terminalToolFeedback(
  reason: 'cancelled' | 'superseded' | 'budget' | 'failure' | 'disposed',
  call: AssistantRuntimeToolCall,
  executingId: string | undefined,
  error?: unknown
): string {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return reason === 'budget'
    ? 'Assistant turn model-call budget exhausted'
    : reason === 'superseded'
      ? call.id === executingId
        ? 'Tool execution outcome unknown because a new user message superseded the turn'
        : 'Tool call skipped because a new user message superseded the turn'
      : reason === 'cancelled' || reason === 'disposed'
        ? call.id === executingId
          ? 'Tool execution outcome unknown because cancellation interrupted the response'
          : 'Tool call cancelled before execution'
        : detail || 'Assistant turn failed before the tool call completed';
}

export function terminalToolStatus(
  reason: 'cancelled' | 'superseded' | 'budget' | 'failure' | 'disposed',
  call: AssistantRuntimeToolCall,
  executingId: string | undefined
): AssistantRuntimeToolCall['status'] {
  return reason === 'superseded' && call.id !== executingId ? 'denied' : 'error';
}

export function raceAssistantAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
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
