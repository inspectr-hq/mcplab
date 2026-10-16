import type {
  AssistantReasoning,
  AssistantRuntimeSnapshot,
  AssistantSessionEvent
} from '@/lib/data-sources/types';

export type AssistantStreamingMessage = NonNullable<AssistantRuntimeSnapshot['streamingMessage']>;

type AssistantMessageLike = {
  id?: string;
  role: string;
  text: string;
  createdAt: string;
  reasoning?: AssistantReasoning;
};

type AssistantDeltaEvent = Extract<
  AssistantSessionEvent,
  { type: 'assistant_message_delta' | 'assistant_reasoning_delta' }
>;

export type AssistantMessageDelta = AssistantDeltaEvent['payload'];

/** Applies an answer or reasoning delta; out-of-order or stale deltas leave the message as is. */
export function applyAssistantMessageDelta<TMessage extends AssistantMessageLike>(params: {
  messages: TMessage[];
  activeTurnId?: string;
  streamingMessage?: AssistantStreamingMessage;
  delta: AssistantMessageDelta;
  kind?: 'text' | 'reasoning';
}): AssistantStreamingMessage | undefined {
  const { messages, activeTurnId, streamingMessage, delta, kind = 'text' } = params;
  if (activeTurnId !== delta.turnId || messages.some((message) => message.id === delta.messageId)) {
    return streamingMessage;
  }
  const current =
    streamingMessage?.id === delta.messageId
      ? streamingMessage
      : { id: delta.messageId, turnId: delta.turnId, text: '', createdAt: delta.createdAt };
  if (current.turnId !== delta.turnId) return streamingMessage;

  if (kind === 'reasoning') {
    const reasoning = current.reasoning ?? { text: '' };
    if (delta.offset !== reasoning.text.length) return streamingMessage;
    return { ...current, reasoning: { ...reasoning, text: reasoning.text + delta.delta } };
  }
  if (delta.offset !== current.text.length) return streamingMessage;
  const reasoning = current.reasoning;
  return {
    ...current,
    text: current.text + delta.delta,
    // Answer text means reasoning has finished; the snapshot brings the exact duration.
    ...(reasoning && reasoning.durationMs === undefined
      ? { reasoning: { ...reasoning, durationMs: Date.now() - Date.parse(current.createdAt) } }
      : {})
  };
}

export function assistantMessagesWithStreaming<TMessage extends AssistantMessageLike>(
  messages: TMessage[],
  streamingMessage?: AssistantStreamingMessage
): TMessage[] {
  if (!streamingMessage || messages.some((message) => message.id === streamingMessage.id)) {
    return messages;
  }
  return [
    ...messages,
    {
      id: streamingMessage.id,
      role: 'assistant' as const,
      text: streamingMessage.text,
      createdAt: streamingMessage.createdAt,
      ...(streamingMessage.reasoning ? { reasoning: streamingMessage.reasoning } : {})
    } as TMessage
  ];
}

export function shouldUseAssistantSession<
  TSession extends {
    id?: string;
    revision: number;
    messages: Array<{ id?: string }>;
  }
>(current: TSession | null, next: TSession): boolean {
  if (!current || current.id !== next.id) return true;
  return next.revision > current.revision;
}

export function isAssistantMessageDelta<TSession>(
  event: AssistantSessionEvent<TSession>
): event is Extract<
  AssistantSessionEvent<TSession>,
  { type: 'assistant_message_delta' | 'assistant_reasoning_delta' }
> {
  return event.type === 'assistant_message_delta' || event.type === 'assistant_reasoning_delta';
}
