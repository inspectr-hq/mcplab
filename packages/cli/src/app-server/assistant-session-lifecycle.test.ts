import { describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeSession } from '@inspectr/mcplab-core';
import { cleanupScenarioAssistantSessions } from './scenario-assistant-domain.js';
import { cleanupResultAssistantSessions } from './result-assistant-domain.js';

describe('assistant session TTL', () => {
  it.each([
    ['scenario', cleanupScenarioAssistantSessions],
    ['result', cleanupResultAssistantSessions]
  ])('expires a stale idle %s session and closes its SSE clients', async (kind, cleanup) => {
    const client = { end: vi.fn() };
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      isBusy: () => false,
      dispose: vi.fn()
    };
    const session = {
      id: 'active',
      lastTouchedAt: 0,
      events: [],
      clients: new Set([client]),
      runtime
    };
    const sessions = new Map([[session.id, session]]);

    cleanup(sessions as never, Date.now());

    expect(sessions.has('active')).toBe(false);
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it.each([
    ['scenario', cleanupScenarioAssistantSessions],
    ['result', cleanupResultAssistantSessions]
  ])('also expires a stale active %s session to abort its work', (kind, cleanup) => {
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      isBusy: () => true,
      dispose: vi.fn()
    };
    const session = { id: 'active', lastTouchedAt: 0, events: [], clients: new Set(), runtime };
    const sessions = new Map([[session.id, session]]);
    cleanup(sessions as never, Date.now());
    expect(sessions.has('active')).toBe(false);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
