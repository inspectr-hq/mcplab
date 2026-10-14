import { describe, expect, it, vi } from 'vitest';
import { withTimeoutSignal } from './abort.js';

describe('withTimeoutSignal', () => {
  it('relays caller cancellation and disposes the timeout', () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const timeout = withTimeoutSignal(caller.signal, 1000);
    caller.abort();
    expect(timeout.signal.aborted).toBe(true);
    timeout.dispose();
    vi.useRealTimers();
  });

  it('marks a timeout separately from caller cancellation', () => {
    vi.useFakeTimers();
    const timeout = withTimeoutSignal(undefined, 1000);
    vi.advanceTimersByTime(1000);
    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.timeoutSignal.aborted).toBe(true);
    timeout.dispose();
    vi.useRealTimers();
  });
});
