import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/data-sources/workspace-api-client';
import { isAbortError } from '@/lib/abort';
import type {
  EvalDataSource,
  ResultAssistantPendingToolCall,
  ResultAssistantSessionView,
  ResultAssistantTurnResponse
} from '@/lib/data-sources/types';

type ResultAssistantTurnPayload = {
  session: ResultAssistantSessionView;
  response: ResultAssistantTurnResponse;
};

function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useResultAssistant(params: {
  source: EvalDataSource;
  open: boolean;
  scope: 'run' | 'all_runs';
  runId?: string;
  onSessionSync?: (session: ResultAssistantSessionView) => void;
}) {
  const { source, open, scope, runId, onSessionSync } = params;
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<
    ResultAssistantSessionView['messages']
  >([]);
  const [assistantPendingToolCalls, setAssistantPendingToolCalls] = useState<
    ResultAssistantPendingToolCall[]
  >([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantTurnCancelable, setAssistantTurnCancelable] = useState(false);
  const assistantSessionIdRef = useRef<string | null>(null);
  const assistantTurnRef = useRef<{
    id: number;
    controller: AbortController;
    prompt: string;
  } | null>(null);
  const assistantTurnCounterRef = useRef(0);
  const sourceRef = useRef(source);
  const onSessionSyncRef = useRef(onSessionSync);
  const assistantChatEndRef = useRef<HTMLDivElement | null>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    assistantSessionIdRef.current = assistantSessionId;
  }, [assistantSessionId]);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    onSessionSyncRef.current = onSessionSync;
  }, [onSessionSync]);

  const abortActiveAssistantTurn = useCallback(() => {
    const activeTurn = assistantTurnRef.current;
    if (!activeTurn) return;
    activeTurn.controller.abort();
    // Don't null assistantTurnRef here — the finally block in askAssistant
    // guards on the turn ID to perform cleanup, and nulling the ref would
    // cause that guard to fail, bypassing setAssistantLoading(false).
  }, []);

  const syncResultAssistantSession = useCallback(
    (session: ResultAssistantSessionView, sessionIdOverride?: string) => {
      setAssistantSessionId(sessionIdOverride ?? session.id);
      setAssistantMessages((prev) => {
        if (prev.length > session.messages.length) return prev;
        return session.messages;
      });
      setAssistantPendingToolCalls(session.pendingToolCalls);
      onSessionSyncRef.current?.(session);
    },
    []
  );

  const syncAndContinueAssistantTurn = useCallback(
    async (sessionId: string, payload: ResultAssistantTurnPayload) => {
      const activeSessionId = payload.session.id || sessionId;
      syncResultAssistantSession(payload.session, activeSessionId);
    },
    [syncResultAssistantSession]
  );

  const cancelAssistantTurn = useCallback(() => {
    const activeTurn = assistantTurnRef.current;
    if (!activeTurn) return;
    abortActiveAssistantTurn();
    setAssistantInput(activeTurn.prompt);
    setAssistantLoading(false);
    setAssistantTurnCancelable(false);
  }, [abortActiveAssistantTurn]);

  const askAssistant = useCallback(async () => {
    const question = assistantInput.trim();
    if (!question) return;
    if (scope === 'run' && !runId) return;
    const turnId = ++assistantTurnCounterRef.current;
    const controller = new AbortController();
    const optimisticMessageId = `msg-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage = {
      id: optimisticMessageId,
      role: 'user' as const,
      text: question,
      createdAt: new Date().toISOString()
    };
    assistantTurnRef.current = { id: turnId, controller, prompt: question };
    setAssistantTurnCancelable(true);
    setAssistantInput('');
    setAssistantMessages((prev) => [...prev, optimisticMessage]);
    setAssistantLoading(true);
    try {
      let sessionId = assistantSessionId;
      if (!sessionId) {
        const created =
          scope === 'run' && runId
            ? await source.createResultAssistantSession({ runId, scope: 'run' }, controller.signal)
            : await source.createResultAssistantSession({ scope: 'all_runs' }, controller.signal);
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        sessionId = created.sessionId || created.session.id;
        syncResultAssistantSession(created.session, sessionId);
        setAssistantMessages((prev) => {
          const optimisticStillPresent = prev.some((m) => m.id === optimisticMessageId);
          if (!optimisticStillPresent) return created.session.messages;
          return [...created.session.messages, optimisticMessage];
        });
      }
      try {
        const response = await source.sendResultAssistantMessage(
          sessionId,
          question,
          controller.signal
        );
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        await syncAndContinueAssistantTurn(sessionId, response);
      } catch (error: unknown) {
        if (isAbortError(error) || controller.signal.aborted || assistantTurnRef.current?.id !== turnId)
          return;
        if (!isSessionNotFoundError(error)) throw error;
        const recreated =
          scope === 'run' && runId
            ? await source.createResultAssistantSession({ runId, scope: 'run' }, controller.signal)
            : await source.createResultAssistantSession({ scope: 'all_runs' }, controller.signal);
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        const recoveredSessionId = recreated.sessionId || recreated.session.id;
        syncResultAssistantSession(recreated.session, recoveredSessionId);
        setAssistantMessages((prev) => {
          const optimisticStillPresent = prev.some((m) => m.id === optimisticMessageId);
          if (!optimisticStillPresent) return recreated.session.messages;
          return [...recreated.session.messages, optimisticMessage];
        });
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        const retry = await source.sendResultAssistantMessage(
          recoveredSessionId,
          question,
          controller.signal
        );
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        await syncAndContinueAssistantTurn(recoveredSessionId, retry);
      }
    } catch (error: unknown) {
      if (isAbortError(error) || controller.signal.aborted || assistantTurnRef.current?.id !== turnId)
        return;
      setAssistantMessages((prev) => prev.filter((m) => m.id !== optimisticMessageId));
      toast({
        title: 'MCP Lab Assistant error',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      if (assistantTurnRef.current?.id === turnId) {
        assistantTurnRef.current = null;
        setAssistantLoading(false);
        setAssistantTurnCancelable(false);
      }
    }
  }, [
    assistantInput,
    scope,
    runId,
    assistantSessionId,
    source,
    syncResultAssistantSession,
    syncAndContinueAssistantTurn
  ]);

  const approveResultAssistantToolCall = useCallback(
    async (callId: string) => {
      if (!assistantSessionId) return;
      setAssistantTurnCancelable(false);
      setAssistantLoading(true);
      try {
        const response = await source.approveResultAssistantToolCall(assistantSessionId, callId);
        await syncAndContinueAssistantTurn(assistantSessionId, response);
      } catch (error: unknown) {
        if (isSessionNotFoundError(error)) {
          setAssistantSessionId(null);
          setAssistantPendingToolCalls([]);
        }
        toast({
          title: 'Could not approve assistant action',
          description: isSessionNotFoundError(error)
            ? 'Assistant session expired. Ask a new question to start a fresh session.'
            : error instanceof Error
            ? error.message
            : String(error),
          variant: 'destructive'
        });
      } finally {
        setAssistantLoading(false);
      }
    },
    [assistantSessionId, source, syncAndContinueAssistantTurn]
  );

  const denyResultAssistantToolCall = useCallback(
    async (callId: string) => {
      if (!assistantSessionId) return;
      setAssistantTurnCancelable(false);
      setAssistantLoading(true);
      try {
        const response = await source.denyResultAssistantToolCall(assistantSessionId, callId);
        await syncAndContinueAssistantTurn(assistantSessionId, response);
      } catch (error: unknown) {
        if (isSessionNotFoundError(error)) {
          setAssistantSessionId(null);
          setAssistantPendingToolCalls([]);
        }
        toast({
          title: 'Could not deny assistant action',
          description: isSessionNotFoundError(error)
            ? 'Assistant session expired. Ask a new question to start a fresh session.'
            : error instanceof Error
            ? error.message
            : String(error),
          variant: 'destructive'
        });
      } finally {
        setAssistantLoading(false);
      }
    },
    [assistantSessionId, source, syncAndContinueAssistantTurn]
  );

  const resetAssistantSession = useCallback(() => {
    abortActiveAssistantTurn();
    const previousSessionId = assistantSessionIdRef.current;
    if (previousSessionId) {
      void source.closeResultAssistantSession(previousSessionId).catch(() => undefined);
    }
    assistantSessionIdRef.current = null;
    setAssistantSessionId(null);
    setAssistantMessages([]);
    setAssistantPendingToolCalls([]);
    setAssistantInput('');
    setAssistantTurnCancelable(false);
  }, [abortActiveAssistantTurn, source]);

  const ensureIntroMessage = useCallback((text: string) => {
    setAssistantMessages((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          text,
          createdAt: new Date().toISOString()
        }
      ];
    });
  }, []);

  const applyResultAssistantSnippet = useCallback((snippet: string) => {
    setAssistantInput(snippet);
    requestAnimationFrame(() => assistantInputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      assistantChatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, assistantMessages.length, assistantLoading]);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [assistantInput, open]);

  useEffect(() => {
    if (!open || !assistantSessionId) return;
    return sourceRef.current.subscribeResultAssistantSessionEvents(assistantSessionId, (event) => {
      syncResultAssistantSession(event.payload.session, event.payload.sessionId);
    });
  }, [open, assistantSessionId, syncResultAssistantSession]);

  useEffect(() => {
    return () => {
      abortActiveAssistantTurn();
      const sessionId = assistantSessionIdRef.current;
      if (!sessionId) return;
      void sourceRef.current.closeResultAssistantSession(sessionId).catch(() => undefined);
    };
  }, [abortActiveAssistantTurn]);

  return {
    assistantSessionId,
    assistantMessages,
    assistantPendingToolCalls,
    assistantInput,
    assistantLoading,
    assistantTurnCancelable,
    cancelAssistantTurn,
    assistantChatEndRef,
    assistantInputRef,
    setAssistantInput,
    setAssistantMessages,
    askAssistant,
    approveResultAssistantToolCall,
    denyResultAssistantToolCall,
    applyResultAssistantSnippet,
    ensureIntroMessage,
    resetAssistantSession
  };
}
