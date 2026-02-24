import { Fragment, useEffect, useState, useRef } from "react";
import { Bot, CheckCircle2, Loader2, Minimize2, Send, Sparkles, User, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AgentConfig, EvalRule, Scenario, ServerConfig } from "@/types/eval";
import type {
  ScenarioAssistantSessionView,
  ScenarioAssistantSuggestionBundle
} from "@/lib/data-sources/types";

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
  const [selectedAssistantAgentName, setSelectedAssistantAgentName] = useState(
    defaultAssistantAgentName || agents[0]?.name || ""
  );
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const initialMessageSentRef = useRef<string | null>(null);
  const [preserveSessionOnClose, setPreserveSessionOnClose] = useState(false);
  const preserveSessionOnCloseRef = useRef(false);

  useEffect(() => {
    if (open && !selectedAssistantAgentName && agents[0]?.name) {
      setSelectedAssistantAgentName(defaultAssistantAgentName || agents[0].name);
    }
  }, [open, agents, defaultAssistantAgentName, selectedAssistantAgentName]);

  useEffect(() => {
    if (!open) return;
    if (!selectedAssistantAgentName || sessionId) return;
    let cancelled = false;
    setLoading(true);
    source
      .createScenarioAssistantSession({
        configId,
        configPath,
        scenarioId: scenario.id,
        selectedAssistantAgentName,
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
            serverNames: scenario.serverIds
              .map((id) => servers.find((server) => server.id === id)?.name || servers.find((server) => server.id === id)?.id)
              .filter(Boolean) as string[],
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
      .catch((error: any) => {
        if (cancelled) return;
        toast({
          title: "Could not start Scenario Assistant",
          description: String(error?.message ?? error),
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
    selectedAssistantAgentName
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

  const canUseAssistant =
    agents.length > 0 && scenario.serverIds.length > 0 && Boolean(selectedAssistantAgentName);

  const sendMessage = async (message: string) => {
    if (!sessionId) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const resp = await source.sendScenarioAssistantMessage(sessionId, trimmed);
      setSession(resp.session);
      setInput("");
    } catch (error: any) {
      toast({
        title: "Scenario Assistant error",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
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
    } catch (error: any) {
      toast({
        title: "Tool call failed",
        description: String(error?.message ?? error),
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
    } catch (error: any) {
      toast({
        title: "Could not deny tool call",
        description: String(error?.message ?? error),
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="absolute right-12 top-3 z-10 h-8 w-8 p-0 text-muted-foreground"
            onClick={handleMinimize}
            aria-label="Minimize assistant"
            title="Minimize assistant"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Assistant Agent</Label>
                  <Select
                    value={selectedAssistantAgentName}
                    onValueChange={(value) => {
                      setSelectedAssistantAgentName(value);
                      setSessionId(null);
                      setSession(null);
                    }}
                    disabled={loading}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.name || agent.id}>
                          {(agent.name || agent.id)} · {agent.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">MCP Context</Label>
                  <div className="h-8 rounded-md border px-2 text-xs flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5" />
                    {session ? `Loaded ${session.toolsLoaded} tools` : "Preparing..."}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  "Suggest checks",
                  "Suggest value capture rules",
                  "Improve prompt determinism",
                  "Explain snapshot drift risk",
                  "Generate scenario draft"
                ].map((label) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!sessionId || loading}
                    onClick={() => void sendMessage(label)}
                  >
                    {label}
                  </Button>
                ))}
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
                      <div className="space-y-2">
                        <AssistantChatMessageRow message={message} />
                        {message.pendingToolCallId && (
                          <div className="text-xs text-muted-foreground">
                            Tool call approval required below.
                          </div>
                        )}
                      </div>
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
                  {(session?.pendingToolCalls ?? []).map((call) => (
                    <div key={call.id} className="rounded-md border border-dashed p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{call.server}::{call.tool}</div>
                        <Badge variant="outline">{call.status}</Badge>
                      </div>
                      <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(call.arguments, null, 2)}</pre>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => void handleApprove(call.id)} disabled={loading}>
                          Approve & Run
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void handleDeny(call.id)} disabled={loading}>
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!session && loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting assistant session...
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Get assistance with creating or refining this scenario ..."
                  disabled={!sessionId || loading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendMessage(input);
                    }
                  }}
                />
                <Button
                  type="button"
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
  const role = message.role;
  if (role === "tool") {
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
      <div className="rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <div className="mb-1 font-semibold uppercase tracking-wide">System</div>
        <MarkdownContent text={message.text} variant="system" />
      </div>
    );
  }

  const isUser = role === "user";
  const Icon = isUser ? User : Bot;
  return (
    <div className={`flex items-start gap-2 text-xs ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div
        className={`max-w-[92%] rounded-md border px-3 py-2 text-sm ${
          isUser
            ? "border-primary/30 bg-primary/10"
            : "border-border/80 bg-muted/30 shadow-sm"
        }`}
      >
        <div className={`mb-1 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground ${isUser ? "justify-end" : ""}`}>
          <span>{isUser ? "You" : "Assistant"}</span>
          <span className="font-normal">{new Date(message.createdAt).toLocaleTimeString()}</span>
        </div>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.text}</p>
        ) : (
          <MarkdownContent text={message.text} variant="assistant" />
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
