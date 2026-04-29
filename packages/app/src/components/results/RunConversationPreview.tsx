import { useState, type ReactNode } from "react";
import { Bot, CheckCircle2, ChevronDown, User, Wrench, XCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { ConversationItem, ScenarioRun } from "@/types/eval";
import { formatTokenCount } from "@/lib/format-duration";

export function RunConversationPreview({
  run,
  fallbackUserPrompt
}: {
  run: ScenarioRun;
  fallbackUserPrompt?: string;
}) {
  const [finalOpen, setFinalOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Collapsible open={finalOpen} onOpenChange={setFinalOpen}>
        <div className="rounded-md border border-muted-foreground/20 bg-card p-2">
          <CollapsibleTrigger asChild>
            <button type="button" className="mb-2 flex w-full items-center justify-between gap-2 text-left">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${finalOpen ? "rotate-180" : ""}`} />
                <Bot className="h-3.5 w-3.5" />
                Final answer
              </p>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ExpandableText
              text={run.finalAnswer || "No final answer captured."}
              maxLength={1200}
              className="text-xs text-foreground"
            />
          </CollapsibleContent>
        </div>
      </Collapsible>
      <Collapsible open={conversationOpen} onOpenChange={setConversationOpen}>
        <div className="rounded-md border border-muted-foreground/20 bg-card p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex min-w-0 items-center gap-2 text-left">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${conversationOpen ? "rotate-180" : ""}`} />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Conversation trace
                </p>
              </button>
            </CollapsibleTrigger>
            <Badge variant="outline" className="h-5 text-[10px]">
              {run.toolCalls.length} tool calls
            </Badge>
          </div>
          <CollapsibleContent>
            <div className="space-y-2 rounded-md border bg-muted/20 p-2">
              {run.conversation.length === 0 ? (
                <p className="text-xs text-muted-foreground">No conversation trace captured.</p>
              ) : (
                run.conversation.map((item) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    fallbackUserPrompt={fallbackUserPrompt}
                  />
                ))
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

function ConversationRow({ item, fallbackUserPrompt }: { item: ConversationItem; fallbackUserPrompt?: string }) {
  if (item.kind === "tool_call") {
    const tokenSuffix = formatEstimatedTokenSuffix(item, "input");
    return (
      <ToolEventRow
        variant="call"
        title={`Tool call · ${item.toolName || "unknown"}${tokenSuffix}`}
        text={item.text}
      />
    );
  }
  if (item.kind === "tool_result") {
    const tokenSuffix = formatEstimatedTokenSuffix(item, "output");
    const statusIcon = item.ok ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-rose-700 dark:text-rose-300" />
    );
    return (
      <ToolEventRow
        variant={item.ok ? "result_ok" : "result_error"}
        title={`Tool result · ${item.toolName || "unknown"} · ${item.ok ? "ok" : "error"}${typeof item.durationMs === "number" ? ` · ${item.durationMs}ms` : ""}${tokenSuffix}`}
        text={item.text}
        icon={statusIcon}
      />
    );
  }

  const isUser = item.kind === "user_prompt";
  const normalizedItemText = normalizeConversationText(item.text, item.kind);
  const normalizedFallbackUserPrompt = fallbackUserPrompt
    ? normalizeConversationText(fallbackUserPrompt, "user_prompt")
    : "";
  const displayText =
    isUser && !normalizedItemText && normalizedFallbackUserPrompt
      ? normalizedFallbackUserPrompt
      : normalizedItemText;
  const label = isUser ? "User prompt" : item.kind === "assistant_final" ? "Agent final" : "Agent";
  const Icon = isUser ? User : Bot;
  return (
    <div className={`flex items-start gap-2 text-xs ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div className={`max-w-[90%] rounded-md p-2 ${isUser ? "bg-primary/10" : "bg-muted/50"}`}>
        <p className={`mb-1 text-[11px] font-semibold text-muted-foreground ${isUser ? "text-right" : ""}`}>
          {label}
        </p>
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

function formatEstimatedTokenSuffix(item: ConversationItem, mode: "input" | "output"): string {
  const value =
    mode === "input" ? item.estimatedTokens?.inputTokens : item.estimatedTokens?.outputTokens;
  if (typeof value !== "number") return "";
  return ` · estimated ${formatTokenCount(value)} tokens`;
}

function normalizeConversationText(text: string, kind: ConversationItem["kind"]): string {
  const raw = String(text ?? "");
  const trimmedStart = raw.replace(/^\s+/, "");
  if (kind === "user_prompt") {
    return trimmedStart.replace(/^user:\s*/i, "");
  }
  if (kind === "assistant_final" || kind === "assistant_thought") {
    return trimmedStart.replace(/^assistant:\s*/i, "");
  }
  return trimmedStart;
}

function ToolEventRow({
  variant,
  title,
  text,
  icon
}: {
  variant: "call" | "result_ok" | "result_error";
  title: string;
  text: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const styleByVariant = {
    call: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    result_ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    result_error: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  } as const;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-md border p-2 text-xs ${styleByVariant[variant]}`}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left">
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              {icon ?? <Wrench className="h-3.5 w-3.5" />}
              <span>{title}</span>
            </div>
            <span className="text-[11px] font-semibold">{open ? "Hide content" : "Show content"}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 font-mono whitespace-pre-wrap text-foreground">{text}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ExpandableText({ text, maxLength, className }: { text: string; maxLength: number; className?: string }) {
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
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
