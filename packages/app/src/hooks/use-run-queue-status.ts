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
  const [snapshot, setSnapshot] = useState<QueueResponse>({ active: null, queued: [] });
  const [streamConnected, setStreamConnected] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const streamConnectedRef = useRef(false);
  const snapshotRevisionRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const stopPolling = () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    const refreshSnapshot = async () => {
      const requestRevision = snapshotRevisionRef.current;
      try {
        const queue = await source.getRunQueue();
        if (disposed) return;
        if (snapshotRevisionRef.current !== requestRevision) return;
        setSnapshot(queue);
      } catch {
        // ignore transient fetch failures
      }
    };

    const startPolling = () => {
      if (pollIntervalRef.current !== null) return;
      void refreshSnapshot();
      pollIntervalRef.current = window.setInterval(() => {
        void refreshSnapshot();
      }, FALLBACK_POLL_MS);
    };

    const unsubscribe = source.subscribeRunQueue((event) => {
      if (event.type === 'queue_snapshot' && event.payload.snapshot) {
        snapshotRevisionRef.current += 1;
        setStreamConnected(true);
        streamConnectedRef.current = true;
        stopPolling();
        setSnapshot(event.payload.snapshot);
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
      void refreshSnapshot();
    };

    window.addEventListener('focus', onFocus);
    if (!streamConnectedRef.current) {
      void refreshSnapshot();
    }

    return () => {
      disposed = true;
      unsubscribe();
      stopPolling();
      window.removeEventListener('focus', onFocus);
    };
  }, [source]);

  return useMemo(() => {
    const isRunning = snapshot.active !== null;
    const queuedCount = snapshot.queued.length;
    const oauthBlockedCount = countOAuthBlockedQueued(snapshot.queued);
    return {
      isRunning,
      queuedCount,
      oauthBlockedCount,
      streamConnected
    };
  }, [snapshot, streamConnected]);
}
