import { useEffect, useMemo, useRef, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';
import type { QueueResponse } from '@/lib/data-sources/types';

const FALLBACK_POLL_MS = 3000;
const MAX_SSE_RECONNECT_ATTEMPTS = 5;
const SSE_RECONNECT_DELAY_MS = 2000;

function countOAuthBlockedQueued(queue: QueueResponse['queued']): number {
  return queue.filter(
    (entry) => entry.status === 'blocked_auth' && entry.blockedReason === 'oauth_required'
  ).length;
}

export function useRunQueueStatus() {
  const { source } = useDataSource();
  const [queueState, setQueueState] = useState<QueueResponse>({ active: null, queued: [] });
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'connected' | 'connecting' | 'disconnected'>(
    'connecting'
  );
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const pollIntervalRef = useRef<number | null>(null);
  const streamConnectedRef = useRef(false);
  const revisionRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: number | null = null;
    let unsubscribeCurrent: (() => void) | null = null;

    const stopPolling = () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const refreshQueueState = async () => {
      const requestRevision = revisionRef.current;
      try {
        const queue = await source.getRunQueue();
        if (disposed) return;
        if (revisionRef.current !== requestRevision) return;
        setQueueState(queue);
      } catch {
        // ignore transient fetch failures
      }
    };

    const startPolling = () => {
      if (pollIntervalRef.current !== null) return;
      void refreshQueueState();
      pollIntervalRef.current = window.setInterval(() => {
        void refreshQueueState();
      }, FALLBACK_POLL_MS);
    };

    const connectStream = () => {
      if (disposed) return;
      clearReconnectTimer();
      setStreamStatus('connecting');
      unsubscribeCurrent?.();
      unsubscribeCurrent = source.subscribeRunQueue((event) => {
        const queueEvent = event.payload.event;
        if (event.type === 'queue_event' && queueEvent) {
          reconnectAttempts = 0;
          revisionRef.current += 1;
          setStreamConnected(true);
          setStreamStatus('connected');
          streamConnectedRef.current = true;
          stopPolling();
          setQueueState(queueEvent);
          return;
        }
        if (event.type === 'error') {
          setStreamConnected(false);
          streamConnectedRef.current = false;
          startPolling();
          unsubscribeCurrent?.();
          unsubscribeCurrent = null;
          if (reconnectAttempts >= MAX_SSE_RECONNECT_ATTEMPTS) {
            setStreamStatus('disconnected');
            return;
          }
          reconnectAttempts += 1;
          setStreamStatus('connecting');
          reconnectTimer = window.setTimeout(() => {
            connectStream();
          }, SSE_RECONNECT_DELAY_MS);
        }
      });
    };
    connectStream();

    const onFocus = () => {
      if (streamConnectedRef.current) return;
      void refreshQueueState();
    };

    window.addEventListener('focus', onFocus);
    if (!streamConnectedRef.current) {
      void refreshQueueState();
    }

    return () => {
      disposed = true;
      unsubscribeCurrent?.();
      stopPolling();
      clearReconnectTimer();
      window.removeEventListener('focus', onFocus);
    };
  }, [source, reconnectNonce]);

  return useMemo(() => {
    const isRunning = queueState.active !== null;
    const queuedCount = queueState.queued.length;
    const oauthBlockedCount = countOAuthBlockedQueued(queueState.queued);
    return {
      isRunning,
      queuedCount,
      oauthBlockedCount,
      streamConnected,
      streamStatus,
      reconnectStream: () => {
        setStreamConnected(false);
        streamConnectedRef.current = false;
        setStreamStatus('connecting');
        setReconnectNonce((prev) => prev + 1);
      }
    };
  }, [queueState, streamConnected, streamStatus]);
}
