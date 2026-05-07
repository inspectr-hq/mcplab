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
          mcp: {},
          tools: [],
          toolPublicMap: new Map(),
          chatMessages: [],
          llmMessages: [],
          pendingToolCalls: [],
          clients: new Set(),
          events: []
        }
      ]
    ]) as any;

    const handled = handleResultAssistantRoutes({
      req,
      res: {} as any,
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
        continueResultAssistantTurn: vi.fn().mockReturnValue(turnPromise),
        executeResultAssistantToolCall: vi.fn(),
        summarizeToolResultForResultAssistant: vi.fn(),
        preloadResultAssistantTools: vi.fn()
      } as any
    });

    const handlerPromise = Promise.resolve(handled);
    req.emit('close');
    resolveTurn({
      response: {
        type: 'assistant_message',
        text: 'late response'
      }
    });

    await expect(handlerPromise).resolves.toBe(true);
    expect(asJson).not.toHaveBeenCalled();
    const session = resultAssistantSessions.get('ras-1');
    expect(session?.chatMessages).toHaveLength(0);
    expect(session?.llmMessages).toHaveLength(0);
    expect(session?.pendingToolCalls).toHaveLength(0);
  });
});
