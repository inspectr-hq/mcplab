import type { Message } from '@ag-ui/client';
import type { GlobalCopilotMessage } from './global-copilot-thread-store';

export function globalCopilotToolDisplayName(name: string): string {
  return name.replace(/^mcplab__(?=mcplab_)/, '').replace(/^mcplab_mcplab_/, 'mcplab_');
}

export function globalCopilotToolLabel(name: string): string {
  const toolName = globalCopilotToolDisplayName(name);
  const words = toolName.replace(/^mcplab_/, '').split('_').filter(Boolean);
  return words.length
    ? words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(' ')
    : toolName;
}

export function storedGlobalCopilotMessage(
  message: Message,
  toolCalls: Map<string, { name: string; arguments: Record<string, unknown> }>
): GlobalCopilotMessage | null {
  if (
    !['user', 'assistant', 'tool', 'system'].includes(message.role) ||
    typeof message.content !== 'string' ||
    (message.role === 'assistant' && !message.content.trim())
  ) {
    return null;
  }
  const toolCallId = (message as Message & { toolCallId?: string }).toolCallId;
  const toolCall = toolCallId ? toolCalls.get(toolCallId) : undefined;
  return {
    id: message.id,
    role: message.role as GlobalCopilotMessage['role'],
    content: message.content,
    createdAt: new Date().toISOString(),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolCall
      ? { toolName: globalCopilotToolDisplayName(toolCall.name), toolArguments: toolCall.arguments }
      : {})
  };
}
