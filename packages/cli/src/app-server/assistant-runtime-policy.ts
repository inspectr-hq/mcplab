import { randomUUID } from 'node:crypto';
import type {
  AssistantRuntimeToolCall,
  AssistantToolCallDecision,
  ScenarioAssistantSuggestionBundle
} from '@inspectr/mcplab-core';
import { truncateJson } from './assistant-common.js';

export const MAX_ASSISTANT_MODEL_CALLS = 25;

/** How tool approval works, as the model should understand it. */
export const APPROVAL_GUIDANCE =
  'Read-only tools run immediately. Tools that can change something wait for the user to approve, edit or deny each call; a denied call returns a denial you should respect.';

export class AssistantTurnBudgetExceededError extends Error {
  readonly statusCode = 422;

  constructor() {
    super('Assistant reached its 25 model-call limit. Start a new message to continue.');
    this.name = 'AssistantTurnBudgetExceededError';
  }
}

export class AssistantToolDecisionConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('One or more tool calls are no longer pending');
    this.name = 'AssistantToolDecisionConflictError';
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

/** Validates a whole decision batch before anything runs; any stale or repeated call is a 409. */
export function validateToolCallDecisions(
  decisions: AssistantToolCallDecision[],
  pending: AssistantRuntimeToolCall[]
) {
  const seen = new Set<string>();
  return decisions.map((decision) => {
    const call = pending.find((candidate) => candidate.id === decision.toolCallId);
    if (
      (decision.decision !== 'approve' && decision.decision !== 'deny') ||
      seen.has(decision.toolCallId) ||
      !call ||
      call.status !== 'pending'
    )
      throw new AssistantToolDecisionConflictError();
    seen.add(decision.toolCallId);
    return { decision, call };
  });
}

/** Tool results reach the model, and the UI, as at most 4,000 characters. */
export function resultPreview(content: string): string {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    value = content;
  }
  return truncateJson(value, 4000);
}
