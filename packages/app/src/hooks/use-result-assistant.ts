import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/data-sources/workspace-api-client';
import { isAbortError } from '@/lib/abort';
import type {
  EvalDataSource,
  ResultAssistantPendingToolCall,
  ResultAssistantSessionView,
  ResultAssistantTurnResponse
} from '@/lib/data-sources/types';
import {
  assistantMessagesWithStreaming,
  type AssistantStreamingMessage
} from '@/lib/assistant-streaming';
import { useAssistantStream } from '@/hooks/use-assistant-stream';

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
  const [streamingMessage, setStreamingMessage] = useState<AssistantStreamingMessage>();
  const [assistantPendingToolCalls, setAssistantPendingToolCalls] = useState<
    ResultAssistantPendingToolCall[]
  >([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantTurnCancelable, setAssistantTurnCancelable] = useState(false);
  const assistantSessionIdRef = useRef<string | null>(null);
  const latestSessionRef = useRef<ResultAssistantSessionView | null>(null);
  const optimisticMessageIdsRef = useRef(new Set<string>());
  const assistantTurnRef = useRef<{
    id: number;
    controller: AbortController;
    prompt: string;
    clientTurnId: string;
    sessionId?: string;
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

  const onStreamSession = useCallback((session: ResultAssistantSessionView) => {
    latestSessionRef.current = session;
    setAssistantSessionId(session.id);
    assistantSessionIdRef.current = session.id;
    if (assistantTurnRef.current) {
      assistantTurnRef.current.sessionId = session.id;
    }
    const committedIds = new Set(session.messages.map((message) => message.id));
    for (const id of committedIds) optimisticMessageIdsRef.current.delete(id);
    setAssistantMessages((previous) => [
      ...session.messages,
      ...previous.filter(
        (message) =>
          message.id &&
          optimisticMessageIdsRef.current.has(message.id) &&
          !committedIds.has(message.id)
      )
    ]);
    setStreamingMessage(session.streamingMessage ?? undefined);
    setAssistantPendingToolCalls(session.pendingToolCalls);
    setAssistantTurnCancelable(Boolean(session.activeTurnId));
    onSessionSyncRef.current?.(session);
  }, []);

  const subscribeResultEvents = useCallback(
    (
      sessionId: string,
      onEvent: Parameters<EvalDataSource['subscribeResultAssistantSessionEvents']>[1]
    ) => sourceRef.current.subscribeResultAssistantSessionEvents(sessionId, onEvent),
    []
  );
  const cancelRemoteTurn = useCallback(
    (sessionId: string, turnId: string) =>
      sourceRef.current.cancelResultAssistantTurn?.(sessionId, turnId) ??
      Promise.resolve(undefined),
    []
  );
  const { applySnapshot, cancelActiveTurn } = useAssistantStream({
    open,
    sessionId: assistantSessionId,
    sessionRef: latestSessionRef,
    subscribe: subscribeResultEvents,
    onSession: onStreamSession,
    cancelTurn: cancelRemoteTurn
  });

  const abortActiveAssistantTurn = useCallback(() => {
    const activeTurn = assistantTurnRef.current;
    if (!activeTurn) return;
    activeTurn.controller.abort();
    // Don't null assistantTurnRef here, the finally block in askAssistant
    // guards on the turn ID to perform cleanup, and nulling the ref would
    // cause that guard to fail, bypassing setAssistantLoading(false).
  }, []);

  const syncResultAssistantSession = useCallback(
    (session: ResultAssistantSessionView, sessionIdOverride?: string) => {
      applySnapshot(session, sessionIdOverride ?? session.id);
    },
    [applySnapshot]
  );

  const syncAndContinueAssistantTurn = useCallback(
    async (sessionId: string, payload: ResultAssistantTurnPayload) => {
      const activeSessionId = payload.session.id || sessionId;
      if (assistantSessionIdRef.current !== activeSessionId) return;
      syncResultAssistantSession(payload.session, activeSessionId);
    },
    [syncResultAssistantSession]
  );

  const cancelAssistantTurn = useCallback(() => {
    const activeTurn = assistantTurnRef.current;
    const sessionId = activeTurn?.sessionId ?? assistantSessionIdRef.current;
    const backendTurnId = activeTurn?.clientTurnId ?? latestSessionRef.current?.activeTurnId;
    if (!activeTurn && !backendTurnId) return;
    cancelActiveTurn(sessionId, backendTurnId);
    if (activeTurn) {
      abortActiveAssistantTurn();
      setAssistantInput(activeTurn.prompt);
    }
    setAssistantLoading(false);
    setAssistantTurnCancelable(false);
  }, [abortActiveAssistantTurn, cancelActiveTurn]);

  const askAssistant = useCallback(async () => {
    const question = assistantInput.trim();
    if (!question) return;
    if (scope === 'run' && !runId) return;
    const turnId = ++assistantTurnCounterRef.current;
    const controller = new AbortController();
    const clientTurnId = crypto.randomUUID();
    const optimisticMessageId = clientTurnId;
    optimisticMessageIdsRef.current.add(optimisticMessageId);
    const optimisticMessage = {
      id: optimisticMessageId,
      role: 'user' as const,
      text: question,
      createdAt: new Date().toISOString()
    };
    assistantTurnRef.current = {
      id: turnId,
      controller,
      prompt: question,
      clientTurnId,
      sessionId: assistantSessionId ?? undefined
    };
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
          controller.signal,
          clientTurnId
        );
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        await syncAndContinueAssistantTurn(sessionId, response);
      } catch (error: unknown) {
        if (
          isAbortError(error) ||
          controller.signal.aborted ||
          assistantTurnRef.current?.id !== turnId
        )
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
          controller.signal,
          clientTurnId
        );
        if (controller.signal.aborted || assistantTurnRef.current?.id !== turnId) return;
        await syncAndContinueAssistantTurn(recoveredSessionId, retry);
      }
    } catch (error: unknown) {
      if (
        isAbortError(error) ||
        controller.signal.aborted ||
        assistantTurnRef.current?.id !== turnId
      )
        return;
      setAssistantMessages((prev) => prev.filter((m) => m.id !== optimisticMessageId));
      optimisticMessageIdsRef.current.delete(optimisticMessageId);
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
      setAssistantTurnCancelable(Boolean(latestSessionRef.current?.activeTurnId));
      setAssistantLoading(true);
      try {
        const response = await source.approveResultAssistantToolCall(assistantSessionId, callId);
        await syncAndContinueAssistantTurn(assistantSessionId, response);
      } catch (error: unknown) {
        if (assistantSessionIdRef.current !== assistantSessionId) return;
        if (isSessionNotFoundError(error)) {
          setAssistantSessionId(null);
          assistantSessionIdRef.current = null;
          latestSessionRef.current = null;
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
        if (assistantSessionIdRef.current === assistantSessionId) setAssistantLoading(false);
      }
    },
    [assistantSessionId, source, syncAndContinueAssistantTurn]
  );

  const denyResultAssistantToolCall = useCallback(
    async (callId: string) => {
      if (!assistantSessionId) return;
      setAssistantTurnCancelable(Boolean(latestSessionRef.current?.activeTurnId));
      setAssistantLoading(true);
      try {
        const response = await source.denyResultAssistantToolCall(assistantSessionId, callId);
        await syncAndContinueAssistantTurn(assistantSessionId, response);
      } catch (error: unknown) {
        if (assistantSessionIdRef.current !== assistantSessionId) return;
        if (isSessionNotFoundError(error)) {
          setAssistantSessionId(null);
          assistantSessionIdRef.current = null;
          latestSessionRef.current = null;
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
        if (assistantSessionIdRef.current === assistantSessionId) setAssistantLoading(false);
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
    latestSessionRef.current = null;
    optimisticMessageIdsRef.current.clear();
    setAssistantSessionId(null);
    setAssistantMessages([]);
    setStreamingMessage(undefined);
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
  }, [open, assistantMessages.length, streamingMessage?.text, assistantLoading]);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [assistantInput, open]);

  useEffect(() => {
    return () => {
      abortActiveAssistantTurn();
      const sessionId = assistantSessionIdRef.current;
      if (!sessionId) return;
      void sourceRef.current.closeResultAssistantSession(sessionId).catch(() => undefined);
    };
  }, [abortActiveAssistantTurn]);

  const visibleAssistantMessages = useMemo(
    () => assistantMessagesWithStreaming(assistantMessages, streamingMessage),
    [assistantMessages, streamingMessage]
  );

  return {
    assistantSessionId,
    assistantMessages: visibleAssistantMessages,
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
