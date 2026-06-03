import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRunQueueStatus } from './use-run-queue-status';

const sourceRef = {
  current: {
    subscribeRunQueue: (_onEvent: (event: any) => void) => () => undefined
  }
};

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: sourceRef.current
  })
}));

describe('useRunQueueStatus', () => {
  it('tolerates queue_event payloads from older servers without active_jobs', async () => {
    let emit: ((event: any) => void) | null = null;
    sourceRef.current = {
      subscribeRunQueue: (onEvent: (event: any) => void) => {
        emit = onEvent;
        return () => undefined;
      }
    };

    const { result } = renderHook(() => useRunQueueStatus());

    act(() => {
      emit?.({
        type: 'queue_event',
        ts: new Date().toISOString(),
        payload: {
          event: {
            active: null,
            admitting_jobs: [],
            queued: []
          }
        }
      });
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });
    expect(result.current.queuedCount).toBe(0);
  });

  it('reconstructs active_jobs from legacy active payloads', async () => {
    let emit: ((event: any) => void) | null = null;
    sourceRef.current = {
      subscribeRunQueue: (onEvent: (event: any) => void) => {
        emit = onEvent;
        return () => undefined;
      }
    };

    const { result } = renderHook(() => useRunQueueStatus());

    act(() => {
      emit?.({
        type: 'queue_event',
        ts: new Date().toISOString(),
        payload: {
          event: {
            active: {
              jobId: 'job-1',
              status: 'running',
              runParams: {
                configPath: '/tmp/eval.yaml',
                runsPerScenario: 1,
                scenarioIds: null,
                agents: null,
                runNote: null,
                serverOverrideAll: null,
                scenarioServerOverrides: null
              }
            },
            admitting_jobs: [],
            queued: []
          }
        }
      });
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(true);
    });
  });

  it('treats admitting jobs as in-flight work', async () => {
    let emit: ((event: any) => void) | null = null;
    sourceRef.current = {
      subscribeRunQueue: (onEvent: (event: any) => void) => {
        emit = onEvent;
        return () => undefined;
      }
    };

    const { result } = renderHook(() => useRunQueueStatus());

    act(() => {
      emit?.({
        type: 'queue_event',
        ts: new Date().toISOString(),
        payload: {
          event: {
            active: null,
            active_jobs: [],
            admitting_jobs: [
              {
                jobId: 'job-2',
                status: 'blocked_auth',
                requiredServers: ['oauth-server'],
                runParams: {
                  configPath: '/tmp/eval.yaml',
                  runsPerScenario: 1,
                  scenarioIds: null,
                  agents: null,
                  runNote: null,
                  serverOverrideAll: null,
                  scenarioServerOverrides: null
                }
              }
            ],
            queued: []
          }
        }
      });
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(true);
      expect(result.current.queuedCount).toBe(0);
    });
  });
});
