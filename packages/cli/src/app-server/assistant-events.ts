import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendSseEvent, type SseEvent } from './jobs.js';

export type AssistantSseEventType =
  | 'session_started'
  | 'turn_started'
  | 'tool_call_requested'
  | 'tool_call_approved'
  | 'tool_call_denied'
  | 'tool_call_resolved'
  | 'assistant_message_completed'
  | 'session_warning'
  | 'session_error'
  | 'session_finished';

export type AssistantSseEvent = SseEvent & {
  type: AssistantSseEventType;
};

export interface AssistantSseSessionState {
  events: AssistantSseEvent[];
  clients: Set<ServerResponse>;
}

export function createAssistantSseEvent(
  type: AssistantSseEventType,
  payload: Record<string, unknown>
): AssistantSseEvent {
  return {
    type,
    ts: new Date().toISOString(),
    payload
  };
}

export function broadcastAssistantSseEvent(
  session: AssistantSseSessionState,
  event: AssistantSseEvent
): void {
  session.events.push(event);
  for (const client of session.clients) {
    sendSseEvent(client, event);
  }
}

export function serveAssistantSseStream(
  req: IncomingMessage,
  res: ServerResponse,
  session: AssistantSseSessionState
): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  for (const event of session.events) {
    sendSseEvent(res, event);
  }
  session.clients.add(res);
  if (typeof req.on === 'function') {
    req.on('close', () => {
      session.clients.delete(res);
    });
  }
}

export function endAssistantSseClients(session: AssistantSseSessionState): void {
  for (const client of session.clients) {
    client.end();
  }
  session.clients.clear();
}
