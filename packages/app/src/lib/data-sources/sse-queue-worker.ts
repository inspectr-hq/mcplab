/// <reference lib="webworker" />

const ports = new Set<MessagePort>();
const portLastPong = new Map<MessagePort, number>();
let source: EventSource | null = null;
let baseUrl = '';
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let latestQueueEvent: unknown = null;

const HEARTBEAT_MS = 15_000;

function isEmptyQueueEvent(data: unknown): boolean {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('type' in data) ||
    data.type !== 'queue_event'
  ) {
    return false;
  }
  const payload =
    'payload' in data && typeof data.payload === 'object' && data.payload !== null
      ? data.payload
      : null;
  const event =
    payload && 'event' in payload && typeof payload.event === 'object' && payload.event !== null
      ? payload.event
      : null;
  if (!event) return false;
  const activeJobs =
    'active_jobs' in event && Array.isArray(event.active_jobs)
      ? event.active_jobs
      : 'active' in event && event.active
      ? [event.active]
      : [];
  const admittingJobs =
    'admitting_jobs' in event && Array.isArray(event.admitting_jobs) ? event.admitting_jobs : [];
  const queued = 'queued' in event && Array.isArray(event.queued) ? event.queued : [];
  return activeJobs.length === 0 && admittingJobs.length === 0 && queued.length === 0;
}

function removePort(port: MessagePort): void {
  ports.delete(port);
  portLastPong.delete(port);
  port.close();
  if (ports.size === 0 && source) {
    source.close();
    source = null;
  }
  if (ports.size === 0 && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function broadcast(data: unknown): void {
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'queue_event') {
    latestQueueEvent = isEmptyQueueEvent(data) ? null : data;
  }
  for (const port of ports) {
    port.postMessage(data);
  }
}

function ensureHeartbeat(): void {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const port of ports) {
      const last = portLastPong.get(port) ?? now;
      if (now - last > HEARTBEAT_MS * 2) {
        removePort(port);
      } else {
        port.postMessage({ type: 'ping' });
      }
    }
  }, HEARTBEAT_MS);
}

function openEventSource(): void {
  if (source) return;
  source = new EventSource(`${baseUrl}/api/runs/queue/events`);

  source.addEventListener('queue_event', (event: MessageEvent) => {
    try {
      broadcast(JSON.parse(event.data));
    } catch {
      // ignore malformed SSE payloads
    }
  });

  source.onopen = () => {
    broadcast({
      type: 'connected',
      ts: new Date().toISOString(),
      payload: { message: 'SSE connected' }
    });
  };

  source.onerror = () => {
    if (!source) return;
    const reconnecting = source.readyState !== 2;
    broadcast({
      type: 'error',
      ts: new Date().toISOString(),
      payload: { message: 'SSE connection error', reconnecting }
    });
    if (!reconnecting) {
      source.onerror = null;
      source = null;
    }
  };
}

self.addEventListener('connect', (e: Event) => {
  const port = (e as MessageEvent).ports[0]!;
  ports.add(port);

  port.addEventListener('message', (msg: MessageEvent) => {
    if (msg.data?.type === 'init') {
      if (!baseUrl) baseUrl = msg.data.baseUrl ?? '';
      portLastPong.set(port, Date.now());
      ensureHeartbeat();
      openEventSource();
      if (latestQueueEvent) {
        port.postMessage(latestQueueEvent);
      }
      // New tab connecting after SSE is already open: send connected immediately
      if (source?.readyState === 1) {
        port.postMessage({
          type: 'connected',
          ts: new Date().toISOString(),
          payload: { message: 'SSE connected' }
        });
      }
    }
    if (msg.data?.type === 'pong') {
      portLastPong.set(port, Date.now());
    }
    if (msg.data?.type === 'close') {
      removePort(port);
    }
  });

  port.start();
});
