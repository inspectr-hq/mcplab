import type { MutableRefObject, ReactNode } from "react";
import { Bot, ChevronDown, Loader2, PanelRightClose, PanelRightOpen, Plus, Send, Sparkles, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { ResultAssistantPendingToolCall, ResultAssistantSessionView } from "@/lib/data-sources/types";

export type ResultAssistantSnippet = {
  label: string;
  description: string;
  prompt: string;
};

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
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Wrench className="h-3.5 w-3.5" />
                      {linkedPendingToolCall?.tool ?? message.toolRequestName ?? "tool call"}
                    </div>
                    <MarkdownContent text={message.text} className="text-sm" />
                    {linkedPendingToolCall && (
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={loading}
                          onClick={() => onDenyToolCall?.(linkedPendingToolCall.id)}
                        >
                          Deny
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={loading}
                          onClick={() => onApproveToolCall?.(linkedPendingToolCall.id)}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={message.id ?? `${message.role}-${index}`}
                  className={`flex items-start gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {!isUser && (
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                      <Bot className="h-3 w-3" />
                    </div>
                  )}
                  <div
                    className={`min-w-0 max-w-[92%] break-words rounded-md border p-3 text-sm ${
                      isUser
                        ? "border-primary/20 bg-primary/10"
                        : "border-border/80 bg-background shadow-sm"
                    }`}
                  >
                    <MarkdownContent text={message.text} className="text-sm" />
                  </div>
                  {isUser && (
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                      <User className="h-3 w-3" />
                    </div>
                  )}
                </div>
              );
            })}
            {renderMessageExtras}
            {loading && (
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3">
          <div className="rounded-xl border bg-background p-2 shadow-sm">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={inputPlaceholder}
              rows={1}
              className="min-h-10 max-h-40 resize-none border-0 bg-transparent px-2 py-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading) onSend();
                }
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-2 px-1 pt-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground/80 hover:text-muted-foreground"
                    disabled={loading}
                  >
                    <Plus className="h-3 w-3" />
                    Snippets
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[360px]">
                  <DropdownMenuLabel>{snippetsLabel}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {snippets.map((snippet) => (
                    <DropdownMenuItem
                      key={snippet.label}
                      className="items-start whitespace-normal px-2 py-2"
                      onSelect={() => onSnippetSelect(snippet.prompt)}
                    >
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium leading-tight">{snippet.label}</div>
                        <div className="text-[11px] leading-snug text-muted-foreground">{snippet.description}</div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full"
                onClick={onSend}
                disabled={loading || !input.trim()}
                aria-label="Send assistant message"
                title="Send assistant message"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
