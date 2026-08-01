import { Copy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AssistantMessageRow,
  AssistantToolCallCard,
  AssistantTypingIndicator
} from '@/components/assistant/AssistantChat';
import { globalCopilotToolDisplayName, globalCopilotToolLabel } from '@/lib/global-copilot-message';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';
import { GlobalCopilotActionCard } from './GlobalCopilotActionCard';

export function GlobalCopilotConversation({
  messages,
  loading,
  onCopy,
  ...actions
}: {
  messages: GlobalCopilotMessage[];
  loading: boolean;
  onCopy: (text: string) => void;
  onContinue: (message: GlobalCopilotMessage, approved: boolean) => void;
  onOpenResult: (message: GlobalCopilotMessage) => void;
  onRunEvaluation: (message: GlobalCopilotMessage, approved: boolean) => void;
  onWriteReport: (message: GlobalCopilotMessage, approved: boolean) => void;
  onExternalTool: (message: GlobalCopilotMessage, approved: boolean) => void;
  onStartAction: (message: GlobalCopilotMessage, approved: boolean) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [loading, messages.length]);
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Ask about results, test cases, or MCPLab.</p>
        )}
        {messages.map((message) =>
          message.role === 'system' &&
          message.content.startsWith('Previously retrieved tool data:') ? null : (
            <div key={message.id} className="space-y-2">
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
              <GlobalCopilotActionCard message={message} {...actions} />
            </div>
          )
        )}
        {loading && <AssistantTypingIndicator />}
        <div ref={endRef} />
      </div>
    </ScrollArea>
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
      description={`Read-only MCPLab tool completed.\n\nMCP tool: \`${toolName}\``}
    />
  );
}
