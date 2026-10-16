import { describe, expect, it, vi } from 'vitest';
import { cleanupScenarioAssistantSessions } from './scenario-assistant-domain.js';
import { cleanupResultAssistantSessions } from './result-assistant-domain.js';
import type { AssistantRuntimeSession } from './assistant-runtime-contract.js';

describe('assistant session TTL', () => {
  it.each([
    ['scenario', cleanupScenarioAssistantSessions],
    ['result', cleanupResultAssistantSessions]
  ])('expires a stale idle %s session and closes its SSE clients', async (kind, cleanup) => {
    const client = { end: vi.fn() };
    const runtime: AssistantRuntimeSession = {
      sendMessage: vi.fn(),
      resolveToolCalls: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
      isBusy: () => false,
      dispose: vi.fn()
    };
    const session = {
      id: 'active',
      lastTouchedAt: 0,

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
      cancel: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn().mockReturnValue({ revision: 0, messages: [], pendingToolCalls: [] }),
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
