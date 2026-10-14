import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { handleResultAssistantRoutes } from './result-assistant.js';

describe('GET /api/result-assistant/sessions/:id/events', () => {
  it('streams existing assistant events', async () => {
    const writes: string[] = [];
    const ends: number[] = [];
    const resultAssistantSessions = new Map([
      [
        'ras-1',
        {
          id: 'ras-1',
          events: [
            {
              type: 'session_started',
              ts: '2026-04-27T10:00:00.000Z',
              payload: { sessionId: 'ras-1', session: { id: 'ras-1' } }
            },
            {
              type: 'turn_started',
              ts: '2026-04-27T10:00:01.000Z',
              payload: { sessionId: 'ras-1', session: { id: 'ras-1' } }
            }
          ],
          clients: new Set()
        }
      ]
    ]) as any;

    const handled = await handleResultAssistantRoutes({
      req: { headers: {} } as any,
      res: {
        statusCode: 0,
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: (chunk: string) => writes.push(chunk),
        end: () => ends.push(1)
      } as any,
      pathname: '/api/result-assistant/sessions/ras-1/events',
      method: 'GET',
      settings: { workspaceRoot: '/tmp', runsDir: '/tmp/runs', librariesDir: '/tmp/libs' } as any,
      resultAssistantSessions,
      deps: {
        parseBody: vi.fn(),
        asJson: vi.fn(),
        getRunResults: vi.fn(),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn()
      } as any
    });

    expect(handled).toBe(true);
    expect(writes.join('')).toContain('event: session_started');
    expect(writes.join('')).toContain('event: turn_started');
    expect(ends).toHaveLength(0);
    expect(resultAssistantSessions.get('ras-1')?.clients.size).toBe(1);
  });
});

describe('POST /api/result-assistant/sessions/:id/messages cancellation', () => {
  it('does not return a canceled turn response after the request closes', async () => {
    let resolveTurn!: (value: unknown) => void;
    const turnPromise = new Promise((resolve) => {
      resolveTurn = resolve;
    });
    const req = new EventEmitter() as any;
    req.headers = {};
    const res = Object.assign(new EventEmitter(), { writableEnded: false }) as any;
    const asJson = vi.fn();
    const resultAssistantSessions = new Map([
      [
        'ras-1',
        {
          id: 'ras-1',
          scope: 'run',
          runId: 'run-1',
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
          selectedAssistantAgentName: 'assistant-1',
          agentConfig: { provider: 'openai', model: 'gpt-4o-mini' },
          resultSummary: null,
          referenceReportsForRun: [],
          toolsLoaded: 0,
          toolServers: [],
          initialMessages: [],
          runtime: {
            sendMessage: vi.fn().mockReturnValue(turnPromise),
            resolveToolCalls: vi.fn(),
            getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
            dispose: vi.fn()
          },
          clients: new Set(),
          events: []
        }
      ]
    ]) as any;

    const handled = handleResultAssistantRoutes({
      req,
      res,
      pathname: '/api/result-assistant/sessions/ras-1/messages',
      method: 'POST',
      settings: { workspaceRoot: '/tmp', runsDir: '/tmp/runs', librariesDir: '/tmp/libs' } as any,
      resultAssistantSessions,
      deps: {
        parseBody: vi.fn().mockResolvedValue({ message: 'hello' }),
        asJson,
        getRunResults: vi.fn(),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn(),
        preloadResultAssistantTools: vi.fn()
      } as any
    });

    const handlerPromise = Promise.resolve(handled);
    res.emit('close');
    resolveTurn({
      response: {
        type: 'assistant_message',
        text: 'late response'
      }
    });

    await expect(handlerPromise).resolves.toBe(true);
    expect(asJson).not.toHaveBeenCalled();
    const session = resultAssistantSessions.get('ras-1');
    expect(session?.runtime?.getSnapshot()).toMatchObject({ messages: [], pendingToolCalls: [] });
  });
});

describe('Result Assistant runtime factory', () => {
  it('uses an opaque runtime for route create, send, decision, view, and close', async () => {
    const captured: Array<{ status: number; body: any }> = [];
    const snapshot = { messages: [], pendingToolCalls: [{ id: 'opaque-1', name: 'report', arguments: {}, status: 'pending' }] };
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'fake result' }),
      resolveToolCalls: vi.fn().mockResolvedValue({ type: 'assistant_message', text: 'resolved' }),
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      dispose: vi.fn()
    };
    const assistantRuntimeFactory = { create: vi.fn().mockResolvedValue(runtime) };
    const resultAssistantSessions = new Map();
    const deps = {
      parseBody: vi.fn().mockResolvedValueOnce({ scope: 'all_runs' }).mockResolvedValueOnce({ message: 'hello' }).mockResolvedValueOnce({}),
      asJson: vi.fn((_res, status, body) => captured.push({ status, body })),
      getRunResults: vi.fn(),
      readLibraries: vi.fn().mockReturnValue({ agents: { assistant: {} }, servers: {} }),
      pickDefaultAssistantAgentName: vi.fn().mockReturnValue('assistant'),
      resolveAssistantAgentFromLibraries: vi.fn().mockReturnValue({ provider: 'openai', model: 'fake' }),
      preloadResultAssistantTools: vi.fn(),
      assistantRuntimeFactory
    } as any;
    const settings = { workspaceRoot: '/tmp', runsDir: '/tmp/runs', librariesDir: '/tmp/libs' } as any;

    await handleResultAssistantRoutes({
      req: { headers: {} } as any, res: {} as any,
      pathname: '/api/result-assistant/sessions', method: 'POST', settings,
      resultAssistantSessions, deps
    });
    const sessionId = captured[0].body.sessionId;
    await handleResultAssistantRoutes({
      req: Object.assign(new EventEmitter(), { complete: true, headers: {} }) as any,
      res: Object.assign(new EventEmitter(), { writableEnded: false }) as any,
      pathname: `/api/result-assistant/sessions/${sessionId}/messages`, method: 'POST', settings,
      resultAssistantSessions, deps
    });

    expect(assistantRuntimeFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({ assistant: 'result', context: expect.objectContaining({ scope: 'all_runs' }) })
    );
    expect(assistantRuntimeFactory.create.mock.calls[0][0]).not.toHaveProperty('mcp');
    expect(assistantRuntimeFactory.create.mock.calls[0][0]).not.toHaveProperty('llmMessages');
    expect(runtime.sendMessage).toHaveBeenCalledWith('hello', expect.any(AbortSignal));
    await handleResultAssistantRoutes({
      req: { headers: {} } as any, res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}/tool-calls/opaque-1/approve`, method: 'POST', settings,
      resultAssistantSessions, deps
    });
    expect(runtime.resolveToolCalls).toHaveBeenCalledWith([
      { toolCallId: 'opaque-1', decision: 'approve' }
    ], expect.any(AbortSignal));
    await handleResultAssistantRoutes({
      req: { headers: {} } as any, res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}`, method: 'GET', settings,
      resultAssistantSessions, deps
    });
    expect(runtime.getSnapshot).toHaveBeenCalled();
    await handleResultAssistantRoutes({
      req: { headers: {} } as any, res: {} as any,
      pathname: `/api/result-assistant/sessions/${sessionId}`, method: 'DELETE', settings,
      resultAssistantSessions, deps
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
