import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvalDataSource, ResultAssistantSessionView } from '@/lib/data-sources/types';
import { createResultAssistantApi } from '@/lib/assistant-session-api';
import { useAssistantSession } from '@/hooks/use-assistant-session';

/** Result Assistant state for the result pages, on top of the shared session hook. */
export function useResultAssistant(params: {
  source: EvalDataSource;
  open: boolean;
  scope: 'run' | 'all_runs';
  runId?: string;
  onSessionSync?: (session: ResultAssistantSessionView) => void;
}) {
  const { source, open, scope, runId, onSessionSync } = params;
  const api = useMemo(
    () =>
      createResultAssistantApi(
        source,
        scope === 'run' && runId ? { scope: 'run', runId } : { scope: 'all_runs' }
      ),
    [source, scope, runId]
  );
  const assistant = useAssistantSession({
    api,
    open,
    label: 'MCP Lab Assistant',
    recreateExpiredOnSend: true,
    onSession: onSessionSync
  });
  const [assistantInput, setAssistantInput] = useState('');
  const [introMessage, setIntroMessage] =
    useState<ResultAssistantSessionView['messages'][number]>();
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);

  const askAssistant = useCallback(async () => {
    const question = assistantInput.trim();
    if (!question || (scope === 'run' && !runId)) return;
    setAssistantInput('');
    await assistant.send(question);
  }, [assistant, assistantInput, scope, runId]);

  const cancelAssistantTurn = useCallback(() => {
    const prompt = assistant.cancel();
    if (prompt !== undefined) setAssistantInput(prompt);
  }, [assistant]);

  const resetAssistantSession = useCallback(() => {
    assistant.reset();
    setAssistantInput('');
    setIntroMessage(undefined);
  }, [assistant]);

  /** Shows a greeting until the conversation has its first message. */
  const ensureIntroMessage = useCallback((text: string) => {
    setIntroMessage(
      (current) =>
        current ?? {
          id: 'result-assistant-intro',
          role: 'assistant',
          text,
          createdAt: new Date().toISOString()
        }
    );
  }, []);

  const applyResultAssistantSnippet = useCallback((snippet: string) => {
    setAssistantInput(snippet);
    requestAnimationFrame(() => assistantInputRef.current?.focus());
  }, []);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [assistantInput, open]);

  const assistantMessages = useMemo(
    () => (assistant.messages.length === 0 && introMessage ? [introMessage] : assistant.messages),
    [assistant.messages, introMessage]
  );

  return {
    assistantSessionId: assistant.sessionId,
    assistantMessages,
    assistantPendingToolCalls: assistant.pendingToolCalls,
    assistantInput,
    assistantLoading: assistant.busy,
    assistantTurnCancelable: assistant.cancelable,
    assistantExpired: assistant.expired,
    cancelAssistantTurn,
    assistantInputRef,
    setAssistantInput,
    askAssistant,
    approveResultAssistantToolCall: assistant.approve,
    denyResultAssistantToolCall: assistant.deny,
    applyResultAssistantSnippet,
    ensureIntroMessage,
    resetAssistantSession
  };
}
