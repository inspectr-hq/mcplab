import { useState } from 'react';
import { Bot, CheckCircle2, Wrench, User, XCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CopyButton } from '@/components/CopyButton';
import { MarkdownContent } from '@/components/MarkdownContent';
import { formatTokenCount } from '@/lib/format-duration';
import type { ConversationItem } from '@/types/eval';

export function ConversationRow({
  item,
  fallbackUserPrompt
}: {
  item: ConversationItem;
  fallbackUserPrompt?: string;
}) {
  if (item.kind === 'tool_call') {
    const tokenSuffix = formatEstimatedTokenSuffix(item, 'input');
    return (
      <ToolEventRow
        variant="call"
        title={`Tool call · ${item.toolName || 'unknown'}${tokenSuffix}`}
        text={item.text}
        copyLabel={`tool call ${item.toolName || 'unknown'}`}
      />
    );
  }
  if (item.kind === 'tool_result') {
    const tokenSuffix = formatEstimatedTokenSuffix(item, 'output');
    const statusIcon = item.ok ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-rose-700 dark:text-rose-300" />
    );
    return (
      <ToolEventRow
        variant={item.ok ? 'result_ok' : 'result_error'}
        title={`Tool result · ${item.toolName || 'unknown'} · ${item.ok ? 'ok' : 'error'}${
          typeof item.durationMs === 'number' ? ` · ${item.durationMs}ms` : ''
        }${tokenSuffix}`}
        text={item.text}
        icon={statusIcon}
        copyLabel={`tool result ${item.toolName || 'unknown'}`}
      />
    );
  }

  const isUser = item.kind === 'user_prompt';
  const normalizedItemText = normalizeConversationText(item.text, item.kind);
  const normalizedFallbackUserPrompt = fallbackUserPrompt
    ? normalizeConversationText(fallbackUserPrompt, 'user_prompt')
    : '';
  const displayText =
    isUser && !normalizedItemText && normalizedFallbackUserPrompt
      ? normalizedFallbackUserPrompt
      : normalizedItemText;
  const label = isUser ? 'User prompt' : item.kind === 'assistant_final' ? 'Agent final' : 'Agent';
  const Icon = isUser ? User : Bot;
  return (
    <div className={`flex items-start gap-2 text-xs ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div className={`max-w-[90%] rounded-md p-2 ${isUser ? 'bg-primary/10' : 'bg-muted/50'}`}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p
            className={`text-[11px] font-semibold text-muted-foreground ${isUser ? 'text-right' : ''}`}
          >
            {label}
          </p>
          <CopyButton text={displayText} label={label} iconOnly />
        </div>
        {isUser ? (
          <ExpandableText text={displayText} maxLength={280} className="text-xs" />
        ) : (
          <ExpandableText text={displayText} maxLength={500} className="text-xs" />
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
          <Icon className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

function formatEstimatedTokenSuffix(item: ConversationItem, mode: 'input' | 'output'): string {
  const value =
    mode === 'input' ? item.estimatedTokens?.inputTokens : item.estimatedTokens?.outputTokens;
  if (typeof value !== 'number') return '';
  return ` · ${formatTokenCount(value)} tokens`;
}

function normalizeConversationText(text: string, kind: ConversationItem['kind']): string {
  const raw = String(text ?? '');
  const trimmedStart = raw.replace(/^\s+/, '');
  if (kind === 'user_prompt') {
    return trimmedStart.replace(/^user:\s*/i, '');
  }
  if (kind === 'assistant_final' || kind === 'assistant_thought') {
    return trimmedStart.replace(/^assistant:\s*/i, '');
  }
  return trimmedStart;
}

export function ToolEventRow({
  variant,
  title,
  text,
  icon,
  copyLabel
}: {
  variant: 'call' | 'result_ok' | 'result_error';
  title: string;
  text: string;
  icon?: React.ReactNode;
  copyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const styleByVariant = {
    call: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    result_ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    result_error: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  } as const;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-md border p-2 text-xs ${styleByVariant[variant]}`}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
            >
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                {icon ?? <Wrench className="h-3.5 w-3.5" />}
                <span>{title}</span>
              </div>
              <span className="text-[11px] font-semibold">
                {open ? 'Hide content' : 'Show content'}
              </span>
            </button>
          </CollapsibleTrigger>
          <CopyButton text={text} label={copyLabel} iconOnly />
        </div>
        <CollapsibleContent>
          <p className="mt-2 font-mono whitespace-pre-wrap text-foreground">{text}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ExpandableText({
  text,
  maxLength,
  className
}: {
  text: string;
  maxLength: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxLength;
  const display = expanded || !isLong ? text : `${text.slice(0, maxLength)}...`;

  return (
    <div>
      <MarkdownContent text={display} className={className} />
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}
