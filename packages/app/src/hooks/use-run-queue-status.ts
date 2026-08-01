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

function normalizeQueueState(value: Partial<QueueResponse> | undefined): QueueResponse {
  const active = value?.active ?? null;
  const activeJobs = Array.isArray(value?.active_jobs) ? value.active_jobs : active ? [active] : [];
  const admittingJobs = Array.isArray(value?.admitting_jobs) ? value.admitting_jobs : [];
  const queued = Array.isArray(value?.queued) ? value.queued : [];
  return {
    active,
    active_jobs: activeJobs,
    admitting_jobs: admittingJobs,
    queued
  };
}

export function useRunQueueStatus() {
  const { source } = useDataSource();
  const [queueState, setQueueState] = useState<QueueResponse>({
    active: null,
    active_jobs: [],
    admitting_jobs: [],
    queued: []
  });
  const [streamStatus, setStreamStatus] = useState<'connected' | 'connecting' | 'disconnected'>(
    'connecting'
  );
  const [completionVersion, setCompletionVersion] = useState(0);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const streamStatusRef = useRef<'connected' | 'connecting' | 'disconnected'>('connecting');
  const revisionRef = useRef(0);
  const inFlightJobIdsRef = useRef<Set<string>>(new Set());

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
      streamStatusRef.current = 'connecting';
      unsubscribeCurrent?.();
      unsubscribeCurrent = source.subscribeRunQueue((event) => {
        const queueEvent = event.payload.event as QueueResponse | undefined;
        if (event.type === 'connected') {
          reconnectAttempts = 0;
          setStreamStatus('connected');
          streamStatusRef.current = 'connected';
          return;
        }
        if (event.type === 'queue_event' && queueEvent) {
          revisionRef.current += 1;
          const nextQueueState = normalizeQueueState(queueEvent);
          const currentJobIds = new Set([
            ...nextQueueState.active_jobs,
            ...nextQueueState.admitting_jobs,
            ...nextQueueState.queued
          ].map((job) => job.jobId));
          const completedCount = [...inFlightJobIdsRef.current].filter(
            (jobId) => !currentJobIds.has(jobId)
          ).length;
          if (completedCount > 0) {
            setCompletionVersion((previous) => previous + completedCount);
          }
          inFlightJobIdsRef.current = new Set([
            ...nextQueueState.active_jobs,
            ...nextQueueState.admitting_jobs
          ].map((job) => job.jobId));
          setStreamStatus('connected');
          streamStatusRef.current = 'connected';
          setQueueState(nextQueueState);
          return;
        }
        if (event.type === 'error') {
          unsubscribeCurrent?.();
          unsubscribeCurrent = null;
          if (reconnectAttempts >= MAX_SSE_RECONNECT_ATTEMPTS) {
            setStreamStatus('disconnected');
            streamStatusRef.current = 'disconnected';
            return;
          }
          reconnectAttempts += 1;
          setStreamStatus('connecting');
          streamStatusRef.current = 'connecting';
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
    const isRunning = queueState.active_jobs.length > 0 || queueState.admitting_jobs.length > 0;
    const runningCount = queueState.active_jobs.length + queueState.admitting_jobs.length;
    const queuedCount = queueState.queued.length;
    const oauthBlockedCount = countOAuthBlockedQueued(queueState.queued);
    return {
      isRunning,
      runningCount,
      completionVersion,
      queuedCount,
      oauthBlockedCount,
      streamStatus,
      reconnectStream: () => {
        setReconnectNonce((prev) => prev + 1);
      }
    };
  }, [queueState, streamStatus]);
}
