import { useEffect, useMemo, useRef, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';
import type { QueueResponse } from '@/lib/data-sources/types';

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
  const [streamStatus, setStreamStatus] = useState<'connected' | 'connecting' | 'disconnected'>(
    'connecting'
  );
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const streamStatusRef = useRef<'connected' | 'connecting' | 'disconnected'>('connecting');
  const revisionRef = useRef(0);

  useEffect(() => {
    streamStatusRef.current = streamStatus;
  }, [streamStatus]);

  useEffect(() => {
    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: number | null = null;
    let unsubscribeCurrent: (() => void) | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connectStream = () => {
      if (disposed) return;
      clearReconnectTimer();
      setStreamStatus('connecting');
      unsubscribeCurrent?.();
      unsubscribeCurrent = source.subscribeRunQueue((event) => {
        const queueEvent = event.payload.event;
        if (event.type === 'connected') {
          reconnectAttempts = 0;
          setStreamStatus('connected');
          return;
        }
        if (event.type === 'queue_event' && queueEvent) {
          revisionRef.current += 1;
          setStreamStatus('connected');
          setQueueState(queueEvent);
          return;
        }
        if (event.type === 'error') {
          unsubscribeCurrent?.();
          unsubscribeCurrent = null;
          if (reconnectAttempts >= MAX_SSE_RECONNECT_ATTEMPTS) {
            setStreamStatus('disconnected');
            return;
          }
          reconnectAttempts += 1;
          setStreamStatus('connecting');
          const delay = SSE_RECONNECT_DELAY_MS * 2 ** (reconnectAttempts - 1);
          reconnectTimer = window.setTimeout(() => {
            connectStream();
          }, delay);
        }
      });
    };
    connectStream();

    const onFocus = () => {
      if (streamStatusRef.current !== 'connected') {
        connectStream();
      }
    };

    window.addEventListener('focus', onFocus);

    return () => {
      disposed = true;
      unsubscribeCurrent?.();
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
      streamStatus,
      reconnectStream: () => {
        setReconnectNonce((prev) => prev + 1);
      }
    };
  }, [queueState, streamStatus]);
}
