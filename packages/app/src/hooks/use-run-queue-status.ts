import { useEffect, useMemo, useRef, useState } from 'react';
import { useDataSource } from '@/contexts/DataSourceContext';
import type { QueueResponse } from '@/lib/data-sources/types';

const FALLBACK_POLL_MS = 3000;

function countOAuthBlockedQueued(queue: QueueResponse['queued']): number {
  return queue.filter(
    (entry) => entry.status === 'blocked_auth' && entry.blockedReason === 'oauth_required'
  ).length;
}

export function useRunQueueStatus() {
  const { source } = useDataSource();
  const [queueState, setQueueState] = useState<QueueResponse>({ active: null, queued: [] });
  const [streamConnected, setStreamConnected] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const streamConnectedRef = useRef(false);
  const revisionRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const stopPolling = () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
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

    const unsubscribe = source.subscribeRunQueue((event) => {
      const queueEvent = event.payload.event;
      if (event.type === 'queue_event' && queueEvent) {
        revisionRef.current += 1;
        setStreamConnected(true);
        streamConnectedRef.current = true;
        stopPolling();
        setQueueState(queueEvent);
        return;
      }
      if (event.type === 'error') {
        setStreamConnected(false);
        streamConnectedRef.current = false;
        startPolling();
      }
    });

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
      unsubscribe();
      stopPolling();
      window.removeEventListener('focus', onFocus);
    };
  }, [source]);

  return useMemo(() => {
    const isRunning = queueState.active !== null;
    const queuedCount = queueState.queued.length;
    const oauthBlockedCount = countOAuthBlockedQueued(queueState.queued);
    return {
      isRunning,
      queuedCount,
      oauthBlockedCount,
      streamConnected
    };
  }, [queueState, streamConnected]);
}
