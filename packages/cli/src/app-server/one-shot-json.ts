import type { AgentConfig, LlmMessage, ToolDef } from '@inspectr/mcplab-core';
import { chatWithAgent } from '@inspectr/mcplab-core';
import { throwIfAborted } from './assistant-common.js';

function* extractBalancedJsonCandidates(text: string): Generator<string> {
  const starts: Array<{ idx: number; open: '{' | '['; close: '}' | ']' }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') starts.push({ idx: i, open: '{', close: '}' });
    if (ch === '[') starts.push({ idx: i, open: '[', close: ']' });
  }
  let enclosingCandidateEnd = -1;
  for (const start of starts) {
    if (start.idx <= enclosingCandidateEnd) continue;
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
        if (depth === 0) {
          const candidate = text.slice(start.idx, i + 1);
          try {
            JSON.parse(candidate);
            // Keep complete wrappers, not their nested profile or diagnostic arrays.
            enclosingCandidateEnd = i;
          } catch {
            // An invalid prose fragment may still contain a complete JSON payload.
          }
          yield candidate;
          break;
        }
      }
    }
  }
}

export function extractJsonValuesFromAssistantText(text: string): unknown[] {
  const values: unknown[] = [];
  for (const candidate of extractBalancedJsonCandidates(text)) {
    try {
      values.push(JSON.parse(candidate));
    } catch {
      // Ignore CSS selectors and explanatory prose containing brackets.
    }
  }
  return values;
}

export function parseJsonFromAssistantText<T = unknown>(
  text: string,
  validate?: (value: unknown) => T
): T {
  const cleaned = text.trim();
  let validationError: unknown;
  let validationErrorLength = -1;
  const parseCandidate = (candidate: string): T => {
    const value: unknown = JSON.parse(candidate);
    if (!validate) return value as T;
    try {
      return validate(value);
    } catch (error) {
      // Keep diagnostics from the most complete candidate, not a nested fragment.
      if (candidate.length > validationErrorLength) {
        validationError = error;
        validationErrorLength = candidate.length;
      }
      throw error;
    }
  };
  try {
    return parseCandidate(cleaned);
  } catch {
    const fenced = Array.from(cleaned.matchAll(/```(?:json)?\s*([\s\S]+?)```/gi), (match) =>
      match[1].trim()
    );
    for (const candidates of [fenced, extractBalancedJsonCandidates(cleaned)]) {
      for (const candidate of candidates) {
        try {
          return parseCandidate(candidate);
        } catch {
          // CSS selectors and explanatory prose can contain brackets before the JSON.
        }
      }
    }
    if (validationError) throw validationError;
    throw new Error('Assistant returned invalid JSON');
  }
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

