import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  handleAssistantSessionRoutes,
  type AssistantHttpSession
} from './assistant-session-routes.js';
import { createStatefulAssistantRuntimeHarness } from '../../test-support/stateful-assistant-runtime.js';
import type { AssistantRuntimeDefinition } from './assistant-runtime-contract.js';

function makeRuntimeDefinition(
  assistant: AssistantRuntimeDefinition['assistant'] = 'scenario'
): AssistantRuntimeDefinition {
  const context =
    assistant === 'scenario'
      ? {
          scenario: {
            id: 'scenario-1',
            prompt: 'test prompt',
            serverNames: [],
            evalRules: [],
            extractRules: []
          }
        }
      : {
          scope: 'all_runs' as const,
          runId: null,
          resultSummary: null,
          referenceReportsForRun: []
        };
  return {
    assistant,
    agent: { provider: 'openai', model: 'gpt-4o-mini' },
    context,
    getSystemPrompt: () => 'test system prompt',
    tools: [],
    approvalPolicy: () => 'approval_required'
  };
}

function makeSession() {
  const session: AssistantHttpSession = {
    id: 'assistant-1',

    clients: new Set(),
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'done' }),
      resolveToolCalls: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'done' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn().mockReturnValue({
        messages: [],
        pendingToolCalls: [{ id: 'tool-1', status: 'pending', publicToolName: 'write_report' }]
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
    assistantLabel: 'Assistant',
    parseBody: vi
      .fn()
      .mockResolvedValue({ message: 'hello', argumentsOverride: { path: 'edited' } }),
    asJson,
    sessions: new Map([[session.id, session]]),
    cleanup: vi.fn(),
    touch: vi.fn(),
    view: vi.fn(() => ({ id: session.id })),
    approveAll
  } as any;
  return { options, session, res, asJson };
}

describe.each([
  ['Scenario', true],
  ['Result', false]
])('%s shared assistant session routes', (_kind, supportsApproveAll) => {
  const actions = supportsApproveAll
    ? [
        '/messages',
        '/tool-calls/tool-1/approve',
        '/tool-calls/tool-1/deny',
        '/tool-calls/approve-all'
      ]
    : ['/messages', '/tool-calls/tool-1/approve', '/tool-calls/tool-1/deny'];

  it.each(actions)(
    'aborts %s work when its response closes and disposes the listener',
    async (action) => {
      const { options, session, res, asJson } = makeOptions(
        action,
        makeSession(),
        supportsApproveAll
      );
      let signal: AbortSignal | undefined;
      const waitForAbort = (...args: any[]) =>
        new Promise<any>((_resolve, reject) => {
          const passedSignal = args.at(-1) as AbortSignal;
          signal = passedSignal;
          passedSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          });
        });
      if (action === '/messages') session.runtime.sendMessage = vi.fn(waitForAbort);
      else session.runtime.resolveToolCalls = vi.fn(waitForAbort);

      const route = handleAssistantSessionRoutes(options);
      await vi.waitFor(() => {
        expect(
          action === '/messages' ? session.runtime.sendMessage : session.runtime.resolveToolCalls
        ).toHaveBeenCalledOnce();
      });
      res.emit('close');
      await expect(route).resolves.toBe(true);
      expect(signal?.aborted).toBe(true);
      expect(asJson).not.toHaveBeenCalled();
      expect(res.listenerCount('close')).toBe(0);
    }
  );

  it('keeps a normal writable-ended close from aborting and removes the listener', async () => {
    const { options, session, res, asJson } = makeOptions(
      '/messages',
      makeSession(),
      supportsApproveAll
    );
    let signal: AbortSignal | undefined;
    asJson.mockImplementation(() => {
      res.writableEnded = true;
      res.emit('close');
    });
    session.runtime.sendMessage = vi.fn(async (_message: string, passedSignal?: AbortSignal) => {
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
    session.runtime.dispose = vi.fn(
      () => new Promise<void>((resolve) => (finishDispose = resolve))
    );
    const route = handleAssistantSessionRoutes(options);
    await vi.waitFor(() => expect(session.runtime.dispose).toHaveBeenCalledOnce());
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
  ])(
    'does not execute or write a response for a preclosed writableEnded response on %s',
    async (action, operation) => {
      const { options, session, res, asJson } = makeOptions(
        action,
        makeSession(),
        supportsApproveAll
      );
      res.writableEnded = true;
      const handled = await handleAssistantSessionRoutes(options);
      expect(handled).toBe(true);
      expect(
        session.runtime[operation as 'sendMessage' | 'resolveToolCalls']
      ).not.toHaveBeenCalled();
      expect(asJson).not.toHaveBeenCalled();
      expect(res.listenerCount('close')).toBe(0);
    }
  );

  it.each([
    ['/messages', 'sendMessage'],
    ['/tool-calls/tool-1/approve', 'resolveToolCalls']
  ])(
    'does not execute or write a response for an already destroyed response on %s',
    async (action, operation) => {
      const { options, session, res, asJson } = makeOptions(
        action,
        makeSession(),
        supportsApproveAll
      );
      res.destroyed = true;
      const handled = await handleAssistantSessionRoutes(options);
      expect(handled).toBe(true);
      expect(
        session.runtime[operation as 'sendMessage' | 'resolveToolCalls']
      ).not.toHaveBeenCalled();
      expect(asJson).not.toHaveBeenCalled();
      expect(res.listenerCount('close')).toBe(0);
    }
  );

  it('does not run cleanup for malformed suffixes', async () => {
    const { options } = makeOptions('/messages/extra', makeSession(), supportsApproveAll);
    await expect(handleAssistantSessionRoutes(options)).resolves.toBe(false);
    expect(options.cleanup).not.toHaveBeenCalled();
  });

  it('does not write a validation response when the request disconnects during body parsing', async () => {
    const { options, session, res, asJson } = makeOptions('/messages', makeSession());
    let finishParse!: (body: unknown) => void;
    options.parseBody = vi.fn(() => new Promise((resolve) => (finishParse = resolve)));
    const route = handleAssistantSessionRoutes(options);
    await vi.waitFor(() => expect(finishParse).toBeTypeOf('function'));
    res.emit('close');
    finishParse({ message: '' });
    await expect(route).resolves.toBe(true);
    expect(asJson).not.toHaveBeenCalled();
    expect(session.runtime.sendMessage).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
  });
});

describe('shared assistant session route behavior', () => {
  it('passes a client-generated turn identifier to the runtime', async () => {
    const { options, session } = makeOptions('/messages');
    options.parseBody.mockResolvedValue({
      message: 'repeatable question',
      turnId: 'client-turn-1'
    });
    await handleAssistantSessionRoutes(options);
    expect(session.runtime.sendMessage).toHaveBeenCalledWith(
      'repeatable question',
      expect.any(AbortSignal),
      'client-turn-1'
    );
  });

  it.each([null, '', ' ', {}, 'path/segment', 'x'.repeat(129)])(
    'rejects invalid client turn ID %j before executing the runtime',
    async (turnId) => {
      const { options, session, asJson } = makeOptions('/messages');
      options.parseBody.mockResolvedValue({ message: 'hello', turnId });
      await handleAssistantSessionRoutes(options);
      expect(asJson).toHaveBeenCalledWith(
        expect.anything(),
        400,
        expect.objectContaining({
          error: expect.stringContaining('turnId')
        })
      );
      expect(session.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('accepts repeated turn cancellation without running another mutation', async () => {
    const { options, session, asJson } = makeOptions('/turns/turn-1/cancel');
    session.runtime.cancel = vi.fn().mockResolvedValue(undefined);
    await handleAssistantSessionRoutes(options);
    await handleAssistantSessionRoutes(options);
    expect(session.runtime.cancel).toHaveBeenNthCalledWith(1, 'turn-1');
    expect(session.runtime.cancel).toHaveBeenNthCalledWith(2, 'turn-1');
    expect(asJson).toHaveBeenCalledTimes(2);
    expect(asJson).toHaveBeenCalledWith(expect.anything(), 200, { ok: true });
    expect(session.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('returns 404 when cancelling a missing session', async () => {
    const { options, asJson } = makeOptions('/turns/finished/cancel');
    options.sessions.clear();
    await handleAssistantSessionRoutes(options);
    expect(asJson).toHaveBeenCalledWith(expect.anything(), 404, {
      error: 'Assistant session not found'
    });
  });

  it.each(['tool_call_request', 'tool_call_resolved'] as const)(
    'adds the first pending tool call alias to %s responses',
    async (type) => {
      const { options, session, asJson } = makeOptions('/messages');
      const pendingToolCalls = [
        { id: 'tool-1', status: 'pending', publicToolName: 'write_report' },
        { id: 'tool-2', status: 'pending', publicToolName: 'send_email' }
      ];
      const response = { type, text: 'keep this response', pendingToolCalls };
      session.runtime.sendMessage = vi.fn().mockResolvedValue(response);

      await handleAssistantSessionRoutes(options);

      const body = asJson.mock.calls[0]?.[2] as any;
      expect(body.response).toEqual({ ...response, pendingToolCall: pendingToolCalls[0] });
      expect(body.response.text).toBe('keep this response');
    }
  );

  it.each([null, [], 'text', 3, {}, { message: 2 }, { message: '  ' }])(
    'rejects malformed message body %j without calling the runtime',
    async (body) => {
      const { options, session, asJson } = makeOptions('/messages');
      options.parseBody = vi.fn().mockResolvedValue(body);

      await handleAssistantSessionRoutes(options);

      expect(asJson).toHaveBeenCalledWith(expect.anything(), 400, { error: 'message is required' });
      expect(session.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('passes an explicit null arguments override through to the runtime', async () => {
    const { options, session } = makeOptions('/tool-calls/tool-1/approve');
    options.parseBody = vi.fn().mockResolvedValue({ argumentsOverride: null });

    await handleAssistantSessionRoutes(options);

    expect(session.runtime.resolveToolCalls).toHaveBeenCalledWith(
      [{ toolCallId: 'tool-1', decision: 'approve', arguments: null }],
      expect.any(AbortSignal)
    );
  });

  it('allows an empty body for approval', async () => {
    const { options, session, asJson } = makeOptions('/tool-calls/tool-1/approve');
    options.parseBody = vi.fn().mockResolvedValue({});

    await handleAssistantSessionRoutes(options);

    expect(session.runtime.resolveToolCalls).toHaveBeenCalledOnce();
    expect(asJson).toHaveBeenCalledWith(expect.anything(), 200, expect.any(Object));
  });

  it.each([null, [], 'text', 3])(
    'rejects malformed approval body %j without executing tools',
    async (body) => {
      const { options, session, asJson } = makeOptions('/tool-calls/tool-1/approve');
      options.parseBody = vi.fn().mockResolvedValue(body);

      await handleAssistantSessionRoutes(options);

      expect(asJson).toHaveBeenCalledWith(expect.anything(), 400, {
        error: 'Invalid request body'
      });
      expect(session.runtime.resolveToolCalls).not.toHaveBeenCalled();
    }
  );

  it('leaves an unknown subpath unhandled without cleanup or state mutation', async () => {
    const { options, session } = makeOptions('/not-a-route');
    const { factory, disposedSessions } = createStatefulAssistantRuntimeHarness();
    session.runtime = await factory.create(makeRuntimeDefinition());
    const before = session.runtime.getSnapshot();

    await expect(handleAssistantSessionRoutes(options)).resolves.toBe(false);

    expect(options.cleanup).not.toHaveBeenCalled();
    expect(session.runtime.getSnapshot()).toEqual(before);
    expect(disposedSessions).toEqual([]);
  });

  it.each(['Scenario Assistant', 'Result Assistant'])(
    'derives the %s missing tool call message from its label',
    async (assistantLabel) => {
      const { options, session, asJson } = makeOptions('/tool-calls/missing/approve');
      const { factory } = createStatefulAssistantRuntimeHarness();
      session.runtime = await factory.create(makeRuntimeDefinition());
      await session.runtime.sendMessage('start');
      options.assistantLabel = assistantLabel;

      await handleAssistantSessionRoutes(options);

      expect(asJson).toHaveBeenCalledWith(expect.anything(), 404, {
        error: `${assistantLabel} tool call not found`
      });
      expect(session.runtime.getSnapshot().pendingToolCalls[0]?.status).toBe('pending');
    }
  );

  it.each(['Scenario Assistant', 'Result Assistant'])(
    'derives the %s missing session message from its label',
    async (assistantLabel) => {
      const { options, asJson } = makeOptions('');
      options.assistantLabel = assistantLabel;
      options.pathname = '/api/assistant/sessions/missing';
      options.method = 'GET';
      options.sessions = new Map();

      await handleAssistantSessionRoutes(options);

      expect(asJson).toHaveBeenCalledWith(expect.anything(), 404, {
        error: `${assistantLabel} session not found`
      });
    }
  );

  it('rejects repeated approvals without replaying runtime execution', async () => {
    const { options, session, asJson } = makeOptions('/tool-calls/fake-call-1/approve');
    const { factory } = createStatefulAssistantRuntimeHarness();
    session.runtime = await factory.create(makeRuntimeDefinition());
    const resolveToolCalls = vi.fn(session.runtime.resolveToolCalls.bind(session.runtime));
    session.runtime.resolveToolCalls = resolveToolCalls;
    await session.runtime.sendMessage('start');

    await handleAssistantSessionRoutes(options);
    const snapshotAfterFirstApproval = session.runtime.getSnapshot();
    options.pathname = '/api/assistant/sessions/assistant-1/tool-calls/fake-call-1/approve';
    await handleAssistantSessionRoutes(options);

    expect(resolveToolCalls).toHaveBeenCalledOnce();
    expect(session.runtime.getSnapshot()).toEqual(snapshotAfterFirstApproval);
    expect(asJson).toHaveBeenLastCalledWith(expect.anything(), 409, {
      error: 'Tool call is already approved'
    });
    expect(session.runtime.getSnapshot().pendingToolCalls[0]?.status).toBe('approved');
  });

  it('rejects Scenario approve-all when there are no pending calls', async () => {
    const { options, session, asJson } = makeOptions(
      '/tool-calls/approve-all',
      makeSession(),
      true
    );
    const { factory } = createStatefulAssistantRuntimeHarness();
    session.runtime = await factory.create(makeRuntimeDefinition());

    await handleAssistantSessionRoutes(options);

    expect(asJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error: 'No pending tool calls to approve'
    });
  });

  it('leaves Result approve-all unhandled', async () => {
    const { options, session } = makeOptions('/tool-calls/approve-all', makeSession(), false);
    const { factory } = createStatefulAssistantRuntimeHarness();
    session.runtime = await factory.create(makeRuntimeDefinition('result'));

    await expect(handleAssistantSessionRoutes(options)).resolves.toBe(false);
    expect(options.cleanup).not.toHaveBeenCalled();
    expect(session.runtime.getSnapshot().pendingToolCalls).toEqual([]);
  });
});
