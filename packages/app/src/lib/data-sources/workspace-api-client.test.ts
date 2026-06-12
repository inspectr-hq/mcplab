import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceApiClient } from './workspace-api-client';

type FetchResponse = {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  fail() {
    this.onerror?.(new Event('error'));
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

class MockSharedWorkerPort {
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  start() {}
  postMessage(data: unknown) {
    this.messages.push(data);
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class MockSharedWorker {
  static instances: MockSharedWorker[] = [];
  readonly port = new MockSharedWorkerPort();
  constructor(public readonly url: unknown) {
    MockSharedWorker.instances.push(this);
  }
  static reset() {
    MockSharedWorker.instances = [];
  }
}

describe('workspaceApiClient SSE subscriptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    MockEventSource.reset();
    MockSharedWorker.reset();
  });

  it('closes terminal assistant subscriptions when the session endpoint returns 404', async () => {
    const fetchMock = vi.fn(
      async (): Promise<FetchResponse> => ({
        status: 404,
        ok: false,
        text: async () => 'not found',
        json: async () => ({})
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    const unsubscribe = workspaceApiClient.subscribeResultAssistantSessionEvents('ras-1', vi.fn());
    const source = MockEventSource.instances[0]!;

    source.fail();

    await waitFor(() => {
      expect(source.closed).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/result-assistant/sessions/ras-1',
      expect.objectContaining({
        method: 'GET'
      })
    );

    unsubscribe();
  });

  it('forwards queue events from the SharedWorker port to the callback', () => {
    vi.stubGlobal('SharedWorker', MockSharedWorker as unknown as typeof SharedWorker);
    const onEvent = vi.fn();

    const unsubscribe = workspaceApiClient.subscribeRunQueue(onEvent);
    const worker = MockSharedWorker.instances[0]!;

    worker.port.emit({
      type: 'queue_event',
      ts: '2026-01-01T00:00:00.000Z',
      payload: { event: { active: null, queued: [] } }
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'queue_event' })
    );

    unsubscribe();
    expect(worker.port.messages).toContainEqual({ type: 'close' });
  });

  it('sends init message with baseUrl and starts port on subscribe', () => {
    vi.stubGlobal('SharedWorker', MockSharedWorker as unknown as typeof SharedWorker);

    workspaceApiClient.subscribeRunQueue(vi.fn());
    const worker = MockSharedWorker.instances[0]!;

    expect(worker.port.messages[0]).toEqual({ type: 'init', baseUrl: '' });
  });

  it('forwards error events from the SharedWorker port to the callback', () => {
    vi.stubGlobal('SharedWorker', MockSharedWorker as unknown as typeof SharedWorker);
    const onEvent = vi.fn();

    workspaceApiClient.subscribeRunQueue(onEvent);
    const worker = MockSharedWorker.instances[0]!;

    worker.port.emit({
      type: 'error',
      ts: '2026-01-01T00:00:00.000Z',
      payload: { message: 'SSE connection error', reconnecting: true }
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' })
    );
  });
});

describe('workspaceApiClient assistant request cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards AbortSignal to assistant turn requests', async () => {
    const fetchMock = vi.fn(
      async (): Promise<FetchResponse> => ({
        status: 200,
        ok: true,
        text: async () => '',
        json: async () => ({
          sessionId: 'ras-1',
          session: {
            id: 'ras-1',
            scope: 'run',
            runId: 'run-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            selectedAssistantAgentName: 'assistant-1',
            model: 'gpt-4o-mini',
            provider: 'openai',
            messages: [],
            pendingToolCalls: []
          }
        })
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    await workspaceApiClient.createResultAssistantSession(
      { runId: 'run-1', scope: 'run' },
      controller.signal
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/result-assistant/sessions',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal
      })
    );
  });
});
