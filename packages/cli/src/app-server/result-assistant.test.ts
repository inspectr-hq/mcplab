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
