import type { ToolDef } from '@inspectr/mcplab-core';
import { formatAssistantToolName } from '@inspectr/mcplab-core';

export { formatAssistantToolName };

export function truncateJson(value: unknown, maxChars: number): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  } catch {
    return String(value);
  }
}

export function normalizeAssistantToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || `tool_${Date.now()}`;
}

export function makeAssistantToolPublicName(
  serverName: string,
  toolName: string,
  used: Set<string>
): string {
  const base = `${normalizeAssistantToolName(serverName)}__${normalizeAssistantToolName(toolName)}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function cleanupSessionsByTtl<T extends { lastTouchedAt: number }>(
  sessions: Map<string, T>,
  ttlMs: number,
  now = Date.now(),
  onExpire?: (session: T) => void
): void {
  for (const [id, session] of sessions) {
    if (now - session.lastTouchedAt > ttlMs) {
      onExpire?.(session);
      sessions.delete(id);
    }
  }
}

export function touchSession<T extends { lastTouchedAt: number }>(session: T): void {
  session.lastTouchedAt = Date.now();
}

export async function withTimeout<T>(
  promiseFactory: () => Promise<T>,
  timeoutMs: number,
  message = `Operation timed out after ${timeoutMs}ms`,
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  const abortPromise =
    signal &&
    new Promise<never>((_, reject) => {
      abortListener = () => reject(createAbortError());
      signal.addEventListener('abort', abortListener, { once: true });
    });
  try {
    return await Promise.race(
      abortPromise ? [promiseFactory(), timeout, abortPromise] : [promiseFactory(), timeout]
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}
