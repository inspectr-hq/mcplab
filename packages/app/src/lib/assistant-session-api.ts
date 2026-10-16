import type {
  AssistantRuntimeResponse,
  AssistantRuntimeSnapshot,
  AssistantSessionEvent,
  EvalDataSource,
  ResultAssistantSessionView,
  ScenarioAssistantSessionView
} from '@/lib/data-sources/types';

/** What the shared session hook needs from a session view. */
export type AssistantSessionShape = Omit<AssistantRuntimeSnapshot, 'revision'> & {
  id: string;
  revision: number;
};

export interface AssistantTurnResult<TSession> {
  session: TSession;
  response: AssistantRuntimeResponse;
}

/**
 * One assistant's endpoints, as seen by useAssistantSession. Optional members are capabilities:
 * the hook only offers an action when the assistant's backend supports it.
 */
export interface AssistantSessionApi<TSession extends AssistantSessionShape> {
  createSession(signal?: AbortSignal): Promise<{ sessionId: string; session: TSession }>;
  sendMessage(
    sessionId: string,
    message: string,
    signal: AbortSignal,
    turnId: string
  ): Promise<AssistantTurnResult<TSession>>;
  approveToolCall(
    sessionId: string,
    callId: string,
    argumentsOverride?: unknown
  ): Promise<AssistantTurnResult<TSession>>;
  denyToolCall(
    sessionId: string,
    callId: string,
    message?: string
  ): Promise<AssistantTurnResult<TSession>>;
  approveAllToolCalls?(sessionId: string): Promise<AssistantTurnResult<TSession>>;
  cancelTurn?(sessionId: string, turnId: string): Promise<unknown>;
  closeSession(sessionId: string): Promise<void>;
  subscribe(
    sessionId: string,
    onEvent: (event: AssistantSessionEvent<TSession>) => void
  ): () => void;
}

export function createResultAssistantApi(
  source: EvalDataSource,
  target: { scope: 'run'; runId: string } | { scope: 'all_runs' }
): AssistantSessionApi<ResultAssistantSessionView> {
  return {
    createSession: (signal) => source.createResultAssistantSession(target, signal),
    sendMessage: (sessionId, message, signal, turnId) =>
      source.sendResultAssistantMessage(sessionId, message, signal, turnId),
    approveToolCall: (sessionId, callId, argumentsOverride) =>
      source.approveResultAssistantToolCall(sessionId, callId, argumentsOverride),
    denyToolCall: (sessionId, callId, message) =>
      source.denyResultAssistantToolCall(sessionId, callId, message),
    ...(source.cancelResultAssistantTurn
      ? { cancelTurn: (sessionId, turnId) => source.cancelResultAssistantTurn!(sessionId, turnId) }
      : {}),
    closeSession: (sessionId) => source.closeResultAssistantSession(sessionId),
    subscribe: (sessionId, onEvent) =>
      source.subscribeResultAssistantSessionEvents(sessionId, onEvent)
  };
}

export function createScenarioAssistantApi(
  source: EvalDataSource,
  createSession: (signal?: AbortSignal) => Promise<{
    sessionId: string;
    session: ScenarioAssistantSessionView;
  }>
): AssistantSessionApi<ScenarioAssistantSessionView> {
  return {
    createSession,
    sendMessage: (sessionId, message, signal, turnId) =>
      source.sendScenarioAssistantMessage(sessionId, message, signal, turnId),
    approveToolCall: (sessionId, callId, argumentsOverride) =>
      source.approveScenarioAssistantToolCall(sessionId, callId, argumentsOverride),
    denyToolCall: (sessionId, callId, message) =>
      source.denyScenarioAssistantToolCall(sessionId, callId, message),
    approveAllToolCalls: (sessionId) => source.approveAllScenarioAssistantToolCalls(sessionId),
    ...(source.cancelScenarioAssistantTurn
      ? {
          cancelTurn: (sessionId, turnId) => source.cancelScenarioAssistantTurn!(sessionId, turnId)
        }
      : {}),
    closeSession: (sessionId) => source.closeScenarioAssistantSession(sessionId),
    subscribe: (sessionId, onEvent) =>
      source.subscribeScenarioAssistantSessionEvents(sessionId, onEvent)
  };
}
