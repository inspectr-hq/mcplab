import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useResultAssistant } from './use-result-assistant';
import type { EvalDataSource, ResultAssistantSessionView } from '@/lib/data-sources/types';

const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args)
}));

function makeSession(
  overrides: Partial<ResultAssistantSessionView> = {}
): ResultAssistantSessionView {
  return {
    id: 'ras-1',
    scope: 'run',
    runId: 'run-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    selectedAssistantAgentName: 'assistant-1',
    model: 'gpt-4o-mini',
    provider: 'openai',
    messages: [],
    pendingToolCalls: [],
    ...overrides
  };
}

describe('useResultAssistant SSE updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges live assistant session updates from SSE events', async () => {
    let onResultEvent:
      | ((event: { payload: { session: ResultAssistantSessionView; sessionId: string } }) => void)
      | undefined;
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn().mockResolvedValue({
        session: makeSession({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              text: 'Show the answer one step at a time',
              createdAt: new Date().toISOString()
            }
          ]
        }),
        response: {
          type: 'assistant_message',
          text: 'Thinking...'
        }
      }),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      approveResultAssistantToolCall: vi.fn(),
      denyResultAssistantToolCall: vi.fn(),
      subscribeResultAssistantSessionEvents: vi
        .fn()
        .mockImplementation((_sessionId: string, onEvent: typeof onResultEvent) => {
          onResultEvent = onEvent;
          return () => undefined;
        })
    } as unknown as EvalDataSource;

    const { result } = renderHook(() =>
      useResultAssistant({
        source,
        open: true,
        scope: 'run',
        runId: 'run-1'
      })
    );

    act(() => {
      result.current.setAssistantInput('Show the answer one step at a time');
    });

    await act(async () => {
      await result.current.askAssistant();
    });

    await waitFor(() =>
      expect(source.subscribeResultAssistantSessionEvents).toHaveBeenCalledWith(
        'ras-1',
        expect.any(Function)
      )
    );

    await act(async () => {
      onResultEvent?.({
        type: 'assistant_message_completed',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          session: makeSession({
            messages: [
              {
                id: 'msg-1',
                role: 'user',
                text: 'Show the answer one step at a time',
                createdAt: new Date().toISOString()
              },
              {
                id: 'msg-2',
                role: 'assistant',
                text: 'Live answer from SSE',
                createdAt: new Date().toISOString()
              }
            ]
          })
        }
      });
    });

    expect(result.current.assistantMessages).toHaveLength(2);
    expect(result.current.assistantMessages[1]?.text).toBe('Live answer from SSE');
  });

  it('cancels a pending assistant turn locally and restores the prompt', async () => {
    let capturedSignal: AbortSignal | undefined;
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn().mockImplementation(
        async (_sessionId: string, _message: string, signal?: AbortSignal) => {
          capturedSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          });
        }
      ),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      approveResultAssistantToolCall: vi.fn(),
      denyResultAssistantToolCall: vi.fn(),
      subscribeResultAssistantSessionEvents: vi.fn().mockReturnValue(() => undefined)
    } as unknown as EvalDataSource;

    const { result } = renderHook(() =>
      useResultAssistant({
        source,
        open: true,
        scope: 'run',
        runId: 'run-1'
      })
    );

    act(() => {
      result.current.setAssistantInput('Show me the summary');
    });

    act(() => {
      void result.current.askAssistant();
    });

    await waitFor(() => expect(result.current.assistantLoading).toBe(true));
    expect(result.current.assistantInput).toBe('');
    expect(capturedSignal).toBeDefined();

    act(() => {
      result.current.cancelAssistantTurn();
    });

    await waitFor(() => expect(result.current.assistantLoading).toBe(false));
    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.assistantInput).toBe('Show me the summary');
    expect(mockToast).not.toHaveBeenCalled();
    expect(result.current.assistantMessages).toHaveLength(1);
    expect(result.current.assistantMessages[0]?.text).toBe('Show me the summary');
  });
});
