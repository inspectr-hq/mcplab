import type { MutableRefObject, ReactNode } from "react";
import { PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import {
  AssistantComposer,
  AssistantMessageRow,
  AssistantToolCallCard,
  AssistantTypingIndicator,
  type AssistantSnippet
} from "@/components/assistant/AssistantChat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { ResultAssistantPendingToolCall, ResultAssistantSessionView } from "@/lib/data-sources/types";

export type ResultAssistantSnippet = AssistantSnippet;

export type ResultAssistantMessageRenderContext = {
  message: ResultAssistantSessionView["messages"][number];
  index: number;
  linkedPendingToolCall?: ResultAssistantPendingToolCall;
  isUser: boolean;
  isAssistant: boolean;
  isSystem: boolean;
  isTool: boolean;
};

export function ResultAssistantPanel({
  title,
  description,
  expanded,
  onToggleExpanded,
  onHide,
  messages,
  pendingToolCalls,
  loading,
  input,
  onInputChange,
  onSend,
  inputPlaceholder,
  snippets,
  snippetsLabel = "Result Assistant Snippets",
  onSnippetSelect,
  onApproveToolCall,
  onDenyToolCall,
  chatEndRef,
  inputRef,
  renderMessage,
  renderMessageExtras,
  className = "min-w-0 overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col",
  contentClassName = "flex h-[70vh] min-h-[520px] flex-col p-0 xl:h-auto xl:min-h-0 xl:flex-1"
}: {
  title: string;
  description: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onHide: () => void;
  messages: ResultAssistantSessionView["messages"];
  pendingToolCalls: ResultAssistantPendingToolCall[];
  loading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  inputPlaceholder: string;
  snippets: readonly ResultAssistantSnippet[];
  snippetsLabel?: string;
  onSnippetSelect: (prompt: string) => void;
  onApproveToolCall?: (callId: string) => void;
  onDenyToolCall?: (callId: string) => void;
  chatEndRef: MutableRefObject<HTMLDivElement | null>;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  renderMessage?: (ctx: ResultAssistantMessageRenderContext) => ReactNode;
  renderMessageExtras?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="border-b px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {title}
            </CardTitle>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onToggleExpanded}
              >
                {expanded ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                {expanded ? "Compact" : "Expand"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onHide}
              >
                Hide
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/15 px-4 py-4">
          <div className="space-y-3 pr-2">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              const isAssistant = message.role === "assistant";
              const isSystem = message.role === "system";
              const isTool = message.role === "tool";
              const linkedPendingToolCall = message.pendingToolCallId
                ? pendingToolCalls.find((call) => call.id === message.pendingToolCallId)
                : undefined;

              if (renderMessage) {
                return renderMessage({
                  message,
                  index,
                  linkedPendingToolCall,
                  isUser,
                  isAssistant,
                  isSystem,
                  isTool
                });
              }

              const isAssistantToolRequest = isAssistant && Boolean(message.pendingToolCallId);
              if (isAssistantToolRequest) {
                return (
                  <div key={`${message.id ?? `${message.role}-${index}`}-tool`} className="rounded-md border bg-background p-3">
                    <MarkdownContent text={message.text} className="text-sm" />
                    {linkedPendingToolCall && (
                      <AssistantToolCallCard
                        call={linkedPendingToolCall}
                        loading={loading}
                        onApprove={onApproveToolCall}
                        onDeny={onDenyToolCall}
                        className="mt-3"
                      />
                    )}
                  </div>
                );
              }

              return (
                <AssistantMessageRow
                  key={message.id ?? `${message.role}-${index}`}
                  message={message}
                />
              );
            })}
            {renderMessageExtras}
            {loading && <AssistantTypingIndicator />}
            <div ref={chatEndRef} />
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3">
          <AssistantComposer
            input={input}
            onInputChange={onInputChange}
            onSend={onSend}
            inputPlaceholder={inputPlaceholder}
            snippets={snippets}
            snippetsLabel={snippetsLabel}
            onSnippetSelect={onSnippetSelect}
            loading={loading}
            inputRef={inputRef}
          />
        </div>
      </CardContent>
    </Card>
  );
}
