import { describe, expect, it, vi } from 'vitest';
import { handleScenarioAssistantRoutes } from './scenario-assistant.js';

describe('GET /api/scenario-assistant/sessions/:id/events', () => {
  it('starts with the current snapshot instead of replaying stale events', async () => {
    const writes: string[] = [];
    const ends: number[] = [];
    const assistantSessions = new Map([
      [
        'sas-1',
        {
          id: 'sas-1',
          createdAt: 0,
          lastTouchedAt: Date.now(),
          runtime: {
            getSnapshot: () => ({
              messages: [],
              pendingToolCalls: [],
              activeTurnId: 'turn-1',
              streamingMessage: { id: 'live-1', turnId: 'turn-1', text: 'Hello', createdAt: '' }
            })
          },
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
        ensureInsideRoot: vi.fn(),
        readLibraries: vi.fn(),
        pickDefaultAssistantAgentName: vi.fn(),
        resolveAssistantAgentFromConfig: vi.fn(),
        resolveAssistantAgentFromLibraries: vi.fn(),
        assistantRuntimeFactory: { create: vi.fn() }
      } as any
    });

    expect(handled).toBe(true);
    expect(writes.join('')).toContain('event: session_snapshot');
    expect(writes.join('')).toContain('"text":"Hello"');
    expect(writes.join('')).not.toContain('event: session_started');
    expect(writes.join('')).not.toContain('event: turn_started');
    expect(ends).toHaveLength(0);
    expect(assistantSessions.get('sas-1')?.clients.size).toBe(1);
  });
});
