import type { MutableRefObject, ReactNode } from 'react';
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
  renderActions
}: {
  message: AssistantMessage;
  className?: string;
  assistantLabel?: string;
  renderActions?: ReactNode;
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
      <div className={cn('flex w-full min-w-0 items-start gap-2 text-xs', className)}>
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <RectangleEllipsis className="h-3 w-3" />
        </div>
        <div className="w-full min-w-0 max-w-[92%] break-words rounded-md border border-amber-400/30 bg-amber-50/70 p-3 text-sm">
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
        `flex w-full min-w-0 items-start gap-2 text-xs ${isUser ? 'justify-end' : 'justify-start'}`,
        className
      )}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div className={cn('relative min-w-0 max-w-[92%]', isUser ? 'w-auto' : 'w-full')}>
        <div
          className={`min-w-0 max-w-full break-words rounded-md border px-3 py-2 text-sm ${
            isUser ? 'border-primary/20 bg-primary/10' : 'border-border/80 bg-background shadow-sm'
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

export function AssistantToolCallCard({
  call,
  loading = false,
  onApprove,
  onDeny,
  defaultOpen,
  className,
  description
}: {
  call: AssistantToolCall;
  loading?: boolean;
  onApprove?: (callId: string) => void;
  onDeny?: (callId: string) => void;
  defaultOpen?: boolean;
  className?: string;
  description?: string;
}) {
  const isPending = call.status === 'pending';
  const displayToolName = call.tool || call.publicToolName || 'unknown_tool';

  return (
    <details
      open={defaultOpen ?? isPending}
      className={cn(
        'group w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border/60 bg-background',
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
                isPending
                  ? 'bg-amber-100 text-amber-900'
                  : call.status === 'error'
                  ? 'bg-red-100 text-red-900'
                  : call.status === 'denied'
                  ? 'bg-gray-100 text-gray-700'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {isPending
                ? 'Needs approval'
                : call.status === 'error'
                ? 'Error'
                : call.status === 'denied'
                ? 'Denied'
                : 'Approved'}
            </span>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="min-w-0 space-y-2 border-t border-border/50 px-3 py-2">
        {description && (
          <MarkdownContent text={description} variant="assistant" className="text-sm" />
        )}
        <pre className="max-h-40 w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto whitespace-pre rounded border bg-muted/50 p-2 text-xs">
          <code>{JSON.stringify(call.arguments ?? {}, null, 2)}</code>
        </pre>
        {call.error && <p className="text-xs text-destructive">{call.error}</p>}
        {isPending && (
          <div className="mt-2 flex justify-end gap-2">
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
              disabled={loading}
              onClick={() => onApprove?.(call.id)}
            >
              Approve
            </Button>
          </div>
        )}
      </div>
    </details>
  );
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
    <div className="rounded-xl border bg-background p-2 shadow-sm">
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
