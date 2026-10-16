import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  broadcastAssistantSseEvent,
  createAssistantSseEvent,
  serveAssistantSseStream
} from './assistant-events.js';

describe('assistant streaming transport', () => {
  it('sends only deltas during generation and a fresh snapshot on reconnect', () => {
    const response = () =>
      Object.assign(new EventEmitter(), {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn()
      }) as unknown as ServerResponse;
    const first = response();
    const session = { clients: new Set<ServerResponse>() };
    const snapshot = (text: string) => ({
      sessionId: 'session-1',
      session: { streamingMessage: { id: 'message-1', text } }
    });
    serveAssistantSseStream({} as IncomingMessage, first, session, snapshot(''));
    const delta = createAssistantSseEvent('assistant_message_delta', {
      sessionId: 'session-1',
      turnId: 'turn-1',
      messageId: 'message-1',
      offset: 0,
      delta: 'Hello',
      createdAt: ''
    });
    broadcastAssistantSseEvent(session, delta);
    expect(first.write).toHaveBeenLastCalledWith(expect.stringContaining('"delta":"Hello"'));
    expect(session).not.toHaveProperty('events');
    first.emit('close');
    expect(session.clients.size).toBe(0);
    const reconnected = response();
    serveAssistantSseStream({} as IncomingMessage, reconnected, session, snapshot('Hello'));
    expect(reconnected.write).toHaveBeenCalledTimes(2);
    expect(reconnected.write).toHaveBeenCalledWith(expect.stringContaining('"text":"Hello"'));
    expect(reconnected.write).not.toHaveBeenCalledWith(expect.stringContaining('"delta"'));
  });
});
