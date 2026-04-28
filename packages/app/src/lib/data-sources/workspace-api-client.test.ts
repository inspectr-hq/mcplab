import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceApiClient } from './workspace-api-client';

type FetchResponse = {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
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

describe('workspaceApiClient SSE subscriptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    MockEventSource.reset();
  });

  it('closes terminal assistant subscriptions when the session endpoint returns 404', async () => {
    const fetchMock = vi.fn(
      async (): Promise<FetchResponse> => ({
        status: 404,
        ok: false,
        text: async () => 'not found'
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
});
