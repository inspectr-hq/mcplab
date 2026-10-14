import { describe, expect, it, vi } from 'vitest';
import type { AssistantRuntimeSession } from '@inspectr/mcplab-core';
import { cleanupAssistantSessions } from './scenario-assistant-domain.js';
import { cleanupResultAssistantSessions } from './result-assistant-domain.js';

describe('assistant session TTL', () => {
  it.each([
    ['scenario', cleanupAssistantSessions],
    ['result', cleanupResultAssistantSessions]
  ])('keeps an active %s session alive despite a stale timestamp', (kind, cleanup) => {
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ messages: [], pendingToolCalls: [] }),
      isBusy: () => true,
      dispose: vi.fn()
    };
    const session = {
      id: 'active',
      lastTouchedAt: 0,
      events: [],
      clients: new Set(),
      runtime
    };
    const sessions = new Map([[session.id, session]]);

    cleanup(sessions as never, Date.now());

    expect(sessions.has('active')).toBe(true);
    expect(runtime.dispose).not.toHaveBeenCalled();
  });
});
