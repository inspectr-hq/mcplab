import {
  formatAssistantToolName,
  type AssistantToolHints,
  type ToolDef
} from '@inspectr/mcplab-core';
import type { AssistantToolDisplay } from './assistant-runtime-contract.js';

const MAX_DISPLAY_DESCRIPTION_CHARS = 300;

/** What someone approving a call needs from an MCP tool definition: its title, purpose and risk. */
export function assistantToolDisplay(tool: ToolDef): AssistantToolDisplay {
  const annotations = tool.annotations;
  const hints: AssistantToolHints = {
    ...(annotations?.readOnlyHint !== undefined ? { readOnly: annotations.readOnlyHint } : {}),
    ...(annotations?.destructiveHint !== undefined
      ? { destructive: annotations.destructiveHint }
      : {}),
    ...(annotations?.idempotentHint !== undefined
      ? { idempotent: annotations.idempotentHint }
      : {}),
    ...(annotations?.openWorldHint !== undefined ? { openWorld: annotations.openWorldHint } : {})
  };
  const title = tool.title ?? annotations?.title;
  // The first paragraph is the summary; the rest is usually guidance for the model.
  const summary = tool.description
    ?.trim()
    .split(/\n\s*\n/)[0]
    ?.trim();
  const description =
    summary && summary.length > MAX_DISPLAY_DESCRIPTION_CHARS
      ? `${summary.slice(0, MAX_DISPLAY_DESCRIPTION_CHARS - 1).trimEnd()}…`
      : summary;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(Object.keys(hints).length ? { hints } : {})
  };
}

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

/** Every assistant tool call, MCP or local context, gets the same limit. */
export const ASSISTANT_TOOL_TIMEOUT_MS = 30_000;
export const ASSISTANT_TOOL_TIMEOUT_MESSAGE = `Tool call timed out after ${ASSISTANT_TOOL_TIMEOUT_MS}ms`;

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
