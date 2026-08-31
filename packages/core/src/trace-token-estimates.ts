import { encodingForModel, getEncoding } from 'js-tiktoken';
import type { EstimatedTokens, TraceMessage } from './types.js';

function normalizeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

export function estimateTextTokens(
  text: string,
  model: string
): { count: number; method: EstimatedTokens['method'] } {
  try {
    const encoding = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
    return { count: encoding.encode(text).length, method: 'js_tiktoken_estimate' };
  } catch {
    const encoding = getEncoding('cl100k_base');
    return { count: encoding.encode(text).length, method: 'js_tiktoken_fallback' };
  }
}

function estimateForBlock(inputText: string, outputText: string, model: string): EstimatedTokens {
  const input = estimateTextTokens(inputText, model);
  const output = estimateTextTokens(outputText, model);
  return {
    input: input.count,
    output: output.count,
    total: input.count + output.count,
    method:
      input.method === 'js_tiktoken_estimate' && output.method === 'js_tiktoken_estimate'
        ? 'js_tiktoken_estimate'
        : 'js_tiktoken_fallback'
  };
}

export function enrichTraceMessagesWithEstimatedTokens(
  messages: TraceMessage[],
  model: string
): TraceMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const enriched = messages.map((message) => ({
    ...message,
    content: message.content.map((block) => ({ ...block }))
  }));

  for (let index = 0; index < enriched.length; index += 1) {
    const message = enriched[index];
    if (message.role !== 'assistant') continue;

    const toolUses = message.content.filter(
      (block): block is Extract<TraceMessage['content'][number], { type: 'tool_use' }> =>
        block.type === 'tool_use'
    );
    if (toolUses.length === 0) continue;

    const nextMessage = enriched[index + 1];
    const nextToolBlocks =
      nextMessage?.role === 'tool'
        ? nextMessage.content.filter(
            (block): block is Extract<TraceMessage['content'][number], { type: 'tool_result' }> =>
              block.type === 'tool_result'
          )
        : [];
    const resultByUseId = new Map(
      nextToolBlocks.map((block) => [block.tool_use_id, block] as const)
    );

    for (const use of toolUses) {
      const useInputText = normalizeJson(use.input ?? {});
      const result = resultByUseId.get(use.id);
      const resultText = result
        ? result.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
        : '';
      const estimate = estimateForBlock(useInputText, resultText, model);
      use.estimated_tokens = estimate;
      if (result) result.estimated_tokens = estimate;
    }
  }

  return enriched;
}
