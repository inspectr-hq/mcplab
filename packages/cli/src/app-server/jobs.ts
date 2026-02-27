import type { ServerResponse } from 'node:http';

export type SseEvent = {
  type: string;
  ts: string;
  payload: Record<string, unknown>;
};

export function sendSseEvent(res: ServerResponse, event: SseEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function addJobEvent(
  job: { events: SseEvent[]; clients: Set<ServerResponse> },
  event: SseEvent
) {
  job.events.push(event);
  for (const client of job.clients) {
    sendSseEvent(client, event);
  }
}
