/// <reference lib="webworker" />

const ports = new Set<MessagePort>();
let source: EventSource | null = null;
let baseUrl = '';

function broadcast(data: unknown): void {
  for (const port of ports) {
    port.postMessage(data);
  }
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
    const reconnecting = source?.readyState !== 2;
    broadcast({
      type: 'error',
      ts: new Date().toISOString(),
      payload: { message: 'SSE connection error', reconnecting }
    });
    if (!reconnecting) {
      source = null;
    }
  };
}

self.addEventListener('connect', (e: Event) => {
  const port = (e as MessageEvent).ports[0]!;
  ports.add(port);

  port.addEventListener('message', (msg: MessageEvent) => {
    if (msg.data?.type === 'init') {
      baseUrl = msg.data.baseUrl ?? '';
      openEventSource();
      // New tab connecting after SSE is already open: send connected immediately
      if (source?.readyState === 1) {
        port.postMessage({
          type: 'connected',
          ts: new Date().toISOString(),
          payload: { message: 'SSE connected' }
        });
      }
    }
    if (msg.data?.type === 'close') {
      ports.delete(port);
      port.close();
      if (ports.size === 0 && source) {
        source.close();
        source = null;
      }
    }
  });

  port.start();
});