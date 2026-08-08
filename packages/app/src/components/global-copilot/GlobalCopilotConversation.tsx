import { Copy } from 'lucide-react';
import type { Message, ToolCall, ToolMessage } from '@ag-ui/client';
import { useRenderToolCall } from '@copilotkit/react-core/v2';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AssistantMessageRow,
  AssistantToolCallCard,
  AssistantTypingIndicator
} from '@/components/assistant/AssistantChat';
import { globalCopilotToolDisplayName, globalCopilotToolLabel } from '@/lib/global-copilot-message';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';

export function GlobalCopilotConversation({
  messages,
  rawMessages = [],
  interruptElement,
  loading,
  onCopy
}: {
  messages: GlobalCopilotMessage[];
  rawMessages?: Message[];
  interruptElement?: ReactNode;
  loading: boolean;
  onCopy: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [loading, messages.length]);
  return (
    <ScrollArea className="h-0 min-h-0 w-full min-w-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!w-full [&_[data-radix-scroll-area-viewport]>div]:!min-w-0">
      <div className="w-full min-w-0 space-y-3 p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Ask about results, test cases, or MCPLab.</p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="w-full min-w-0 max-w-full space-y-2">
            {message.role === 'tool' ? (
              <ToolMessage message={message} />
            ) : (
              <AssistantMessageRow
                message={{
                  id: message.id,
                  role: message.role,
                  text: message.content,
                  createdAt: message.createdAt
                }}
                renderActions={
                  message.role === 'assistant' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-1 h-7 w-7"
                      onClick={() => onCopy(message.content)}
                      aria-label="Copy message"
                      title="Copy message"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        ))}
        {rawMessages.length > 0 && <NativeFrontendToolCalls messages={rawMessages} />}
        {interruptElement}
        {loading && <AssistantTypingIndicator />}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

function NativeFrontendToolCalls({ messages }: { messages: Message[] }) {
  const renderToolCall = useRenderToolCall();
  const toolResults = new Map(
    messages
      .filter((message): message is ToolMessage => message.role === 'tool')
      .map((message) => [message.toolCallId, message])
  );
  const calls = messages.flatMap((message) =>
    message.role === 'assistant' ? message.toolCalls ?? [] : []
  );
  return (
    <>
      {calls.map((toolCall: ToolCall) => (
        <div key={toolCall.id}>{renderToolCall({ toolCall, toolMessage: toolResults.get(toolCall.id) })}</div>
      ))}
    </>
  );
}

function ToolMessage({ message }: { message: GlobalCopilotMessage }) {
  const toolName = message.toolName
    ? globalCopilotToolDisplayName(message.toolName)
    : 'mcplab_read';
  return (
    <AssistantToolCallCard
      call={{
        id: message.toolCallId ?? message.id,
        server: 'mcplab',
        tool: globalCopilotToolLabel(toolName),
        publicToolName: toolName,
        arguments: message.toolArguments ?? {},
        status: 'approved',
        createdAt: message.createdAt,
        resultPreview: message.content
      }}
      defaultOpen={false}
      className="w-full min-w-0 max-w-full"
      description={`Read-only MCPLab tool completed.\n\nMCP tool: \`${toolName}\``}
    />
  );
}
