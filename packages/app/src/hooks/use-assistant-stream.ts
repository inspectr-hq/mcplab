import { useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { AssistantMessageDelta, AssistantStreamingMessage } from '@/lib/assistant-streaming';
import {
  applyAssistantMessageDelta,
  isAssistantMessageDelta,
  shouldUseAssistantSession
} from '@/lib/assistant-streaming';
import type { AssistantRuntimeSnapshot, AssistantSessionEvent } from '@/lib/data-sources/types';

type StreamSession = {
  id: string;
  revision: number;
  messages: AssistantRuntimeSnapshot['messages'];
  activeTurnId?: string;
  streamingMessage?: AssistantStreamingMessage;
};

export function useAssistantStream<TSession extends StreamSession>(params: {
  open: boolean;
  sessionId: string | null | undefined;
  sessionRef: MutableRefObject<TSession | null>;
  subscribe: (
    sessionId: string,
    onEvent: (event: AssistantSessionEvent<TSession>) => void
  ) => () => void;
  onSession: (session: TSession) => void;
  cancelTurn?: (sessionId: string, turnId: string) => Promise<unknown> | undefined;
}) {
  const { open, sessionId, sessionRef, subscribe, onSession, cancelTurn: cancelRequest } = params;

  const applySnapshot = useCallback(
    (session: TSession, expectedSessionId = sessionId) => {
      if (!expectedSessionId || session.id !== expectedSessionId) return false;
      const current = sessionRef.current;
      if (!shouldUseAssistantSession(current, session)) return false;
      sessionRef.current = session;
      onSession(session);
      return true;
    },
    [onSession, sessionId, sessionRef]
  );

  useEffect(() => {
    if (!open || !sessionId || sessionRef.current?.id !== sessionId) return;
    let active = true;
    const unsubscribe =
      subscribe(sessionId, (event) => {
        if (!active || sessionRef.current?.id !== sessionId) return;
        if (isAssistantMessageDelta(event)) {
          const delta = event.payload as AssistantMessageDelta;
          if (delta.sessionId !== sessionId || delta.revision <= sessionRef.current.revision)
            return;
          const current = sessionRef.current;
          if (!current) return;
          const streamingMessage = applyAssistantMessageDelta({
            messages: current.messages,
            activeTurnId: current.activeTurnId,
            streamingMessage: current.streamingMessage,
            delta
          });
          if (streamingMessage === current.streamingMessage) return;
          const next = { ...current, revision: delta.revision, streamingMessage } as TSession;
          sessionRef.current = next;
          onSession(next);
          return;
        }
        const payload = event.payload as { sessionId?: string; session: TSession };
        if (payload.sessionId !== sessionId || payload.session?.id !== sessionId) return;
        applySnapshot(payload.session, sessionId);
      }) ?? (() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySnapshot, onSession, open, sessionId, sessionRef, subscribe]);

  const cancelActiveTurn = useCallback(
    (activeSessionId: string | undefined, turnId: string | undefined) => {
      if (!activeSessionId || !turnId || !cancelRequest) return;
      void cancelRequest(activeSessionId, turnId)?.catch(() => undefined);
    },
    [cancelRequest]
  );

  return { applySnapshot, cancelActiveTurn };
}
