import { randomUUID } from 'node:crypto';
import type { AgentConfig, LlmMessage, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent } from '@inspectr/mcplab-core';

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
  now = Date.now()
): void {
  for (const [id, session] of sessions) {
    if (now - session.lastTouchedAt > ttlMs) {
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
  message = `Operation timed out after ${timeoutMs}ms`
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promiseFactory(), timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
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

export interface AssistantToolCallRequestEnvelope {
  type: 'tool_call_request';
  text: string;
  toolCall: { name: string; arguments?: unknown };
}

export async function chatWithJsonRetry<T>(params: {
  agent: AgentConfig;
  messages: LlmMessage[];
  tools: ToolDef[];
  system: string;
  parse: (text: string) => T;
  toolCallFallbackText: (toolName: string) => string;
}): Promise<T | AssistantToolCallRequestEnvelope> {
  const invalidJsonRetryPrompt =
    'Your previous response was not valid JSON. Reply ONLY with a valid JSON envelope matching the specified schema.';

  const toToolCallRequest = (response: Awaited<ReturnType<typeof chatWithAgent>>) => {
    if (!response.tool_calls || response.tool_calls.length === 0) return null;
    const [first, ...rest] = response.tool_calls;
    const baseText = response.content?.trim() || params.toolCallFallbackText(first.name);
    const text =
      rest.length > 0
        ? `${baseText}\n\nNote: I requested multiple tool calls, but this UI supports one tool call at a time. Please approve this one first, then I can request the next one if still needed.`
        : baseText;
    return {
      type: 'tool_call_request' as const,
      text,
      toolCall: {
        name: first.name,
        arguments: first.arguments ?? {}
      }
    };
  };

  let response = await chatWithAgent({
    agent: params.agent,
    messages: params.messages,
    tools: params.tools,
    system: params.system
  });
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
      system: params.system
    });
    const nativeRetryPass = toToolCallRequest(response);
    if (nativeRetryPass) return nativeRetryPass;
    return params.parse(response.content?.trim() ?? '');
  }
}
