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
    revision: 0,
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

  it('keeps action callbacks stable across re-renders so effects do not loop', () => {
    const source = {} as unknown as EvalDataSource;
    const { result, rerender } = renderHook(() =>
      useResultAssistant({ source, open: false, scope: 'run', runId: 'run-1' })
    );
    const first = result.current;
    rerender();
    expect(result.current.resetAssistantSession).toBe(first.resetAssistantSession);
    expect(result.current.cancelAssistantTurn).toBe(first.cancelAssistantTurn);
  });

  it('merges live assistant session updates from SSE events', async () => {
    let onResultEvent:
      | ((event: {
          type: string;
          ts: string;
          payload: { session: ResultAssistantSessionView; sessionId: string };
        }) => void)
      | undefined;
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi
        .fn()
        .mockImplementation(
          async (
            _sessionId: string,
            _message: string,
            _signal: AbortSignal | undefined,
            turnId: string
          ) => ({
            session: makeSession({
              revision: 1,
              messages: [
                {
                  id: turnId,
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
          })
        ),
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
            revision: 2,
            messages: [
              {
                id: vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3],
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
    act(() => result.current.resetAssistantSession());
    act(() => {
      onResultEvent?.({
        type: 'session_snapshot',
        ts: new Date().toISOString(),
        payload: { sessionId: 'ras-1', session: makeSession({ revision: 2 }) }
      });
    });
    expect(result.current.assistantSessionId).toBeNull();
    expect(result.current.assistantMessages).toEqual([]);
  });

  it('renders ordered deltas once and accepts the reconnect snapshot as authoritative', async () => {
    let onResultEvent: ((event: unknown) => void) | undefined;
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn().mockResolvedValue({
        session: makeSession({ revision: 1, activeTurnId: 'turn-1' }),
        response: { type: 'assistant_message', text: 'partial' }
      }),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      subscribeResultAssistantSessionEvents: vi.fn(
        (_sessionId: string, callback: typeof onResultEvent) => {
          onResultEvent = callback;
          return () => undefined;
        }
      )
    } as unknown as EvalDataSource;
    const { result } = renderHook(() =>
      useResultAssistant({ source, open: true, scope: 'run', runId: 'run-1' })
    );

    act(() => result.current.setAssistantInput('Explain'));
    await act(async () => result.current.askAssistant());

    const delta = (offset: number, text: string) => ({
      type: 'assistant_message_delta',
      ts: new Date().toISOString(),
      payload: {
        sessionId: 'ras-1',
        turnId: 'turn-1',
        messageId: 'reply-1',
        revision: offset === 0 && text === 'Hello' ? 2 : offset === 0 ? 2 : 3,
        offset,
        delta: text,
        createdAt: '2026-10-16T10:00:00.000Z'
      }
    });
    act(() => onResultEvent?.(delta(0, 'Hello')));
    act(() => onResultEvent?.(delta(0, 'Hello')));
    act(() => onResultEvent?.(delta(5, ' there')));
    expect(result.current.assistantMessages.at(-1)?.text).toBe('Hello there');

    act(() =>
      onResultEvent?.({
        ...delta(20, ' missed '),
        payload: { ...delta(20, ' missed ').payload, revision: 4 }
      })
    );
    act(() =>
      onResultEvent?.({
        type: 'session_snapshot',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          session: makeSession({
            revision: 4,
            activeTurnId: 'turn-1',
            messages: [
              {
                id: vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3],
                role: 'user',
                text: 'Explain',
                createdAt: '2026-10-16T10:00:00.000Z'
              }
            ],
            streamingMessage: {
              id: 'reply-1',
              turnId: 'turn-1',
              text: 'Recovered after gap',
              createdAt: '2026-10-16T10:00:00.000Z'
            }
          })
        }
      })
    );
    expect(result.current.assistantMessages.at(-1)?.text).toBe('Recovered after gap');

    act(() =>
      onResultEvent?.({
        type: 'session_snapshot',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          session: makeSession({
            revision: 5,
            updatedAt: '2026-10-16T10:01:00.000Z',
            messages: [
              {
                id: vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3],
                role: 'user',
                text: 'Explain',
                createdAt: '2026-10-16T10:00:00.000Z'
              },
              {
                id: 'reply-2',
                role: 'assistant',
                text: 'Reconnected answer',
                createdAt: '2026-10-16T10:01:00.000Z'
              }
            ]
          })
        }
      })
    );
    expect(result.current.assistantMessages.map((message) => message.text)).toEqual([
      'Explain',
      'Reconnected answer'
    ]);
    act(() =>
      onResultEvent?.({
        type: 'session_snapshot',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          session: makeSession({
            revision: 4,
            messages: [
              {
                id: 'stale-answer',
                role: 'assistant',
                text: 'Stale answer',
                createdAt: '2026-10-16T10:02:00.000Z'
              }
            ]
          })
        }
      })
    );
    expect(result.current.assistantMessages.map((message) => message.text)).toEqual([
      'Explain',
      'Reconnected answer'
    ]);
  });

  it('cancels a pending assistant turn locally and restores the prompt', async () => {
    let capturedSignal: AbortSignal | undefined;
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession({ activeTurnId: 'turn-1' })
      }),
      sendResultAssistantMessage: vi
        .fn()
        .mockImplementation(async (_sessionId: string, _message: string, signal?: AbortSignal) => {
          capturedSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          });
        }),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      getResultAssistantSession: vi.fn(),
      cancelResultAssistantTurn: vi.fn().mockResolvedValue({ ok: true }),
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
    expect(source.cancelResultAssistantTurn).toHaveBeenCalledWith(
      'ras-1',
      vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3]
    );
    expect(source.getResultAssistantSession).not.toHaveBeenCalled();
    expect(result.current.assistantInput).toBe('Show me the summary');
    expect(mockToast).not.toHaveBeenCalled();
    expect(result.current.assistantMessages).toHaveLength(1);
    expect(result.current.assistantMessages[0]?.text).toBe('Show me the summary');
  });

  it('cancels by client turn ID before the first stream event without a session lookup', async () => {
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn().mockImplementation(
        (_sessionId: string, _message: string, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          })
      ),
      getResultAssistantSession: vi.fn(),
      cancelResultAssistantTurn: vi.fn().mockResolvedValue({ ok: true }),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      subscribeResultAssistantSessionEvents: vi.fn().mockReturnValue(() => undefined)
    } as unknown as EvalDataSource;
    const { result } = renderHook(() =>
      useResultAssistant({ source, open: true, scope: 'run', runId: 'run-1' })
    );

    act(() => result.current.setAssistantInput('first turn'));
    act(() => void result.current.askAssistant());
    await waitFor(() => expect(source.sendResultAssistantMessage).toHaveBeenCalledTimes(1));
    act(() => result.current.cancelAssistantTurn());
    await waitFor(() => expect(result.current.assistantLoading).toBe(false));
    expect(source.cancelResultAssistantTurn).toHaveBeenCalledWith(
      'ras-1',
      vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3]
    );
    expect(source.getResultAssistantSession).not.toHaveBeenCalled();
  });

  it('keeps identical prompts as separate messages by client turn ID', async () => {
    let revision = 0;
    const turnIds: string[] = [];
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn(
        async (
          _sessionId: string,
          message: string,
          _signal: AbortSignal | undefined,
          turnId: string
        ) => {
          turnIds.push(turnId);
          const nextRevision = revision + 1;
          const messages = [
            ...(revision > 0
              ? [
                  {
                    id: turnIds[0]!,
                    role: 'user' as const,
                    text: message,
                    createdAt: '2026-10-16T10:00:00.000Z'
                  }
                ]
              : []),
            {
              id: turnId,
              role: 'user' as const,
              text: message,
              createdAt: '2026-10-16T10:00:00.000Z'
            }
          ];
          revision = nextRevision;
          return {
            session: makeSession({ revision: nextRevision, messages }),
            response: { type: 'assistant_message' as const, text: 'Done' }
          };
        }
      ),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      subscribeResultAssistantSessionEvents: vi.fn().mockReturnValue(() => undefined)
    } as unknown as EvalDataSource;
    const { result } = renderHook(() =>
      useResultAssistant({ source, open: true, scope: 'run', runId: 'run-1' })
    );

    act(() => result.current.setAssistantInput('Same prompt'));
    await act(async () => result.current.askAssistant());
    act(() => result.current.setAssistantInput('Same prompt'));
    await act(async () => result.current.askAssistant());

    const firstId = vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3];
    const secondId = vi.mocked(source.sendResultAssistantMessage).mock.calls[1]?.[3];
    expect(firstId).not.toBe(secondId);
    expect(result.current.assistantMessages.map((message) => message.id)).toEqual([
      firstId,
      secondId
    ]);
    expect(result.current.assistantMessages.map((message) => message.text)).toEqual([
      'Same prompt',
      'Same prompt'
    ]);
  });

  it('ignores an older turn event after a newer client turn starts', async () => {
    let onEvent: ((event: unknown) => void) | undefined;
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn(
        (_sessionId: string, _message: string, signal: AbortSignal | undefined) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          })
      ),
      cancelResultAssistantTurn: vi.fn().mockResolvedValue({ ok: true }),
      getResultAssistantSession: vi.fn(),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      subscribeResultAssistantSessionEvents: vi.fn(
        (_sessionId: string, callback: typeof onEvent) => {
          onEvent = callback;
          return () => undefined;
        }
      )
    } as unknown as EvalDataSource;
    const { result } = renderHook(() =>
      useResultAssistant({ source, open: true, scope: 'run', runId: 'run-1' })
    );

    act(() => result.current.setAssistantInput('first'));
    act(() => void result.current.askAssistant());
    await waitFor(() => expect(source.sendResultAssistantMessage).toHaveBeenCalledTimes(1));
    const firstTurnId = vi.mocked(source.sendResultAssistantMessage).mock.calls[0]?.[3];
    act(() => result.current.cancelAssistantTurn());
    await waitFor(() => expect(result.current.assistantLoading).toBe(false));

    act(() => result.current.setAssistantInput('second'));
    act(() => void result.current.askAssistant());
    await waitFor(() => expect(source.sendResultAssistantMessage).toHaveBeenCalledTimes(2));
    const secondTurnId = vi.mocked(source.sendResultAssistantMessage).mock.calls[1]?.[3];
    act(() =>
      onEvent?.({
        type: 'turn_started',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          session: makeSession({ revision: 2, activeTurnId: secondTurnId })
        }
      })
    );
    act(() =>
      onEvent?.({
        type: 'assistant_message_delta',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          turnId: firstTurnId,
          messageId: 'old-reply',
          revision: 1,
          offset: 0,
          delta: 'Old response',
          createdAt: new Date().toISOString()
        }
      })
    );
    act(() =>
      onEvent?.({
        type: 'assistant_message_delta',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'ras-1',
          turnId: secondTurnId,
          messageId: 'new-reply',
          revision: 3,
          offset: 0,
          delta: 'New response',
          createdAt: new Date().toISOString()
        }
      })
    );

    expect(result.current.assistantMessages.at(-1)?.text).toBe('New response');
    expect(
      result.current.assistantMessages.some((message) => message.text === 'Old response')
    ).toBe(false);
    expect(source.cancelResultAssistantTurn).toHaveBeenCalledWith('ras-1', firstTurnId);
    expect(source.getResultAssistantSession).not.toHaveBeenCalled();
  });

  it('shows the terminal model-call budget error to the user', async () => {
    const error = Object.assign(
      new Error('Assistant reached its 25 model-call limit. Start a new message to continue.'),
      { statusCode: 422 }
    );
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'ras-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: vi.fn().mockRejectedValue(error),
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      approveResultAssistantToolCall: vi.fn(),
      denyResultAssistantToolCall: vi.fn(),
      subscribeResultAssistantSessionEvents: vi.fn().mockReturnValue(() => undefined)
    } as unknown as EvalDataSource;
    const { result } = renderHook(() =>
      useResultAssistant({ source, open: true, scope: 'run', runId: 'run-1' })
    );
    act(() => result.current.setAssistantInput('Continue this task'));
    await act(async () => {
      await result.current.askAssistant();
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'MCP Lab Assistant error',
        description: error.message,
        variant: 'destructive'
      })
    );
  });
});
