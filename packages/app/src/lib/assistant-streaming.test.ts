import { describe, expect, it } from 'vitest';
import { applyAssistantMessageDelta, shouldUseAssistantSession } from './assistant-streaming';

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

describe('applyAssistantMessageDelta', () => {
  const delta = (offset: number, text: string) => ({
    sessionId: 's',
    turnId: 't',
    messageId: 'm',
    offset,
    delta: text,
    createdAt: new Date(Date.now() - 2000).toISOString(),
    revision: 1
  });

  it('streams reasoning and answer text into one message, in order', () => {
    let streaming = applyAssistantMessageDelta({
      messages: [],
      activeTurnId: 't',
      delta: delta(0, 'Checking'),
      kind: 'reasoning'
    });
    expect(streaming).toMatchObject({ text: '', reasoning: { text: 'Checking' } });
    // A gap in the reasoning offsets is ignored until the snapshot catches up.
    expect(
      applyAssistantMessageDelta({
        messages: [],
        activeTurnId: 't',
        streamingMessage: streaming,
        delta: delta(3, 'x'),
        kind: 'reasoning'
      })
    ).toBe(streaming);
    streaming = applyAssistantMessageDelta({
      messages: [],
      activeTurnId: 't',
      streamingMessage: streaming,
      delta: delta(0, 'Answer')
    });
    expect(streaming).toMatchObject({ text: 'Answer', reasoning: { text: 'Checking' } });
    // The answer starting ends the reasoning, so its block can close.
    expect(streaming?.reasoning?.durationMs).toEqual(expect.any(Number));
  });
});
