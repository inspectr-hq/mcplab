import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { createAbortError, isAbortError } from '@/lib/abort';
import { assistantMessagesWithStreaming } from '@/lib/assistant-streaming';
import { ApiError } from '@/lib/data-sources/workspace-api-client';
import type {
  AssistantSessionApi,
  AssistantSessionShape,
  AssistantTurnResult
} from '@/lib/assistant-session-api';
import { useAssistantStream } from '@/hooks/use-assistant-stream';

export type AssistantSendOutcome = 'sent' | 'cancelled' | 'failed';

type SessionMessage = AssistantSessionShape['messages'][number];

interface LocalTurn {
  localId: number;
  controller: AbortController;
  prompt: string;
  clientTurnId: string;
  sessionId?: string;
}

const isSessionNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const EXPIRED_DESCRIPTION =
  'Assistant session expired. Send a new message to start a fresh session.';

/**
 * Owns one assistant session: creating and closing it, sending turns, tool decisions and
 * cancellation. Live updates (subscriptions, revisions, deltas) are delegated to
 * useAssistantStream; rendering is left to the caller.
 */
export function useAssistantSession<TSession extends AssistantSessionShape>(params: {
  api: AssistantSessionApi<TSession>;
  /** Live updates are only received while open. */
  open: boolean;
  /** Used in user-facing error titles, e.g. "Scenario Assistant error". */
  label: string;
  /** Create the session as soon as the assistant opens instead of on the first message. */
  autoStart?: boolean;
  /** Recreate an expired session and retry once when sending a message. */
  recreateExpiredOnSend?: boolean;
  onSession?: (session: TSession) => void;
}) {
  const { open, label, autoStart = false, recreateExpiredOnSend = false } = params;
  const apiRef = useRef(params.api);
  apiRef.current = params.api;
  const onSessionRef = useRef(params.onSession);
  onSessionRef.current = params.onSession;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<TSession | null>(null);
  const [optimistic, setOptimistic] = useState<SessionMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelable, setCancelable] = useState(false);
  const [expired, setExpired] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<TSession | null>(null);
  const startRef = useRef<Promise<string> | null>(null);
  /**
   * A lifecycle ends on reset or unmount. Session creation belongs to the lifecycle that started
   * it: aborted when that lifecycle ends, and any session it still returns is closed, not adopted.
   */
  const lifecycleRef = useRef(new AbortController());
  const turnRef = useRef<LocalTurn | null>(null);
  const turnCounterRef = useRef(0);

  const onStreamSession = useCallback((next: TSession) => {
    setSession(next);
    const committed = new Set(next.messages.map((message) => message.id));
    setOptimistic((previous) => previous.filter((message) => !committed.has(message.id)));
    setCancelable(Boolean(turnRef.current) || Boolean(next.activeTurnId));
    onSessionRef.current?.(next);
  }, []);
  const subscribe = useCallback<AssistantSessionApi<TSession>['subscribe']>(
    (id, onEvent) => apiRef.current.subscribe(id, onEvent),
    []
  );
  const cancelRemoteTurn = useCallback(
    (id: string, turnId: string) => apiRef.current.cancelTurn?.(id, turnId),
    []
  );
  const { applySnapshot, cancelActiveTurn } = useAssistantStream({
    open,
    sessionId,
    sessionRef,
    subscribe,
    onSession: onStreamSession,
    cancelTurn: cancelRemoteTurn
  });

  const adoptSession = useCallback(
    (id: string, next: TSession) => {
      sessionIdRef.current = id;
      setExpired(false);
      applySnapshot(next, id);
      setSessionId(id);
    },
    [applySnapshot]
  );

  /** Forget the current session locally; the backend session is gone or being replaced. */
  const dropSession = useCallback(() => {
    sessionIdRef.current = null;
    sessionRef.current = null;
    startRef.current = null;
    setSessionId(null);
  }, []);

  const start = useCallback((): Promise<string> => {
    if (sessionIdRef.current) return Promise.resolve(sessionIdRef.current);
    if (startRef.current) return startRef.current;
    const lifecycle = lifecycleRef.current;
    setStarting(true);
    // Creation is shared by every waiter (auto-start and the first message), so it follows the
    // session lifecycle rather than one turn: cancelling a turn does not cancel creation.
    const attempt: Promise<string> = apiRef.current
      .createSession(lifecycle.signal)
      .then(({ sessionId: returnedId, session: created }) => {
        const id = returnedId || created.id;
        if (lifecycle.signal.aborted || startRef.current !== attempt) {
          void apiRef.current.closeSession(id).catch(() => undefined);
          throw createAbortError('Assistant session was reset while it was being created');
        }
        adoptSession(id, created);
        return id;
      })
      .finally(() => {
        if (startRef.current === attempt) setStarting(false);
      });
    startRef.current = attempt;
    attempt.catch(() => {
      if (startRef.current === attempt) startRef.current = null;
    });
    return attempt;
  }, [adoptSession]);

  /** Ends the current lifecycle: pending creation is abandoned and its session closed. */
  const endLifecycle = useCallback(() => {
    lifecycleRef.current.abort();
    lifecycleRef.current = new AbortController();
    startRef.current = null;
    setStarting(false);
  }, []);

  useEffect(() => {
    if (!autoStart || !open || sessionIdRef.current || startRef.current) return;
    start().catch((error: unknown) => {
      if (isAbortError(error)) return;
      toast({
        title: `Could not start ${label}`,
        description: errorText(error),
        variant: 'destructive'
      });
    });
  }, [autoStart, open, label, start, sessionId]);

  const applyTurnResult = useCallback(
    (id: string, result: AssistantTurnResult<TSession>) => {
      if (sessionIdRef.current === id) applySnapshot(result.session, id);
    },
    [applySnapshot]
  );

  const send = useCallback(
    async (text: string): Promise<AssistantSendOutcome> => {
      const prompt = text.trim();
      if (!prompt) return 'failed';
      const turn: LocalTurn = {
        localId: ++turnCounterRef.current,
        controller: new AbortController(),
        prompt,
        clientTurnId: crypto.randomUUID(),
        sessionId: sessionIdRef.current ?? undefined
      };
      const isCurrent = () => turnRef.current === turn && !turn.controller.signal.aborted;
      turnRef.current = turn;
      const userMessage: SessionMessage = {
        id: turn.clientTurnId,
        role: 'user',
        text: prompt,
        createdAt: new Date().toISOString()
      };
      setOptimistic((previous) => [...previous, userMessage]);
      setBusy(true);
      setCancelable(true);
      try {
        let id = await start();
        if (!isCurrent()) return 'cancelled';
        turn.sessionId = id;
        let result: AssistantTurnResult<TSession>;
        try {
          result = await apiRef.current.sendMessage(
            id,
            prompt,
            turn.controller.signal,
            turn.clientTurnId
          );
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return 'cancelled';
          if (!recreateExpiredOnSend || !isSessionNotFound(error)) throw error;
          dropSession();
          id = await start();
          if (!isCurrent()) return 'cancelled';
          turn.sessionId = id;
          result = await apiRef.current.sendMessage(
            id,
            prompt,
            turn.controller.signal,
            turn.clientTurnId
          );
        }
        if (!isCurrent()) return 'cancelled';
        applyTurnResult(id, result);
        return 'sent';
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return 'cancelled';
        setOptimistic((previous) => previous.filter((message) => message.id !== userMessage.id));
        if (isSessionNotFound(error)) setExpired(true);
        toast({
          title: `${label} error`,
          description: isSessionNotFound(error) ? EXPIRED_DESCRIPTION : errorText(error),
          variant: 'destructive'
        });
        return 'failed';
      } finally {
        if (turnRef.current === turn) {
          turnRef.current = null;
          setBusy(false);
          // A turn paused for approval is still active on the backend and can be stopped.
          setCancelable(Boolean(sessionRef.current?.activeTurnId));
        }
      }
    },
    [applyTurnResult, dropSession, label, recreateExpiredOnSend, start]
  );

  /** Stops the running turn. Returns the prompt of a turn sent from here, to restore the input. */
  const cancel = useCallback((): string | undefined => {
    const turn = turnRef.current;
    const id = turn?.sessionId ?? sessionIdRef.current ?? undefined;
    const turnId = turn?.clientTurnId ?? sessionRef.current?.activeTurnId;
    if (!turn && !turnId) return undefined;
    cancelActiveTurn(id, turnId);
    if (turn) {
      turn.controller.abort();
      turnRef.current = null;
    }
    setBusy(false);
    setCancelable(false);
    return turn?.prompt;
  }, [cancelActiveTurn]);

  const decide = useCallback(
    async (
      action: 'approve' | 'deny' | 'approve all',
      call: (id: string) => Promise<AssistantTurnResult<TSession>>
    ) => {
      const id = sessionIdRef.current;
      if (!id) return;
      setBusy(true);
      setCancelable(Boolean(sessionRef.current?.activeTurnId));
      try {
        applyTurnResult(id, await call(id));
      } catch (error) {
        if (sessionIdRef.current !== id) return;
        if (isSessionNotFound(error)) {
          dropSession();
          setExpired(true);
        }
        toast({
          title: `Could not ${action} ${action === 'approve all' ? 'tool calls' : 'tool call'}`,
          description: isSessionNotFound(error) ? EXPIRED_DESCRIPTION : errorText(error),
          variant: 'destructive'
        });
      } finally {
        if (!turnRef.current) {
          setBusy(false);
          setCancelable(Boolean(sessionRef.current?.activeTurnId));
        }
      }
    },
    [applyTurnResult, dropSession]
  );

  const approve = useCallback(
    (callId: string, argumentsOverride?: unknown) =>
      decide('approve', (id) => apiRef.current.approveToolCall(id, callId, argumentsOverride)),
    [decide]
  );
  const deny = useCallback(
    (callId: string) => decide('deny', (id) => apiRef.current.denyToolCall(id, callId)),
    [decide]
  );
  const approveAllCallback = useCallback(
    () =>
      decide('approve all', (id) =>
        apiRef.current.approveAllToolCalls
          ? apiRef.current.approveAllToolCalls(id)
          : Promise.reject(new Error('Approve all is not supported'))
      ),
    [decide]
  );

  /** Ends the session here and on the backend, and clears the conversation. */
  const reset = useCallback(() => {
    endLifecycle();
    turnRef.current?.controller.abort();
    turnRef.current = null;
    const id = sessionIdRef.current;
    if (id) void apiRef.current.closeSession(id).catch(() => undefined);
    dropSession();
    setSession(null);
    setOptimistic([]);
    setBusy(false);
    setCancelable(false);
    setExpired(false);
  }, [dropSession, endLifecycle]);

  useEffect(
    () => () => {
      lifecycleRef.current.abort();
      turnRef.current?.controller.abort();
      const id = sessionIdRef.current;
      if (id) void apiRef.current.closeSession(id).catch(() => undefined);
    },
    []
  );

  const messages = useMemo(() => {
    const committed = session?.messages ?? [];
    const committedIds = new Set(committed.map((message) => message.id));
    return assistantMessagesWithStreaming(
      [...committed, ...optimistic.filter((message) => !committedIds.has(message.id))],
      session?.streamingMessage
    );
  }, [session, optimistic]);

  return {
    sessionId,
    session,
    messages,
    pendingToolCalls: session?.pendingToolCalls ?? [],
    /** A turn or tool decision is in flight. */
    busy,
    starting,
    cancelable,
    expired,
    start,
    send,
    cancel,
    approve,
    deny,
    /** Only present when the assistant's backend supports approving a whole batch. */
    approveAll: params.api.approveAllToolCalls ? approveAllCallback : undefined,
    reset
  };
}
