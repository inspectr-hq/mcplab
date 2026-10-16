import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantSessionApi } from '@/lib/assistant-session-api';
import { ApiError } from '@/lib/data-sources/workspace-api-client';
import type { ResultAssistantSessionView } from '@/lib/data-sources/types';
import { useAssistantSession } from './use-assistant-session';

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

let revision = 0;
function session(overrides: Partial<ResultAssistantSessionView> = {}): ResultAssistantSessionView {
  return {
    revision: revision++,
    id: 'session-1',
    scope: 'all_runs',
    runId: null,
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:00:00.000Z',
    selectedAssistantAgentName: 'assistant',
    model: 'test',
    provider: 'openai',
    messages: [],
    pendingToolCalls: [],
    ...overrides
  };
}

const pendingCall = {
  id: 'call-1',
  server: 's',
  tool: 'write',
  publicToolName: 's__write',
  arguments: { path: 'a.md' },
  status: 'pending' as const,
  createdAt: '2026-10-16T10:00:00.000Z'
};

function makeApi(
  overrides: Partial<AssistantSessionApi<ResultAssistantSessionView>> = {}
): AssistantSessionApi<ResultAssistantSessionView> {
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1', session: session() }),
    sendMessage: vi.fn().mockImplementation(async (_id, _message, _signal, turnId) => ({
      session: session({
        activeTurnId: turnId,
        pendingToolCalls: [pendingCall],
        messages: [{ id: turnId, role: 'user', text: 'write it', createdAt: '' }]
      }),
      response: { type: 'tool_call_request', text: 'Writing', pendingToolCalls: [pendingCall] }
    })),
    approveToolCall: vi.fn().mockImplementation(async () => ({
      session: session({ pendingToolCalls: [{ ...pendingCall, status: 'approved' }] }),
      response: { type: 'assistant_message', text: 'Done' }
    })),
    denyToolCall: vi.fn(),
    cancelTurn: vi.fn().mockResolvedValue({ ok: true }),
    closeSession: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    ...overrides
  };
}

describe('useAssistantSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revision = 0;
  });

  it('offers approve-all only when the assistant supports it', () => {
    const without = renderHook(() =>
      useAssistantSession({ api: makeApi(), open: true, label: 'Test Assistant' })
    );
    expect(without.result.current.approveAll).toBeUndefined();
    const withBatch = renderHook(() =>
      useAssistantSession({
        api: makeApi({ approveAllToolCalls: vi.fn() }),
        open: true,
        label: 'Test Assistant'
      })
    );
    expect(withBatch.result.current.approveAll).toBeTypeOf('function');
  });

  it('creates the session on the first message and passes edited arguments when approving', async () => {
    const api = makeApi();
    const { result } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant' })
    );
    expect(api.createSession).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.send('write it')).toBe('sent');
    });
    expect(api.createSession).toHaveBeenCalledOnce();
    expect(result.current.pendingToolCalls).toMatchObject([{ id: 'call-1', status: 'pending' }]);
    await act(async () => {
      await result.current.approve('call-1', { path: 'edited.md' });
    });
    expect(api.approveToolCall).toHaveBeenCalledWith('session-1', 'call-1', { path: 'edited.md' });
    expect(result.current.pendingToolCalls).toMatchObject([{ id: 'call-1', status: 'approved' }]);
  });

  it('starts automatically when asked to and reports start failures', async () => {
    const api = makeApi({ createSession: vi.fn().mockRejectedValue(new Error('no agent')) });
    renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant', autoStart: true })
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Could not start Test Assistant',
          description: 'no agent'
        })
      )
    );
  });

  it('marks the session expired when a decision finds it gone, then starts fresh', async () => {
    const api = makeApi({
      approveToolCall: vi.fn().mockRejectedValue(new ApiError(404, 'Session not found'))
    });
    const { result } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant' })
    );
    await act(async () => {
      await result.current.send('write it');
    });
    await act(async () => {
      await result.current.approve('call-1');
    });
    expect(result.current.expired).toBe(true);
    expect(result.current.sessionId).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not approve tool call',
        description: expect.stringContaining('expired')
      })
    );
    await act(async () => {
      await result.current.send('again');
    });
    expect(api.createSession).toHaveBeenCalledTimes(2);
    expect(result.current.expired).toBe(false);
  });

  it('cancels a paused turn by the backend turn ID when no request is in flight', async () => {
    const api = makeApi();
    const { result } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant' })
    );
    await act(async () => {
      await result.current.send('write it');
    });
    const turnId = vi.mocked(api.sendMessage).mock.calls[0]?.[3];
    expect(result.current.cancelable).toBe(true);
    let restored: string | undefined;
    act(() => {
      restored = result.current.cancel();
    });
    expect(restored).toBeUndefined();
    expect(api.cancelTurn).toHaveBeenCalledWith('session-1', turnId);
  });

  it('closes the session when unmounted', async () => {
    const api = makeApi();
    const { result, unmount } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant' })
    );
    await act(async () => {
      await result.current.send('write it');
    });
    unmount();
    expect(api.closeSession).toHaveBeenCalledWith('session-1');
  });

  it('closes a session created after a reset instead of adopting it', async () => {
    let finishCreate!: (value: { sessionId: string; session: ResultAssistantSessionView }) => void;
    const api = makeApi({
      createSession: vi.fn(
        () =>
          new Promise<{ sessionId: string; session: ResultAssistantSessionView }>(
            (resolve) => (finishCreate = resolve)
          )
      )
    });
    const { result } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant', autoStart: true })
    );
    await waitFor(() => expect(api.createSession).toHaveBeenCalledOnce());
    act(() => result.current.reset());
    await act(async () => {
      finishCreate({ sessionId: 'late-session', session: session({ id: 'late-session' }) });
    });
    expect(result.current.sessionId).toBeNull();
    expect(result.current.starting).toBe(false);
    expect(api.closeSession).toHaveBeenCalledWith('late-session');
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('closes a session whose creation finishes after unmount', async () => {
    let finishCreate!: (value: { sessionId: string; session: ResultAssistantSessionView }) => void;
    const api = makeApi({
      createSession: vi.fn(
        () =>
          new Promise<{ sessionId: string; session: ResultAssistantSessionView }>(
            (resolve) => (finishCreate = resolve)
          )
      )
    });
    const { unmount } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant', autoStart: true })
    );
    await waitFor(() => expect(api.createSession).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]?.aborted).toBe(false);
    unmount();
    expect(vi.mocked(api.createSession).mock.calls[0]?.[0]?.aborted).toBe(true);
    await act(async () => {
      finishCreate({ sessionId: 'orphan-session', session: session({ id: 'orphan-session' }) });
    });
    expect(api.closeSession).toHaveBeenCalledWith('orphan-session');
  });

  it('keeps creating the session when the first message is cancelled, then reuses it', async () => {
    let finishCreate!: (value: { sessionId: string; session: ResultAssistantSessionView }) => void;
    const api = makeApi({
      createSession: vi.fn(
        () =>
          new Promise<{ sessionId: string; session: ResultAssistantSessionView }>(
            (resolve) => (finishCreate = resolve)
          )
      )
    });
    const { result } = renderHook(() =>
      useAssistantSession({ api, open: true, label: 'Test Assistant' })
    );
    let outcome: Promise<string> | undefined;
    act(() => {
      outcome = result.current.send('first');
    });
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      finishCreate({ sessionId: 'session-1', session: session() });
    });
    await expect(outcome).resolves.toBe('cancelled');
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBe('session-1');
    await act(async () => {
      await result.current.send('second');
    });
    expect(api.createSession).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalledOnce();
  });
});
