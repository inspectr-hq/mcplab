import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { EvalDataSource, ResultAssistantPendingToolCall, ResultAssistantSessionView, ResultAssistantTurnResponse } from "@/lib/data-sources/types";

type ResultAssistantTurnPayload = {
  session: ResultAssistantSessionView;
  response: ResultAssistantTurnResponse;
};

function isSessionNotFoundError(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return text.includes("404") && text.includes("session not found");
}

export function useResultAssistant(params: {
  source: EvalDataSource;
  open: boolean;
  scope: "run" | "all_runs";
  runId?: string;
  onSessionSync?: (session: ResultAssistantSessionView) => void;
}) {
  const { source, open, scope, runId, onSessionSync } = params;
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<ResultAssistantSessionView["messages"]>(
    []
  );
  const [assistantPendingToolCalls, setAssistantPendingToolCalls] = useState<
    ResultAssistantPendingToolCall[]
  >([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const assistantSessionIdRef = useRef<string | null>(null);
  const assistantChatEndRef = useRef<HTMLDivElement | null>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    assistantSessionIdRef.current = assistantSessionId;
  }, [assistantSessionId]);

  const syncResultAssistantSession = useCallback(
    (session: ResultAssistantSessionView, sessionIdOverride?: string) => {
      setAssistantSessionId(sessionIdOverride ?? session.id);
      setAssistantMessages(session.messages);
      setAssistantPendingToolCalls(session.pendingToolCalls);
      onSessionSync?.(session);
    },
    [onSessionSync]
  );

  const syncAndContinueAssistantTurn = useCallback(
    async (sessionId: string, payload: ResultAssistantTurnPayload) => {
      let current = payload;
      let activeSessionId = current.session.id || sessionId;
      syncResultAssistantSession(current.session);
      for (let i = 0; i < 25 && current.response.autoContinue; i += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        try {
          current = await source.continueResultAssistantSession(activeSessionId);
        } catch (error: unknown) {
          if (isSessionNotFoundError(error)) {
            // Session may expire server-side between turns; stop auto-continue quietly.
            setAssistantSessionId(null);
            setAssistantPendingToolCalls([]);
            return;
          }
          throw error;
        }
        activeSessionId = current.session.id || activeSessionId;
        syncResultAssistantSession(current.session);
      }
    },
    [source, syncResultAssistantSession]
  );

  const askAssistant = useCallback(async () => {
    const question = assistantInput.trim();
    if (!question) return;
    if (scope === "run" && !runId) return;
    const optimisticMessageId = `msg-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage = {
      id: optimisticMessageId,
      role: "user" as const,
      text: question,
      createdAt: new Date().toISOString()
    };
    setAssistantInput("");
    setAssistantMessages((prev) => [...prev, optimisticMessage]);
    setAssistantLoading(true);
    try {
      let sessionId = assistantSessionId;
      if (!sessionId) {
        const created =
          scope === "run" && runId
            ? await source.createResultAssistantSession({ runId, scope: "run" })
            : await source.createResultAssistantSession({ scope: "all_runs" });
        sessionId = created.sessionId || created.session.id;
        syncResultAssistantSession(created.session, sessionId);
        setAssistantMessages((prev) => {
          const optimisticStillPresent = prev.some((m) => m.id === optimisticMessageId);
          if (!optimisticStillPresent) return created.session.messages;
          return [...created.session.messages, optimisticMessage];
        });
      }
      try {
        const response = await source.sendResultAssistantMessage(sessionId, question);
        await syncAndContinueAssistantTurn(sessionId, response);
      } catch (error: unknown) {
        if (!isSessionNotFoundError(error)) throw error;
        const recreated =
          scope === "run" && runId
            ? await source.createResultAssistantSession({ runId, scope: "run" })
            : await source.createResultAssistantSession({ scope: "all_runs" });
        const recoveredSessionId = recreated.sessionId || recreated.session.id;
        syncResultAssistantSession(recreated.session, recoveredSessionId);
        setAssistantMessages((prev) => {
          const optimisticStillPresent = prev.some((m) => m.id === optimisticMessageId);
          if (!optimisticStillPresent) return recreated.session.messages;
          return [...recreated.session.messages, optimisticMessage];
        });
        const retry = await source.sendResultAssistantMessage(recoveredSessionId, question);
        await syncAndContinueAssistantTurn(recoveredSessionId, retry);
      }
    } catch (error: unknown) {
      setAssistantMessages((prev) => prev.filter((m) => m.id !== optimisticMessageId));
      toast({
        title: "MCP Lab Assistant error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
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
          title: "Could not approve assistant action",
          description: isSessionNotFoundError(error)
            ? "Assistant session expired. Ask a new question to start a fresh session."
            : error instanceof Error
              ? error.message
              : String(error),
          variant: "destructive"
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
          title: "Could not deny assistant action",
          description: isSessionNotFoundError(error)
            ? "Assistant session expired. Ask a new question to start a fresh session."
            : error instanceof Error
              ? error.message
              : String(error),
          variant: "destructive"
        });
      } finally {
        setAssistantLoading(false);
      }
    },
    [assistantSessionId, source, syncAndContinueAssistantTurn]
  );

  const resetAssistantSession = useCallback(() => {
    const previousSessionId = assistantSessionIdRef.current;
    if (previousSessionId) {
      void source.closeResultAssistantSession(previousSessionId).catch(() => undefined);
    }
    assistantSessionIdRef.current = null;
    setAssistantSessionId(null);
    setAssistantMessages([]);
    setAssistantPendingToolCalls([]);
    setAssistantInput("");
  }, [source]);

  const ensureIntroMessage = useCallback((text: string) => {
    setAssistantMessages((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: `msg-${Date.now()}`,
          role: "assistant",
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
      assistantChatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, assistantMessages.length, assistantLoading]);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [assistantInput, open]);

  useEffect(() => {
    return () => {
      if (!assistantSessionId) return;
      void source.closeResultAssistantSession(assistantSessionId).catch(() => undefined);
    };
  }, [assistantSessionId, source]);

  return {
    assistantSessionId,
    assistantMessages,
    assistantPendingToolCalls,
    assistantInput,
    assistantLoading,
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
