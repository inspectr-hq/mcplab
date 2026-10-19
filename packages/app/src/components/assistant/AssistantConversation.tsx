import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/MarkdownContent';
import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';
import {
  AssistantComposer,
  AssistantMessageRow,
  AssistantTypingIndicator,
  type AssistantMessage,
  type AssistantToolCall
} from './AssistantChat';
import { AssistantReasoning } from './AssistantReasoning';
import { ToolActivity, ToolApprovalCard } from './AssistantToolCalls';

export type ConversationMessage = AssistantMessage & {
  id?: string;
  pendingToolCallId?: string;
  pendingToolCallIds?: string[];
};

/** How close to the bottom still counts as "following" the conversation. */
const FOLLOW_THRESHOLD_PX = 48;

/**
 * The conversation both assistants share: messages (including the streamed one), tool-call
 * cards with approvals, status notices and the composer. Assistant-specific content goes in
 * the slots; state and actions come from useAssistantSession.
 */
export function AssistantConversation<TMessage extends ConversationMessage>({
  messages,
  toolCalls,
  busy,
  starting = false,
  expired = false,
  onApprove,
  onDeny,
  onApproveAll,
  allowEditArguments = true,
  renderMessageFooter,
  renderMessageAddon,
  notices,
  composer,
  className,
  scrollClassName,
  composerClassName
}: {
  messages: TMessage[];
  toolCalls: AssistantToolCall[];
  busy: boolean;
  starting?: boolean;
  expired?: boolean;
  onApprove?: (callId: string, argumentsOverride?: unknown) => void;
  onDeny?: (callId: string, message?: string) => void;
  onApproveAll?: () => void;
  allowEditArguments?: boolean;
  /** Actions inside a user or assistant message bubble (not tool requests). */
  renderMessageFooter?: (message: TMessage) => ReactNode;
  /** Content after a message, such as structured suggestions. */
  renderMessageAddon?: (message: TMessage) => ReactNode;
  /** Shown above the messages, e.g. setup warnings. */
  notices?: ReactNode;
  composer: ComponentProps<typeof AssistantComposer>;
  className?: string;
  scrollClassName?: string;
  composerClassName?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const last = messages.at(-1);

  // Follow new output unless the user scrolled up to read earlier messages.
  useEffect(() => {
    if (!followRef.current) return;
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length, last?.text, last?.reasoning?.text, toolCalls.length, busy]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
  };

  // Tool results are shown on their call (row or approval card), so the raw message would repeat them.
  const visibleMessages = messages.filter((message) => message.role !== 'tool');
  const referencedCallIds = new Set(messages.flatMap((message) => toolCallIdsOf(message)));
  const unreferencedPending = toolCalls.filter(
    (call) => call.status === 'pending' && !referencedCallIds.has(call.id)
  );
  const decisionsDisabled = busy || expired;
  // The reasoning block shows the model is working; a second indicator would repeat it.
  const reasoningInProgress =
    last?.role === 'assistant' &&
    last.reasoning !== undefined &&
    last.reasoning.durationMs === undefined;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn('min-h-0 flex-1 overflow-y-auto', scrollClassName)}
      >
        <div className="space-y-3 pr-2">
          {notices}
          {visibleMessages.map((message, index) => {
            const key = message.id ?? `${message.role}-${index}`;
            const callIds = toolCallIdsOf(message);
            const body =
              message.role === 'assistant' && callIds.length > 0 ? (
                <ToolRequest
                  message={message}
                  calls={callIds
                    .map((id) => toolCalls.find((call) => call.id === id))
                    .filter((call): call is AssistantToolCall => Boolean(call))}
                  disabled={decisionsDisabled}
                  allowEdit={allowEditArguments}
                  onApprove={onApprove}
                  onDeny={onDeny}
                  onApproveAll={onApproveAll}
                />
              ) : (
                <AssistantMessageRow
                  message={message}
                  assistantLabel={message.role === 'assistant' ? 'Assistant' : undefined}
                  header={
                    message.role === 'assistant' && message.reasoning ? (
                      <AssistantReasoning reasoning={message.reasoning} />
                    ) : undefined
                  }
                  footer={renderMessageFooter?.(message)}
                  renderActions={
                    message.role === 'user' || message.role === 'assistant' ? (
                      <CopyMessageButton text={message.text} alignLeft={message.role === 'user'} />
                    ) : undefined
                  }
                />
              );
            return (
              <div key={key} className="space-y-2">
                {body}
                {renderMessageAddon?.(message)}
              </div>
            );
          })}
          {unreferencedPending.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pending actions
              </div>
              {unreferencedPending.map((call) => (
                <ToolApprovalCard
                  key={call.id}
                  call={call}
                  disabled={decisionsDisabled}
                  allowEdit={allowEditArguments}
                  onApprove={onApprove}
                  onDeny={onDeny}
                />
              ))}
            </div>
          )}
          {expired && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This assistant session has expired. Send a new message to start a new session.
            </div>
          )}
          {starting && messages.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting assistant session...
            </div>
          )}
          {busy && !starting && !reasoningInProgress && <AssistantTypingIndicator />}
          <div ref={endRef} />
        </div>
      </div>
      <div className={cn('pt-3', composerClassName)}>
        <AssistantComposer {...composer} />
      </div>
    </div>
  );
}

function ToolRequest({
  message,
  calls,
  disabled,
  allowEdit,
  onApprove,
  onDeny,
  onApproveAll
}: {
  message: ConversationMessage;
  calls: AssistantToolCall[];
  disabled: boolean;
  allowEdit: boolean;
  onApprove?: (callId: string, argumentsOverride?: unknown) => void;
  onDeny?: (callId: string, message?: string) => void;
  onApproveAll?: () => void;
}) {
  // Calls that ran without asking are activity; the rest are decisions with a lasting record.
  const automatic = calls.filter((call) => call.requiresApproval === false);
  const decisions = calls.filter((call) => call.requiresApproval !== false);
  const pendingCount = decisions.filter((call) => call.status === 'pending').length;
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
        <Bot className="h-3 w-3" />
      </div>
      <div className="w-full min-w-0 max-w-[92%] space-y-2">
        {message.reasoning && <AssistantReasoning reasoning={message.reasoning} />}
        {message.text && <MarkdownContent text={message.text} className="text-sm" />}
        {automatic.length > 0 && <ToolActivity calls={automatic} />}
        {onApproveAll && decisions.length > 1 && pendingCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-1.5">
            <span className="text-xs text-amber-900">
              {decisions.length - pendingCount} of {decisions.length} tool calls resolved
            </span>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={disabled}
              onClick={onApproveAll}
            >
              Approve All ({pendingCount})
            </Button>
          </div>
        )}
        {decisions.map((call) => (
          <ToolApprovalCard
            key={call.id}
            call={call}
            disabled={disabled}
            allowEdit={allowEdit}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </div>
    </div>
  );
}

function CopyMessageButton({ text, alignLeft }: { text: string; alignLeft: boolean }) {
  return (
    <CopyButton
      text={text}
      label="message"
      iconOnly
      className={`absolute bottom-1 h-6 w-6 text-muted-foreground ${alignLeft ? '-left-8' : '-right-8'}`}
    />
  );
}

function toolCallIdsOf(message: ConversationMessage): string[] {
  return (
    message.pendingToolCallIds ?? (message.pendingToolCallId ? [message.pendingToolCallId] : [])
  );
}
