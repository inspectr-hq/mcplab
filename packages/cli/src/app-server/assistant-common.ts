import { randomUUID } from 'node:crypto';
import type { AgentConfig, LlmMessage, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent, formatAssistantToolName } from '@inspectr/mcplab-core';

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

function extractFirstBalancedJsonCandidate(text: string): string | null {
  const starts: Array<{ idx: number; open: '{' | '['; close: '}' | ']' }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') starts.push({ idx: i, open: '{', close: '}' });
    if (ch === '[') starts.push({ idx: i, open: '[', close: ']' });
  }
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start.idx; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === start.open) depth += 1;
      if (ch === start.close) {
        depth -= 1;
        if (depth === 0) return text.slice(start.idx, i + 1);
      }
    }
  }
  return null;
}

export function parseJsonFromAssistantText<T = unknown>(text: string): T {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim()) as T;
    const candidate = extractFirstBalancedJsonCandidate(cleaned);
    if (candidate) return JSON.parse(candidate) as T;
    throw new Error('Assistant returned invalid JSON');
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

export function newAssistantEntityId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Inject synthetic tool_result messages for any dangling tool_use blocks
 * at the end of llmMessages. This prevents the Anthropic API from rejecting
 * the request when a user sends a new message without approving/denying
 * a pending tool call.
 */
export function flushDanglingToolCalls(llmMessages: LlmMessage[]): void {
  if (llmMessages.length === 0) return;
  const last = llmMessages[llmMessages.length - 1];
  if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
    for (const call of last.tool_calls) {
      llmMessages.push({
        role: 'tool',
        content: JSON.stringify({
          skipped: true,
          reason: 'User continued without approving or denying this tool call.'
        }),
        tool_call_id: call.id ?? 'unknown',
        name: call.name
      });
    }
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

export interface AssistantToolCallRequestEnvelope {
  type: 'tool_call_request';
  text: string;
  toolCall: { name: string; arguments?: unknown };
  toolCalls: Array<{ name: string; arguments?: unknown }>;
}

export async function chatWithJsonRetry<T>(params: {
  agent: AgentConfig;
  messages: LlmMessage[];
  tools: ToolDef[];
  system: string;
  parse: (text: string) => T;
  toolCallFallbackText: (toolName: string) => string;
  signal?: AbortSignal;
  invalidJsonRetryPrompt?: string;
}): Promise<T | AssistantToolCallRequestEnvelope> {
  const invalidJsonRetryPrompt =
    params.invalidJsonRetryPrompt ??
    'Your previous response did not match the required assistant envelope. Reply ONLY with one JSON object using exactly one of these types: "assistant_message" with fields {"type":"assistant_message","text":"..."}, or "tool_call_request" with fields {"type":"tool_call_request","text":"...","toolCall":{"name":"PUBLIC_TOOL_NAME","arguments":{}}}. Do not use any other type, such as "message", "assistant", or an event type.';

  const toToolCallRequest = (response: Awaited<ReturnType<typeof chatWithAgent>>) => {
    if (!response.tool_calls || response.tool_calls.length === 0) return null;
    const first = response.tool_calls[0];
    const text = response.content?.trim() || params.toolCallFallbackText(first.name);
    const allCalls = response.tool_calls.map((tc) => ({
      name: tc.name,
      arguments: tc.arguments ?? {}
    }));
    return {
      type: 'tool_call_request' as const,
      text,
      toolCall: {
        name: first.name,
        arguments: first.arguments ?? {}
      },
      toolCalls: allCalls
    };
  };

  let response = await chatWithAgent({
    agent: params.agent,
    messages: params.messages,
    tools: params.tools,
    system: params.system,
    signal: params.signal
  });
  throwIfAborted(params.signal);
  const nativeFirstPass = toToolCallRequest(response);
  if (nativeFirstPass) return nativeFirstPass;

  const rawText = response.content?.trim() ?? '';
  try {
    return params.parse(rawText);
  } catch {
    const retryMessages: LlmMessage[] = [
      ...params.messages,
      { role: 'assistant', content: rawText },
      { role: 'user', content: invalidJsonRetryPrompt }
    ];
    response = await chatWithAgent({
      agent: params.agent,
      messages: retryMessages,
      tools: params.tools,
      system: params.system,
      signal: params.signal
    });
    throwIfAborted(params.signal);
    const nativeRetryPass = toToolCallRequest(response);
    if (nativeRetryPass) return nativeRetryPass;
    return params.parse(response.content?.trim() ?? '');
  }
}

function createAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}
