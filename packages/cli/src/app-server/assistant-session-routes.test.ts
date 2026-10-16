import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { handleAssistantSessionRoutes, type AssistantHttpSession } from './assistant-session-routes.js';

function makeSession() {
  const session: AssistantHttpSession = {
    id: 'assistant-1',
    events: [],
    clients: new Set(),
    runtime: {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        messages: [],
        pendingToolCalls: [
          { id: 'tool-1', status: 'pending', publicToolName: 'write_report' }
        ]
      }),
      isBusy: () => false,
      dispose: vi.fn()
    }
  };
  return session;
}

function makeOptions(action: string, session = makeSession(), approveAll = false) {
  const req = { headers: {} } as any;
  const res = Object.assign(new EventEmitter(), { writableEnded: false }) as any;
  const asJson = vi.fn();
  const options = {
    req,
    res,
    pathname: `/api/assistant/sessions/${session.id}${action}`,
    method: 'POST',
    prefix: '/api/assistant/sessions',
    missingSessionMessage: 'Assistant session not found',
    toolCallNotFoundMessage: 'Assistant tool call not found',
    parseBody: vi.fn().mockResolvedValue({ message: 'hello', argumentsOverride: { path: 'edited' } }),
    asJson,
    sessions: new Map([[session.id, session]]),
    cleanup: vi.fn(),
    touch: vi.fn(),
    view: vi.fn(() => ({ id: session.id })),
    response: vi.fn((response) => response),
    approveAll
  } as any;
  return { options, session, res, asJson };
}

describe.each([
  ['Scenario', true],
  ['Result', false]
])('%s shared assistant session routes', (_kind, supportsApproveAll) => {
  const actions = supportsApproveAll
    ? ['/messages', '/tool-calls/tool-1/approve', '/tool-calls/tool-1/deny', '/tool-calls/approve-all']
    : ['/messages', '/tool-calls/tool-1/approve', '/tool-calls/tool-1/deny'];

  it.each(actions)('aborts %s work when its response closes and disposes the listener', async (action) => {
    const { options, session, res, asJson } = makeOptions(action, makeSession(), supportsApproveAll);
    let signal: AbortSignal | undefined;
    const waitForAbort = (...args: any[]) =>
      new Promise<any>((_resolve, reject) => {
        const passedSignal = args.at(-1) as AbortSignal;
        signal = passedSignal;
        passedSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    if (action === '/messages') session.runtime!.sendMessage = vi.fn(waitForAbort);
    else session.runtime!.resolveToolCalls = vi.fn(waitForAbort);

    const route = handleAssistantSessionRoutes(options);
    await vi.waitFor(() => {
      expect(
        action === '/messages'
          ? session.runtime!.sendMessage
          : session.runtime!.resolveToolCalls
      ).toHaveBeenCalledOnce();
    });
    res.emit('close');
    await expect(route).resolves.toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(asJson).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });

  it('keeps a normal writable-ended close from aborting and removes the listener', async () => {
    const { options, session, res, asJson } = makeOptions('/messages', makeSession(), supportsApproveAll);
    let signal: AbortSignal | undefined;
    asJson.mockImplementation(() => {
      res.writableEnded = true;
      res.emit('close');
    });
    session.runtime!.sendMessage = vi.fn(async (_message: string, passedSignal?: AbortSignal) => {
      signal = passedSignal;
      return { type: 'assistant_message' as const, text: 'done' };
    });
    const route = handleAssistantSessionRoutes(options);
    await expect(route).resolves.toBe(true);
    expect(signal?.aborted).toBe(false);
    expect(asJson).toHaveBeenCalledOnce();
    expect(res.listenerCount('close')).toBe(0);
  });

  it('finishes deletion after a disconnect without writing a response', async () => {
    const { options, session, res, asJson } = makeOptions('', makeSession(), supportsApproveAll);
    options.pathname = `/api/assistant/sessions/${session.id}`;
    options.method = 'DELETE';
    let finishDispose!: () => void;
    session.runtime!.dispose = vi.fn(
      () => new Promise<void>((resolve) => (finishDispose = resolve))
    );
    const route = handleAssistantSessionRoutes(options);
    await vi.waitFor(() => expect(session.runtime!.dispose).toHaveBeenCalledOnce());
    res.emit('close');
    finishDispose();
    await expect(route).resolves.toBe(true);
    expect(options.sessions.has(session.id)).toBe(false);
    expect(asJson).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });

  it.each([
    ['/messages', 'sendMessage'],
    ['/tool-calls/tool-1/approve', 'resolveToolCalls']
  ])('does not execute or write a response for a preclosed writableEnded response on %s', async (action, operation) => {
    const { options, session, res, asJson } = makeOptions(action, makeSession(), supportsApproveAll);
    res.writableEnded = true;
    const handled = await handleAssistantSessionRoutes(options);
    expect(handled).toBe(true);
    expect(session.runtime![operation as 'sendMessage' | 'resolveToolCalls']).not.toHaveBeenCalled();
    expect(asJson).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });

  it.each([
    ['/messages', 'sendMessage'],
    ['/tool-calls/tool-1/approve', 'resolveToolCalls']
  ])('does not execute or write a response for an already destroyed response on %s', async (action, operation) => {
    const { options, session, res, asJson } = makeOptions(action, makeSession(), supportsApproveAll);
    res.destroyed = true;
    const handled = await handleAssistantSessionRoutes(options);
    expect(handled).toBe(true);
    expect(session.runtime![operation as 'sendMessage' | 'resolveToolCalls']).not.toHaveBeenCalled();
    expect(asJson).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });

  it('does not run cleanup for malformed suffixes', async () => {
    const { options } = makeOptions('/messages/extra', makeSession(), supportsApproveAll);
    await expect(handleAssistantSessionRoutes(options)).resolves.toBe(false);
    expect(options.cleanup).not.toHaveBeenCalled();
  });
});
