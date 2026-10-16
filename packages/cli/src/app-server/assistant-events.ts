import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssistantRuntimeEvent } from '@inspectr/mcplab-core';
import { sendSseEvent, type SseEvent } from './jobs.js';

export type AssistantSseEventType = AssistantRuntimeEvent['type'];
export type AssistantSseEvent = AssistantRuntimeEvent & SseEvent;

export interface AssistantSseSessionState {
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
  for (const client of session.clients) {
    sendSseEvent(client, event);
  }
}

export function serveAssistantSseStream(
  req: IncomingMessage,
  res: ServerResponse,
  session: AssistantSseSessionState,
  snapshot: Record<string, unknown>
): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('x-accel-buffering', 'no');
  res.setHeader('connection', 'keep-alive');
  if ('flushHeaders' in res && typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  sendSseEvent(res, createAssistantSseEvent('session_snapshot', snapshot));
  session.clients.add(res);
  if (typeof res.on === 'function') {
    res.on('close', () => {
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

export function createAssistantRequestAbortController(res: ServerResponse) {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  // A response can close before the handler starts, for example when a client
  // disconnects while the request body is still being received.
  if (res.destroyed && !res.writableEnded) controller.abort();
  res.on?.('close', onClose);
  return { signal: controller.signal, dispose: () => res.off?.('close', onClose) };
}
