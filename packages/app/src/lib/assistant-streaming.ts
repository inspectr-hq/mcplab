import type { AssistantRuntimeSnapshot, AssistantSessionEvent } from '@/lib/data-sources/types';

export type AssistantStreamingMessage = NonNullable<AssistantRuntimeSnapshot['streamingMessage']>;

type AssistantMessageLike = {
  id?: string;
  role: string;
  text: string;
  createdAt: string;
};

export type AssistantMessageDelta = Extract<
  AssistantSessionEvent,
  { type: 'assistant_message_delta' }
>['payload'];

export function applyAssistantMessageDelta<TMessage extends AssistantMessageLike>(params: {
  messages: TMessage[];
  activeTurnId?: string;
  streamingMessage?: AssistantStreamingMessage;
  delta: AssistantMessageDelta;
}): AssistantStreamingMessage | undefined {
  const { messages, activeTurnId, streamingMessage, delta } = params;
  if (activeTurnId !== delta.turnId || messages.some((message) => message.id === delta.messageId)) {
    return streamingMessage;
  }

  if (!streamingMessage || streamingMessage.id !== delta.messageId) {
    if (delta.offset !== 0) return streamingMessage;
    return {
      id: delta.messageId,
      turnId: delta.turnId,
      text: delta.delta,
      createdAt: delta.createdAt
    };
  }

  if (streamingMessage.turnId !== delta.turnId || delta.offset !== streamingMessage.text.length) {
    return streamingMessage;
  }

  return { ...streamingMessage, text: streamingMessage.text + delta.delta };
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
      createdAt: streamingMessage.createdAt
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
): event is Extract<AssistantSessionEvent<TSession>, { type: 'assistant_message_delta' }> {
  return event.type === 'assistant_message_delta';
}
