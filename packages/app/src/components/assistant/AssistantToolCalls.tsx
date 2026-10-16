import { useState, type KeyboardEvent } from 'react';
import {
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  CircleMinus,
  Copy,
  Loader2,
  ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import type { AssistantRuntimeToolCall } from '@/lib/data-sources/types';
import {
  describeToolCall,
  type ToolCallDisplay,
  type ToolCallDisplayTone
} from '@/lib/assistant-tool-call-status';
import {
  toolCallDuration,
  toolCallFields,
  toolCallRisks,
  toolCallSummary,
  toolCallTitle,
  type ToolCallField
} from '@/lib/assistant-tool-display';
import { cn } from '@/lib/utils';

export type AssistantToolCall = AssistantRuntimeToolCall;

/** Fields shown before "Show all"; long values are clipped to a few lines until then. */
const VISIBLE_FIELDS = 5;
const LONG_VALUE_CHARS = 140;

const TONE_ICON_CLASS: Record<ToolCallDisplayTone, string> = {
  attention: 'bg-amber-100 text-amber-800',
  progress: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-red-100 text-red-700'
};

const STATE_ICON: Record<ToolCallDisplay['state'], typeof Check> = {
  awaiting_approval: ShieldAlert,
  running: Loader2,
  completed: Check,
  denied: Ban,
  skipped: CircleMinus,
  cancelled: CircleMinus,
  not_run: CircleMinus,
  outcome_unknown: CircleHelp,
  failed: CircleAlert
};

function ToolStatusIcon({ display }: { display: ToolCallDisplay }) {
  const Icon = STATE_ICON[display.state];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
        TONE_ICON_CLASS[display.tone]
      )}
    >
      <Icon className={cn('h-3 w-3', display.state === 'running' && 'animate-spin')} />
    </span>
  );
}

/**
 * A call that needed the user's approval: the decision while pending, then a one-line record
 * of the outcome that expands to show what was asked.
 */
export function ToolApprovalCard({
  call,
  disabled = false,
  allowEdit = false,
  onApprove,
  onDeny
}: {
  call: AssistantToolCall;
  disabled?: boolean;
  /** Let the user edit the arguments before approving. */
  allowEdit?: boolean;
  /** Called with edited arguments only when the user changed them. */
  onApprove?: (callId: string, argumentsOverride?: unknown) => void;
  onDeny?: (callId: string, message?: string) => void;
}) {
  const display = describeToolCall(call);
  const title = toolCallTitle(call);
  const pending = call.status === 'pending';
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [reason, setReason] = useState('');
  const draftError = editing ? parseArgumentsDraft(draft).error : undefined;

  const approve = () => {
    if (disabled) return;
    if (!editing) return onApprove?.(call.id);
    const parsed = parseArgumentsDraft(draft);
    if (parsed.error) return;
    setEditing(false);
    onApprove?.(call.id, parsed.value);
  };
  const deny = () => {
    if (disabled) return;
    const message = explaining ? reason.trim() : '';
    if (message) onDeny?.(call.id, message);
    else onDeny?.(call.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!pending || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    // A focused Approve or Deny button decides; elsewhere the card's mode does.
    const focused =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-action]')?.dataset.action
        : undefined;
    if ((focused ?? (explaining ? 'deny' : 'approve')) === 'deny') deny();
    else if (!draftError) approve();
  };

  const note =
    call.status === 'denied' && call.denyMessage
      ? `“${call.denyMessage}”`
      : display.state === 'failed'
        ? call.error
        : display.detail;
  const duration = toolCallDuration(call);

  if (!pending)
    return (
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="rounded-md border border-border/60 bg-background px-2.5 py-2"
        aria-label={`${title}: ${display.label}`}
      >
        <CollapsibleTrigger
          className="flex w-full items-center gap-2 text-left"
          aria-label={`${title}, ${display.label.toLowerCase()}. ${expanded ? 'Hide' : 'Show'} what was asked`}
        >
          <ToolStatusIcon display={display} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-medium',
              display.tone === 'neutral' && 'text-muted-foreground'
            )}
            title={call.publicToolName}
          >
            {title}
          </span>
          <span
            className={cn(
              'shrink-0 text-xs text-muted-foreground',
              display.tone === 'danger' && 'font-medium text-red-700'
            )}
          >
            {display.label}
            {duration && <span className="tabular-nums"> · {duration}</span>}
          </span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </CollapsibleTrigger>
        {note && (
          <p
            className={cn(
              'mt-1.5 whitespace-pre-wrap pl-7 text-xs',
              display.state === 'failed' ? 'text-red-700' : 'text-muted-foreground'
            )}
          >
            {note}
          </p>
        )}
        <CollapsibleContent className="space-y-2 pt-2">
          <ToolCallArguments call={call} />
          <ToolCallResult call={call} />
        </CollapsibleContent>
        <output aria-live="polite" className="sr-only">
          {`${title}: ${display.label}`}
        </output>
      </Collapsible>
    );

  const risks = toolCallRisks(call);
  return (
    <div
      role="group"
      aria-label={`Approval needed: ${title}`}
      onKeyDown={onKeyDown}
      className="rounded-md border border-amber-300/70 bg-background px-2.5 py-2 shadow-xs"
    >
      <div className="flex items-start gap-2">
        <ToolStatusIcon display={display} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium" title={call.publicToolName}>
              {title}
            </span>
            {risks.map((risk) => (
              <span
                key={risk.label}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                  risk.tone === 'danger' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'
                )}
              >
                {risk.label}
              </span>
            ))}
          </div>
          {call.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{call.description}</p>
          )}
        </div>
        <span className="shrink-0 text-xs text-amber-800">{display.label}</span>
      </div>

      <div className="mt-2">
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
          <ToolCallArguments call={call} />
        )}
      </div>

      {explaining && (
        <Textarea
          data-role="reason"
          aria-label="Reason for denying"
          placeholder="Tell the assistant why, or what to do instead (optional)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={2000}
          className="mt-2 text-xs"
          autoFocus
        />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {allowEdit && !explaining && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => {
              if (editing) return setEditing(false);
              setDraft(JSON.stringify(call.arguments ?? {}, null, 2));
              setEditing(true);
            }}
          >
            {editing ? 'Discard edits' : 'Edit arguments'}
          </Button>
        )}
        {!editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => setExplaining((open) => !open)}
          >
            {explaining ? 'No reason' : 'Add reason'}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={disabled}
          data-action="deny"
          aria-keyshortcuts={explaining ? 'Meta+Enter Control+Enter' : undefined}
          onClick={deny}
        >
          Deny
        </Button>
        {!explaining && (
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled || Boolean(draftError)}
            data-action="approve"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onClick={approve}
          >
            {editing ? 'Approve with edits' : 'Approve'}
          </Button>
        )}
      </div>
      <output aria-live="polite" className="sr-only">
        {`Approval needed: ${title}`}
      </output>
    </div>
  );
}

/** Calls that ran without asking (read-only and local tools), as compact expandable rows. */
export function ToolActivity({ calls }: { calls: AssistantToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 1) return <ToolActivityRow call={calls[0]!} />;
  const displays = calls.map((call) => describeToolCall(call));
  const running = calls.find((_, index) => !displays[index]!.settled);
  const failed = displays.filter((display) => display.tone === 'danger').length;
  const summary: ToolCallDisplay = running
    ? describeToolCall(running)
    : failed
      ? { state: 'failed', label: '', tone: 'danger', settled: true }
      : { state: 'completed', label: '', tone: 'success', settled: true };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-border/60 bg-background px-2.5 py-1.5"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
        <ToolStatusIcon display={summary} />
        <span className="min-w-0 flex-1 truncate text-sm">
          {running ? `Running ${toolCallTitle(running)}…` : `Used ${calls.length} tools`}
        </span>
        {failed > 0 && <span className="shrink-0 text-xs text-red-700">{failed} failed</span>}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-0.5 border-t border-border/50 pt-1.5">
        {calls.map((call) => (
          <ToolActivityRow key={call.id} call={call} bare />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolActivityRow({ call, bare = false }: { call: AssistantToolCall; bare?: boolean }) {
  const [open, setOpen] = useState(false);
  const display = describeToolCall(call);
  const summary = toolCallSummary(call);
  const duration = toolCallDuration(call);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(!bare && 'rounded-md border border-border/60 bg-background px-2.5 py-1.5')}
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 rounded text-left hover:bg-muted/40"
        aria-label={`${toolCallTitle(call)}, ${display.label.toLowerCase()}`}
      >
        <ToolStatusIcon display={display} />
        <span
          className="max-w-[45%] shrink-0 truncate text-xs font-medium"
          title={call.publicToolName}
        >
          {toolCallTitle(call)}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            display.tone === 'danger' ? 'text-red-700' : 'text-muted-foreground'
          )}
        >
          {summary}
        </span>
        {duration && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration}</span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 py-1.5 pl-7">
        {display.detail && <p className="text-xs text-muted-foreground">{display.detail}</p>}
        <ToolCallArguments call={call} />
        <ToolCallResult call={call} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolCallArguments({ call }: { call: AssistantToolCall }) {
  const fields = toolCallFields(call);
  if (!fields)
    return (
      <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2 text-xs">
        {JSON.stringify(call.arguments ?? null, null, 2)}
      </pre>
    );
  if (!fields.length) return <p className="text-xs text-muted-foreground">No arguments</p>;
  return <FieldList fields={fields} />;
}

function FieldList({ fields }: { fields: ToolCallField[] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = fields.length - VISIBLE_FIELDS;
  const clipped = fields.some((field) => isLong(field.value));
  const visible = showAll || hidden <= 0 ? fields : fields.slice(0, VISIBLE_FIELDS);
  return (
    <div className="overflow-hidden rounded bg-muted/50 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-2.5 py-2">
        {visible.map((field) => (
          <div key={field.key} className="contents">
            <dt className="max-w-32 truncate text-muted-foreground" title={field.key}>
              {field.label}
            </dt>
            <dd
              className={cn(
                'm-0 min-w-0 whitespace-pre-wrap wrap-break-word',
                !showAll && isLong(field.value) && 'line-clamp-3'
              )}
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
      {(hidden > 0 || clipped) && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="flex w-full items-center justify-between border-t border-border/50 px-2.5 py-1 text-left text-muted-foreground hover:bg-muted"
        >
          {showAll ? 'Show less' : hidden > 0 ? `${hidden} more` : 'Show all'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', showAll && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

function ToolCallResult({ call }: { call: AssistantToolCall }) {
  if (call.status !== 'approved' || !call.resultPreview) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(call.resultPreview ?? '');
      toast({ title: 'Copied' });
    } catch (error: unknown) {
      toast({
        title: 'Could not copy',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };
  return (
    <div className="rounded bg-muted/50 text-xs">
      <div className="flex items-center justify-between px-2.5 pt-1.5">
        <span className="font-medium text-muted-foreground">Result</span>
        <button
          type="button"
          aria-label="Copy result"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word px-2.5 pb-2 pt-1">
        {call.resultPreview}
      </pre>
    </div>
  );
}

function isLong(value: string) {
  return value.length > LONG_VALUE_CHARS || value.split('\n').length > 3;
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
