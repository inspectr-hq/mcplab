import { describe, expect, it } from 'vitest';
import { shouldUseAssistantSession } from './assistant-streaming';

describe('shouldUseAssistantSession', () => {
  it('accepts only snapshots with a strictly newer revision for the same session', () => {
    const current = { id: 'session-1', revision: 4, messages: [] };

    expect(shouldUseAssistantSession(current, { ...current, revision: 3 })).toBe(false);
    expect(shouldUseAssistantSession(current, { ...current, revision: 4 })).toBe(false);
    expect(shouldUseAssistantSession(current, { ...current, revision: 5 })).toBe(true);
  });

  it('accepts the first snapshot and a snapshot from a new session', () => {
    const next = { id: 'session-1', revision: 0, messages: [] };
    expect(shouldUseAssistantSession(null, next)).toBe(true);
    expect(shouldUseAssistantSession(next, { id: 'session-2', revision: 0, messages: [] })).toBe(
      true
    );
  });
});
