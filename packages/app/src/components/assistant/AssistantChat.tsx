import { useState, type MutableRefObject, type ReactNode } from 'react';
import {
  Bot,
  ChevronDown,
  Loader2,
  Plus,
  RectangleEllipsis,
  Send,
  Square,
  User,
  Wrench
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from '@/components/MarkdownContent';
import { formatAssistantToolName } from '@/lib/assistant-tool-name';
import { describeToolCall, type ToolCallDisplayTone } from '@/lib/assistant-tool-call-status';
import { cn } from '@/lib/utils';

export type AssistantSnippet = {
  label: string;
  description: string;
  prompt: string;
};

export type AssistantMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt: string;
};

export type AssistantToolCall = {
  id: string;
  server: string;
  tool: string;
  publicToolName: string;
  arguments: unknown;
  status: 'pending' | 'approved' | 'denied' | 'error';
  createdAt: string;
  resultPreview?: string;
  error?: string;
};

export function AssistantMessageRow({
  message,
  className,
  assistantLabel,
  renderActions,
  footer
}: {
  message: AssistantMessage;
  className?: string;
  assistantLabel?: string;
  renderActions?: ReactNode;
  /** Rendered inside the message bubble, below the text. */
  footer?: ReactNode;
}) {
  const role = message.role;

  if (role === 'tool') {
    const trimmed = String(message.text ?? '').trim();
    if (/^(Approved|Denied) tool call\b/i.test(trimmed)) return null;
    return (
      <div
        className={cn(
          'rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm',
          className
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
          <Wrench className="h-3.5 w-3.5" />
          Tool
          <span className="font-normal normal-case text-sky-700/80">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sky-900">{message.text}</p>
      </div>
    );
  }

  if (role === 'system') {
    return (
      <div className={cn('flex items-start gap-2 text-xs', className)}>
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <RectangleEllipsis className="h-3 w-3" />
        </div>
        <div className="max-w-[92%] rounded-md border border-amber-400/30 bg-amber-50/70 p-3 text-sm">
          <MarkdownContent text={message.text} variant="assistant" />
        </div>
      </div>
    );
  }

  const isUser = role === 'user';
  const Icon = isUser ? User : Bot;
  return (
    <div
      className={cn(
        `flex items-start gap-2 text-xs ${isUser ? 'justify-end' : 'justify-start'}`,
        className
      )}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div className="relative max-w-[92%]">
        <div
          className={`max-w-full wrap-break-word rounded-md border px-3 py-2 text-sm ${
            isUser ? 'border-primary/20 bg-primary/10' : 'border-border/80 bg-background shadow-xs'
          }`}
        >
          {!isUser && assistantLabel && (
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{assistantLabel}</p>
          )}
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.text}</p>
          ) : (
            <MarkdownContent text={message.text} variant="assistant" className="text-sm" />
          )}
          {footer}
        </div>
        {renderActions}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
          <User className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

const STATUS_TONE_CLASS: Record<ToolCallDisplayTone, string> = {
  attention: 'bg-amber-100 text-amber-900',
  progress: 'bg-sky-100 text-sky-900',
  success: 'bg-emerald-100 text-emerald-900',
  neutral: 'bg-gray-100 text-gray-700',
  danger: 'bg-red-100 text-red-900'
};

export function AssistantToolCallCard({
  call,
  loading = false,
  onApprove,
  onDeny,
  allowEdit = false,
  defaultOpen,
  className,
  description
}: {
  call: AssistantToolCall;
  loading?: boolean;
  /** Called with edited arguments only when the user changed them. */
  onApprove?: (callId: string, argumentsOverride?: unknown) => void;
  onDeny?: (callId: string) => void;
  /** Let the user edit the arguments before approving. */
  allowEdit?: boolean;
  defaultOpen?: boolean;
  className?: string;
  description?: string;
}) {
  const display = describeToolCall(call);
  const isPending = call.status === 'pending';
  const displayToolName = formatAssistantToolName(call.tool || call.publicToolName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const draftError = editing ? parseArgumentsDraft(draft).error : undefined;

  const startEditing = () => {
    setDraft(JSON.stringify(call.arguments ?? {}, null, 2));
    setEditing(true);
  };
  const approve = () => {
    if (!editing) return onApprove?.(call.id);
    const parsed = parseArgumentsDraft(draft);
    if (parsed.error) return;
    setEditing(false);
    onApprove?.(call.id, parsed.value);
  };

  return (
    <details
      open={defaultOpen ?? isPending}
      className={cn(
        'group overflow-hidden rounded-md border border-border/60 bg-background',
        className
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm font-medium">{`Tool call ${displayToolName}`}</span>
            <span
              className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                STATUS_TONE_CLASS[display.tone]
              }`}
            >
              {display.label}
            </span>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border/50 px-3 py-2">
        {description && (
          <MarkdownContent text={description} variant="assistant" className="text-sm" />
        )}
        {editing ? (
          <div className="space-y-1">
            <Textarea
              aria-label="Edit tool call arguments"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
            {draftError && <p className="text-xs text-destructive">{draftError}</p>}
          </div>
        ) : (
          <pre className="max-h-40 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre rounded border bg-muted/50 p-2 text-xs">
            <code>{JSON.stringify(call.arguments ?? {}, null, 2)}</code>
          </pre>
        )}
        {display.detail && <p className="text-xs text-muted-foreground">{display.detail}</p>}
        {display.state === 'failed' && call.error && (
          <p className="text-xs text-destructive">{call.error}</p>
        )}
        {display.state === 'completed' && call.resultPreview && (
          <details className="rounded border bg-muted/30">
            <summary className="cursor-pointer px-2 py-1 text-xs text-muted-foreground">
              Result
            </summary>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word px-2 pb-2 text-xs">
              {call.resultPreview}
            </pre>
          </details>
        )}
        {isPending && (
          <div className="mt-2 flex justify-end gap-2">
            {allowEdit && !editing && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={loading}
                onClick={startEditing}
              >
                Edit arguments
              </Button>
            )}
            {editing && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setEditing(false)}
              >
                Discard edits
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={loading}
              onClick={() => onDeny?.(call.id)}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={loading || Boolean(draftError)}
              onClick={approve}
            >
              {editing ? 'Approve with edits' : 'Approve'}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function parseArgumentsDraft(draft: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const value: unknown = JSON.parse(draft);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { error: 'Arguments must be a JSON object.' };
    return { value: value as Record<string, unknown> };
  } catch {
    return { error: 'Arguments must be valid JSON.' };
  }
}

export function AssistantTypingIndicator() {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
        <Bot className="h-3 w-3" />
      </div>
      <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Thinking...
      </div>
    </div>
  );
}

export function AssistantSnippetMenu({
  snippets,
  snippetsLabel,
  onSnippetSelect,
  disabled = false,
  contentClassName = 'w-[360px]'
}: {
  snippets: readonly AssistantSnippet[];
  snippetsLabel: string;
  onSnippetSelect: (prompt: string) => void;
  disabled?: boolean;
  contentClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground/80 hover:text-muted-foreground"
          disabled={disabled}
        >
          <Plus className="h-3 w-3" />
          Snippets
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={contentClassName}>
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
              <div className="text-[11px] leading-snug text-muted-foreground">
                {snippet.description}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssistantComposer({
  input,
  onInputChange,
  onSend,
  onCancel,
  inputPlaceholder,
  snippets,
  snippetsLabel,
  onSnippetSelect,
  loading = false,
  disabled = false,
  inputRef,
  snippetContentClassName
}: {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  inputPlaceholder: string;
  snippets: readonly AssistantSnippet[];
  snippetsLabel: string;
  onSnippetSelect: (prompt: string) => void;
  loading?: boolean;
  disabled?: boolean;
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
  snippetContentClassName?: string;
}) {
  const controlsDisabled = disabled || loading;

  return (
    <div className="rounded-xl border bg-background p-2 shadow-xs">
      <Textarea
        ref={inputRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={inputPlaceholder}
        disabled={disabled}
        rows={1}
        className="min-h-10 max-h-40 resize-none border-0 bg-transparent px-2 py-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!controlsDisabled) onSend();
          }
        }}
      />
      <div className="mt-1 flex items-center justify-between gap-2 px-1 pt-1">
        <AssistantSnippetMenu
          snippets={snippets}
          snippetsLabel={snippetsLabel}
          onSnippetSelect={onSnippetSelect}
          disabled={controlsDisabled}
          contentClassName={snippetContentClassName}
        />
        {loading && onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full"
            onClick={onCancel}
            aria-label="Cancel assistant message"
            title="Cancel assistant message"
          >
            <span className="pointer-events-none absolute inset-[2px] rounded-full border border-primary/20 border-t-primary/70 motion-reduce:animate-none animate-[spin_2.2s_linear_infinite]" />
            <span className="pointer-events-none absolute inset-[4px] rounded-full border border-primary/10 motion-reduce:animate-none animate-pulse" />
            <Square className="relative z-10 h-4 w-4" />
          </Button>
        ) : loading ? (
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            disabled
            aria-label="Assistant is loading"
            title="Assistant is loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full pr-0.5"
            onClick={onSend}
            disabled={controlsDisabled || !input.trim()}
            aria-label="Send assistant message"
            title="Send assistant message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
