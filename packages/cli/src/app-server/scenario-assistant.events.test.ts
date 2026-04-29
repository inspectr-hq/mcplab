import { describe, expect, it, vi } from 'vitest';
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';

describe('GET /api/scenario-assistant/sessions/:id/events', () => {
  it('streams existing assistant events', async () => {
    const writes: string[] = [];
    const ends: number[] = [];
    const assistantSessions = new Map([
      [
        'sas-1',
        {
          id: 'sas-1',
          events: [
            {
              type: 'session_started',
              ts: '2026-04-27T10:00:00.000Z',
              payload: { sessionId: 'sas-1', session: { id: 'sas-1' } }
            },
            {
              type: 'turn_started',
              ts: '2026-04-27T10:00:01.000Z',
              payload: { sessionId: 'sas-1', session: { id: 'sas-1' } }
            }
          ],
          clients: new Set()
        }
      ]
    ]) as any;

    const handled = await handleScenarioAssistantRoutes({
      req: { headers: {} } as any,
      res: {
        statusCode: 0,
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: (chunk: string) => writes.push(chunk),
        end: () => ends.push(1)
      } as any,
      pathname: '/api/scenario-assistant/sessions/sas-1/events',
      method: 'GET',
      settings: { evalsDir: '/tmp/evals', librariesDir: '/tmp/libs' } as any,
      assistantSessions,
      oauthSessionManager: { getAuthHeadersForServers: vi.fn() } as any,
      deps: {
        parseBody: vi.fn(),
        asJson: vi.fn(),
        cleanupAssistantSessions: vi.fn(),
        touchAssistantSession: vi.fn(),
        assistantSessionView: vi.fn(),
        ensureInsideRoot: vi.fn(),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromConfig: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn(),
        preloadAssistantTools: vi.fn(),
        continueAssistantTurn: vi.fn(),
        executeAssistantToolCall: vi.fn(),
        summarizeToolResultForAssistant: vi.fn()
      } as any
    });

    expect(handled).toBe(true);
    expect(writes.join('')).toContain('event: session_started');
    expect(writes.join('')).toContain('event: turn_started');
    expect(ends).toHaveLength(0);
    expect(assistantSessions.get('sas-1')?.clients.size).toBe(1);
  });
});
