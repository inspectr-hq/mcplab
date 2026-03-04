import { Fragment, useEffect, useState, useRef } from "react";
import { Bot, ChevronDown, CheckCircle2, Copy, Loader2, Minimize2, Plus, RectangleEllipsis, Send, Sparkles, User, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AgentConfig, EvalRule, Scenario, ServerConfig } from "@/types/eval";
import type {
  ScenarioAssistantSessionView,
  ScenarioAssistantSuggestionBundle
} from "@/lib/data-sources/types";

const SCENARIO_ASSISTANT_SNIPPETS = [
  {
    label: "Suggest Checks",
    description: "Propose stronger evaluation checks for this scenario.",
    prompt: "Suggest checks"
  },
  {
    label: "Suggest Value Capture Rules",
    description: "Recommend extract/value capture rules for key outputs.",
    prompt: "Suggest value capture rules"
  },
  {
    label: "Improve Prompt Determinism",
    description: "Reduce ambiguity and improve reproducibility.",
    prompt: "Improve prompt determinism"
  },
  {
    label: "Explain Snapshot Drift Risk",
    description: "Assess likely causes of drift and stabilization options.",
    prompt: "Explain snapshot drift risk"
  },
  {
    label: "Generate Scenario Draft",
    description: "Create a draft scenario from the current context.",
    prompt: "Generate scenario draft"
  }
] as const;

interface ScenarioAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId?: string;
  configPath?: string;
  scenario: Scenario;
  agents: AgentConfig[];
  servers: ServerConfig[];
  snapshotEval?: {
    enabled: boolean;
    mode: "warn" | "fail_on_drift";
    baselineSnapshotId?: string;
  };
  defaultAssistantAgentName?: string;
  initialUserMessage?: string;
  onApplyPatch: (patch: {
    prompt?: string;
    evalRules?: Scenario["evalRules"];
    extractRules?: Scenario["extractRules"];
    snapshotEval?: Partial<NonNullable<Scenario["snapshotEval"]>>;
  }) => void;
}

export function ScenarioAssistantDialog({
  open,
  onOpenChange,
  configId,
  configPath,
  scenario,
  agents,
  servers,
  snapshotEval,
  defaultAssistantAgentName,
  initialUserMessage,
  onApplyPatch
}: ScenarioAssistantDialogProps) {
  const { source } = useDataSource();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<ScenarioAssistantSessionView | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [appliedSuggestionKeys, setAppliedSuggestionKeys] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const initialMessageSentRef = useRef<string | null>(null);
  const [preserveSessionOnClose, setPreserveSessionOnClose] = useState(false);
  const preserveSessionOnCloseRef = useRef(false);
  const resolvedAssistantAgentName =
    defaultAssistantAgentName || agents[0]?.name || agents[0]?.id || "";

  useEffect(() => {
    if (!open) return;
    if (!resolvedAssistantAgentName || sessionId) return;
    let cancelled = false;
    setLoading(true);
    source
      .createScenarioAssistantSession({
        configId,
        configPath,
        scenarioId: scenario.id,
        selectedAssistantAgentName: resolvedAssistantAgentName,
        context: {
          configSnapshotPolicy: snapshotEval
            ? {
                enabled: snapshotEval.enabled,
                mode: snapshotEval.mode,
                baselineSnapshotId: snapshotEval.baselineSnapshotId
              }
            : undefined,
          scenario: {
            id: scenario.id,
            name: scenario.name,
            prompt: scenario.prompt,
            serverNames: scenario.serverIds,
            evalRules: scenario.evalRules,
            extractRules: scenario.extractRules,
            snapshotEval: scenario.snapshotEval
              ? {
                  enabled: scenario.snapshotEval.enabled,
                  baselineSnapshotId: scenario.snapshotEval.baselineSnapshotId
                }
              : undefined
          },
          availableServers: servers.map((server) => ({ name: server.name || server.id, url: server.url })),
          availableAgents: agents.map((agent) => ({
            name: agent.name || agent.id,
            provider: agent.provider,
            model: agent.model
          }))
        }
      })
      .then((resp) => {
        if (cancelled) return;
        setSessionId(resp.sessionId);
        setSession(resp.session);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          title: "Could not start Scenario Assistant",
          description: (error instanceof Error ? error.message : String(error)),
          variant: "destructive"
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    source,
    sessionId,
    configId,
    configPath,
    scenario,
    snapshotEval,
    agents,
    servers,
    resolvedAssistantAgentName
  ]);

  const resetLocalSessionState = () => {
    setSessionId(null);
    setSession(null);
    setInput("");
    setAppliedSuggestionKeys(new Set());
    initialMessageSentRef.current = null;
  };

  const closeScenarioAssistantSession = (id: string) => {
    resetLocalSessionState();
    void source.closeScenarioAssistantSession(id).catch(() => {});
  };

  useEffect(() => {
    if (open) return;
    if (!sessionId) return;
    if (preserveSessionOnCloseRef.current || preserveSessionOnClose) return;
    closeScenarioAssistantSession(sessionId);
  }, [open, sessionId, source, preserveSessionOnClose]);

  useEffect(() => {
    return () => {
      if (sessionId) {
        void source.closeScenarioAssistantSession(sessionId).catch(() => {});
      }
    };
  }, [sessionId, source]);

  useEffect(() => {
    if (!open) return;
    if (preserveSessionOnClose) {
      setPreserveSessionOnClose(false);
    }
    if (preserveSessionOnCloseRef.current) {
      preserveSessionOnCloseRef.current = false;
    }
    const timeout = window.setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    open,
    loading,
    session?.messages.length,
    session?.pendingToolCalls.length,
    session?.warnings.length
  ]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [input, open]);

  const canUseAssistant =
    agents.length > 0 && scenario.serverIds.length > 0 && Boolean(resolvedAssistantAgentName);

  const sendMessage = async (message: string) => {
    if (!sessionId) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    const optimisticMessageId = `msg-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage: ScenarioAssistantSessionView["messages"][number] = {
      id: optimisticMessageId,
      role: "user",
      text: trimmed,
      createdAt: new Date().toISOString()
    };
    setSession((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, optimisticMessage]
          }
        : prev
    );
    setInput("");
    setLoading(true);
    try {
      const resp = await source.sendScenarioAssistantMessage(sessionId, trimmed);
      setSession(resp.session);
    } catch (error: unknown) {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== optimisticMessageId)
            }
          : prev
      );
      setInput((prev) => (prev.trim() ? prev : trimmed));
      toast({
        title: "Scenario Assistant error",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const applyScenarioSnippet = (snippet: string) => {
    setInput(snippet);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (!open || !sessionId || !session) return;
    if (!canUseAssistant || loading) return;
    const handoffMessage = String(initialUserMessage ?? "").trim();
    if (!handoffMessage) return;
    if (initialMessageSentRef.current === handoffMessage) return;
    initialMessageSentRef.current = handoffMessage;
    void sendMessage(handoffMessage);
  }, [open, sessionId, session, canUseAssistant, loading, initialUserMessage]);

  const handleApprove = async (callId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await source.approveScenarioAssistantToolCall(sessionId, callId);
      setSession(resp.session);
    } catch (error: unknown) {
      toast({
        title: "Tool call failed",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async (callId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await source.denyScenarioAssistantToolCall(sessionId, callId);
      setSession(resp.session);
    } catch (error: unknown) {
      toast({
        title: "Could not deny tool call",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const applySuggestions = (
    messageId: string | undefined,
    suggestions: ScenarioAssistantSuggestionBundle | undefined,
    key: "prompt" | "evalRules" | "extractRules" | "snapshotEval"
  ) => {
    if (!suggestions) return;
    if (key === "prompt" && suggestions.prompt) {
      onApplyPatch({ prompt: suggestions.prompt.replacement });
    }
    if (key === "evalRules" && suggestions.evalRules) {
      onApplyPatch({ evalRules: suggestions.evalRules.replacement as Array<{ type: EvalRule["type"]; value: string }> });
    }
    if (key === "extractRules" && suggestions.extractRules) {
      onApplyPatch({ extractRules: suggestions.extractRules.replacement });
    }
    if (key === "snapshotEval" && suggestions.snapshotEval) {
      onApplyPatch({
        snapshotEval: {
          enabled: suggestions.snapshotEval.patch.enabled,
          baselineSnapshotId: suggestions.snapshotEval.patch.baselineSnapshotId
        }
      });
    }
    if (messageId) {
      const composite = `${messageId}:${key}`;
      setAppliedSuggestionKeys((prev) => new Set([...prev, composite]));
    }
    const labelByKey: Record<typeof key, string> = {
      prompt: "Prompt",
      evalRules: "Checks",
      extractRules: "Value Capture Rules",
      snapshotEval: "Snapshot Settings",
    };
    toast({ title: "Applied suggestion", description: `Updated ${labelByKey[key]}` });
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPreserveSessionOnClose(false);
      preserveSessionOnCloseRef.current = false;
    }
    onOpenChange(nextOpen);
  };

  const handleMinimize = () => {
    preserveSessionOnCloseRef.current = true;
    setPreserveSessionOnClose(true);
    onOpenChange(false);
  };

  const handleDiscardMinimizedSession = () => {
    preserveSessionOnCloseRef.current = false;
    setPreserveSessionOnClose(false);
    if (sessionId) closeScenarioAssistantSession(sessionId);
  };

  return (
    <>
      {!open && sessionId && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Scenario Assistant (session active)</p>
            <p className="truncate text-xs text-muted-foreground">
              Resume conversation for <span className="font-mono">{scenario.id}</span>
              {session ? ` · ${session.messages.length} messages` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(true)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Resume
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-muted-foreground"
              onClick={handleDiscardMinimizedSession}
              aria-label="Discard assistant session"
              title="Discard assistant session"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col">
        {sessionId && (
          <button
            type="button"
            className="absolute right-12 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            onClick={handleMinimize}
            aria-label="Minimize assistant"
            title="Minimize assistant"
          >
            <Minimize2 className="h-4 w-4" />
            <span className="sr-only">Minimize</span>
          </button>
        )}
        <DialogHeader className="pr-20">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Scenario Assistant
              </DialogTitle>
              <DialogDescription>
                LLM-guided scenario authoring with MCP tool introspection and per-tool-call approval.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!canUseAssistant ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            Scenario Assistant requires a configured assistant agent and at least one selected server on the scenario.
          </div>
        ) : (
          <div className="min-h-0 flex flex-1 flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">MCP Context</Label>
                  <div className="h-8 rounded-md border px-2 text-xs flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5" />
                    {session ? `Loaded ${session.toolsLoaded} tools` : "Preparing..."}
                  </div>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1 rounded-md border p-3">
                <div className="space-y-3">
                  {session?.warnings?.map((warning, index) => (
                    <div key={`${warning}-${index}`} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {warning}
                    </div>
                  ))}
                  {session?.messages.map((message) => (
                    <Fragment key={message.id}>
                      {(() => {
                        const linkedPendingToolCall = message.pendingToolCallId
                          ? (session?.pendingToolCalls ?? []).find((call) => call.id === message.pendingToolCallId)
                          : undefined;
                        const isAssistantToolRequest =
                          message.role === "assistant" && Boolean(message.pendingToolCallId);
                        if (!isAssistantToolRequest) {
                          return (
                            <div className="space-y-2">
                              <AssistantChatMessageRow message={message} />
                            </div>
                          );
                        }
                        const fallbackToolNameFromText =
                          message.text.match(/I need to call ['"]([^'"]+)['"]/i)?.[1]?.replace(/^.*__/, "") ??
                          undefined;
                        const toolName =
                          linkedPendingToolCall?.tool ?? message.toolRequestName ?? fallbackToolNameFromText;
                        const publicToolName =
                          linkedPendingToolCall?.publicToolName ?? message.toolRequestPublicName;
                        const displayToolName = toolName ?? publicToolName ?? "unknown_tool";
                        return (
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                              <Bot className="h-3 w-3" />
                            </div>
                            <details
                              open={Boolean(linkedPendingToolCall)}
                              className="group w-full max-w-[92%] rounded-md border border-border/60 bg-background"
                            >
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium">{`Tool call ${displayToolName}`}</span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        linkedPendingToolCall
                                          ? "bg-amber-100 text-amber-900"
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {linkedPendingToolCall ? "Needs approval" : "Completed"}
                                    </span>
                                  </div>
                                </div>
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                              </summary>
                              <div className="space-y-2 border-t border-border/50 px-3 py-2">
                                <MarkdownContent text={message.text} variant="assistant" />
                                {linkedPendingToolCall && (
                                  <>
                                    <pre className="max-h-40 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre rounded border bg-muted/50 p-2 text-xs">
                                      <code>{JSON.stringify(linkedPendingToolCall.arguments ?? {}, null, 2)}</code>
                                    </pre>
                                    <div className="mt-2 flex justify-end gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        disabled={loading}
                                        onClick={() => void handleDeny(linkedPendingToolCall.id)}
                                      >
                                        Deny
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        disabled={loading}
                                        onClick={() => void handleApprove(linkedPendingToolCall.id)}
                                      >
                                        Approve
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </details>
                          </div>
                        );
                      })()}
                      {message.suggestions && (
                        <div className="ml-0 space-y-3 rounded-md border border-dashed bg-muted/10 p-3">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Sparkles className="h-3.5 w-3.5" />
                            Structured Suggestions
                          </div>
                          {message.suggestions.prompt && (
                            <SuggestionCard
                              title="Prompt"
                              rationale={message.suggestions.prompt.rationale}
                              preview={message.suggestions.prompt.replacement}
                              applied={appliedSuggestionKeys.has(`${message.id}:prompt`)}
                              onApply={() => applySuggestions(message.id, message.suggestions, "prompt")}
                            />
                          )}
                          {message.suggestions.evalRules && (
                            <SuggestionCard
                              title="Checks"
                              rationale={message.suggestions.evalRules.rationale}
                              preview={JSON.stringify(message.suggestions.evalRules.replacement, null, 2)}
                              applied={appliedSuggestionKeys.has(`${message.id}:evalRules`)}
                              onApply={() => applySuggestions(message.id, message.suggestions, "evalRules")}
                            />
                          )}
                          {message.suggestions.extractRules && (
                            <SuggestionCard
                              title="Value Capture Rules"
                              rationale={message.suggestions.extractRules.rationale}
                              preview={JSON.stringify(message.suggestions.extractRules.replacement, null, 2)}
                              applied={appliedSuggestionKeys.has(`${message.id}:extractRules`)}
                              onApply={() => applySuggestions(message.id, message.suggestions, "extractRules")}
                            />
                          )}
                          {message.suggestions.snapshotEval && (
                            <SuggestionCard
                              title="Snapshot Settings"
                              rationale={message.suggestions.snapshotEval.rationale}
                              preview={JSON.stringify(message.suggestions.snapshotEval.patch, null, 2)}
                              applied={appliedSuggestionKeys.has(`${message.id}:snapshotEval`)}
                              onApply={() => applySuggestions(message.id, message.suggestions, "snapshotEval")}
                            />
                          )}
                          {(() => {
                            const rawNotes = message.suggestions?.notes;
                            const notes = Array.isArray(rawNotes)
                              ? rawNotes
                              : typeof rawNotes === "string"
                                ? [rawNotes]
                                : [];
                            if (notes.length === 0) return null;
                            return (
                            <div className="space-y-2 rounded-md border p-3">
                              <h5 className="text-sm font-medium">Notes</h5>
                              <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                                {notes.map((note, index) => (
                                  <li key={`${message.id}-note-${index}`}>{note}</li>
                                ))}
                              </ul>
                            </div>
                            );
                          })()}
                        </div>
                      )}
                    </Fragment>
                  ))}
                  {(session?.pendingToolCalls ?? [])
                    .filter((call) => !(session?.messages ?? []).some((m) => m.pendingToolCallId === call.id))
                    .map((call) => (
                    <details key={call.id} open className="group min-w-0 rounded-md border bg-background">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <p className="min-w-0 truncate font-mono text-xs font-semibold">
                              {call.publicToolName || call.tool}
                            </p>
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                              Needs approval
                            </span>
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-t px-3 pb-3 pt-2">
                        <pre className="max-h-40 w-full max-w-full overflow-x-auto overflow-y-auto whitespace-pre rounded border bg-muted/50 p-2 text-xs">
                          <code>{JSON.stringify(call.arguments ?? {}, null, 2)}</code>
                        </pre>
                        <div className="mt-2 flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={loading}
                            onClick={() => void handleDeny(call.id)}
                          >
                            Deny
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={loading}
                            onClick={() => void handleApprove(call.id)}
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    </details>
                  ))}
                  {!session && loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting assistant session...
                    </div>
                  )}
                  {session && loading && (
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
              </ScrollArea>

              <div className="rounded-xl border bg-background p-2 shadow-sm">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Get assistance with creating or refining this scenario ..."
                  disabled={!sessionId || loading}
                  rows={1}
                  className="min-h-10 max-h-40 resize-none border-0 bg-transparent px-2 py-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage(input);
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
                        disabled={!sessionId || loading}
                      >
                        <Plus className="h-3 w-3" />
                        Snippets
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[320px]">
                      <DropdownMenuLabel>Scenario Assistant Snippets</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {SCENARIO_ASSISTANT_SNIPPETS.map((snippet) => (
                        <DropdownMenuItem
                          key={snippet.label}
                          className="items-start whitespace-normal px-2 py-2"
                          onSelect={() => applyScenarioSnippet(snippet.prompt)}
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
                  <Button
                    type="button"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => void sendMessage(input)}
                    disabled={!sessionId || loading || !input.trim()}
                    aria-label="Send message"
                    title="Send message"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span className="sr-only">Send</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
          </div>
        )}
      </DialogContent>
      </Dialog>
    </>
  );
}

function SuggestionCard({
  title,
  rationale,
  preview,
  applied = false,
  onApply
}: {
  title: string;
  rationale?: string;
  preview: string;
  applied?: boolean;
  onApply: () => void;
}) {
  return (
    <div className={`space-y-2 rounded-md border p-3 ${applied ? "border-emerald-300 bg-emerald-50/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-medium">{title}</h5>
        <Button type="button" size="sm" variant={applied ? "secondary" : "outline"} onClick={onApply} disabled={applied}>
          {applied ? (
            <>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Applied
            </>
          ) : (
            "Apply"
          )}
        </Button>
      </div>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{preview}</pre>
    </div>
  );
}

function AssistantChatMessageRow({
  message
}: {
  message: ScenarioAssistantSessionView["messages"][number];
}) {
  const copyMessageText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied" });
    } catch (error: unknown) {
      toast({
        title: "Could not copy",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    }
  };

  const role = message.role;
  if (role === "tool") {
    const trimmed = String(message.text ?? "").trim();
    if (/^(Approved|Denied) tool call\b/i.test(trimmed)) {
      return null;
    }
    return (
      <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
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

  if (role === "system") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <RectangleEllipsis className="h-3 w-3" />
        </div>
        <div className="max-w-[92%] rounded-md border border-amber-400/30 bg-amber-50/70 p-3 text-sm">
          <MarkdownContent text={message.text} variant="assistant" />
        </div>
      </div>
    );
  }

  const isUser = role === "user";
  const Icon = isUser ? User : Bot;
  const showCopyButton = role === "user" || role === "assistant";
  return (
    <div className={`flex items-start gap-2 text-xs ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div className="relative max-w-[92%]">
        <div
          className={`max-w-full rounded-md border px-3 py-2 text-sm ${
            isUser
              ? "border-primary/20 bg-primary/10"
              : "border-border/80 bg-background shadow-sm"
          }`}
        >
          {!isUser && <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Assistant</p>}
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.text}</p>
          ) : (
            <MarkdownContent text={message.text} variant="assistant" />
          )}
        </div>
        {showCopyButton && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`absolute bottom-1 h-6 w-6 text-muted-foreground ${isUser ? "-left-8" : "-right-8"}`}
            onClick={() => void copyMessageText(message.text)}
            aria-label="Copy message"
            title="Copy message"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
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

function MarkdownContent({
  text,
  variant = "assistant"
}: {
  text: string;
  variant?: "assistant" | "system";
}) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={cn("space-y-2", variant === "system" && "text-xs")}>
      {blocks.map((block, index) => (
        <Fragment key={`md-${index}`}>
          {renderMarkdownBlock(block, index, variant)}
        </Fragment>
      ))}
    </div>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "hr" }
  | { type: "code"; lang?: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  const isBlank = (line: string) => line.trim() === "";
  const isFence = (line: string) => line.trimStart().startsWith("```");

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (isFence(line)) {
      const lang = trimmed.replace(/^```/, "").trim() || undefined;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && isFence(lines[i])) i += 1;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4,
        text: headingMatch[2].trim()
      });
      i += 1;
      continue;
    }

    if (looksLikeMarkdownTable(lines, i)) {
      const header = splitTableRow(lines[i]);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers: header, rows });
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+/);
    const bulletMatch = trimmed.match(/^[-*+]\s+/);
    if (orderedMatch || bulletMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (ordered ? /^\d+\.\s+/.test(current) : /^[-*+]\s+/.test(current)) {
          items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ""));
          i += 1;
          continue;
        }
        if (isBlank(lines[i])) {
          i += 1;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();
      if (
        isBlank(next) ||
        isFence(next) ||
        /^---+$/.test(nextTrimmed) ||
        /^#{1,4}\s+/.test(nextTrimmed) ||
        looksLikeMarkdownTable(lines, i) ||
        /^\d+\.\s+/.test(nextTrimmed) ||
        /^[-*+]\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function looksLikeMarkdownTable(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = lines[index].trim();
  const separator = lines[index + 1].trim();
  if (!header.includes("|")) return false;
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(separator);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownBlock(
  block: MarkdownBlock,
  index: number,
  variant: "assistant" | "system"
) {
  if (block.type === "hr") {
    return <hr className="border-border/60" />;
  }
  if (block.type === "heading") {
    const className =
      block.level === 1
        ? "text-base font-semibold"
        : block.level === 2
          ? "text-sm font-semibold"
          : "text-sm font-medium";
    return <h4 className={className}>{renderInlineMarkdown(block.text, `${index}-h`)}</h4>;
  }
  if (block.type === "paragraph") {
    return (
      <p className={cn("whitespace-pre-wrap leading-relaxed", variant === "system" && "leading-normal")}>
        {renderInlineMarkdown(block.text, `${index}-p`)}
      </p>
    );
  }
  if (block.type === "code") {
    return (
      <div className="rounded-md border bg-muted/70">
        {block.lang && (
          <div className="border-b px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {block.lang}
          </div>
        )}
        <pre className="max-h-72 overflow-auto p-2 text-xs">
          <code>{block.code}</code>
        </pre>
      </div>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-li-${itemIndex}`} className="leading-relaxed">
            {renderInlineMarkdown(item, `${index}-li-${itemIndex}`)}
          </li>
        ))}
      </Tag>
    );
  }
  if (block.type === "table") {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[480px] border-collapse text-xs">
          <thead className="bg-muted/40">
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th
                  key={`${index}-th-${headerIndex}`}
                  className="border-b px-2 py-1.5 text-left font-semibold align-top"
                >
                  {renderInlineMarkdown(header, `${index}-thc-${headerIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-row-${rowIndex}`} className="border-t">
                {row.map((cell, cellIndex) => (
                  <td key={`${index}-td-${rowIndex}-${cellIndex}`} className="px-2 py-1.5 align-top">
                    {renderInlineMarkdown(cell, `${index}-tdc-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

function renderInlineMarkdown(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyBase}-${index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyBase}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyBase}-${index}`}>{part}</Fragment>;
  });
}
