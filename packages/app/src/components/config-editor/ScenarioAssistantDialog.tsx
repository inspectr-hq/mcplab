import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Sparkles, Wrench } from "lucide-react";
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
  onApplyPatch
}: ScenarioAssistantDialogProps) {
  const { mode, source } = useDataSource();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<ScenarioAssistantSessionView | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedAssistantAgentName, setSelectedAssistantAgentName] = useState(
    defaultAssistantAgentName || agents[0]?.name || ""
  );

  useEffect(() => {
    if (open && !selectedAssistantAgentName && agents[0]?.name) {
      setSelectedAssistantAgentName(defaultAssistantAgentName || agents[0].name);
    }
  }, [open, agents, defaultAssistantAgentName, selectedAssistantAgentName]);

  useEffect(() => {
    if (!open) return;
    if (mode !== "workspace") return;
    if (!configPath || !selectedAssistantAgentName || sessionId) return;
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
    mode,
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

  useEffect(() => {
    if (open) return;
    if (!sessionId) return;
    const id = sessionId;
    setSessionId(null);
    setSession(null);
    setInput("");
    void source.closeScenarioAssistantSession(id).catch(() => {});
  }, [open, sessionId, source]);

  const latestSuggestions = useMemo(() => {
    if (!session) return undefined;
    const messages = [...session.messages].reverse();
    return messages.find((message) => message.suggestions)?.suggestions;
  }, [session]);

  const canUseAssistant =
    mode === "workspace" && Boolean(configPath) && agents.length > 0 && scenario.serverIds.length > 0;

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

  const applySuggestions = (suggestions: ScenarioAssistantSuggestionBundle | undefined, key: "prompt" | "evalRules" | "extractRules" | "snapshotEval") => {
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
    toast({ title: "Applied suggestion", description: `Updated ${key}` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Scenario Assistant
          </DialogTitle>
          <DialogDescription>
            LLM-guided scenario authoring with MCP tool introspection and per-tool-call approval.
          </DialogDescription>
        </DialogHeader>

        {!canUseAssistant ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            Scenario Assistant is available in workspace mode for saved configs with at least one agent and one selected server.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="min-h-0 flex flex-col gap-3">
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
                  "Suggest eval rules",
                  "Suggest extract rules",
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
                    <div key={message.id} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {message.role === "assistant" ? <Bot className="h-3.5 w-3.5" /> : null}
                        <Badge variant="outline" className="text-[10px] uppercase">{message.role}</Badge>
                        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap">
                        {message.text}
                      </div>
                      {message.pendingToolCallId && (
                        <div className="text-xs text-muted-foreground">
                          Tool call approval required below.
                        </div>
                      )}
                    </div>
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
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask for help creating/refining this scenario..."
                  disabled={!sessionId || loading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendMessage(input);
                    }
                  }}
                />
                <Button type="button" onClick={() => void sendMessage(input)} disabled={!sessionId || loading || !input.trim()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex flex-col rounded-md border">
              <div className="px-4 py-3">
                <h4 className="text-sm font-semibold">Structured Suggestions</h4>
                <p className="text-xs text-muted-foreground">
                  Apply sections individually. Changes affect only this scenario draft.
                </p>
              </div>
              <Separator />
              <ScrollArea className="min-h-0 flex-1 p-4">
                <div className="space-y-4">
                  {!latestSuggestions && (
                    <p className="text-xs text-muted-foreground">
                      Ask the assistant for rules, extracts, or prompt improvements to see structured suggestions here.
                    </p>
                  )}
                  {latestSuggestions?.prompt && (
                    <SuggestionCard
                      title="Prompt"
                      rationale={latestSuggestions.prompt.rationale}
                      preview={latestSuggestions.prompt.replacement}
                      onApply={() => applySuggestions(latestSuggestions, "prompt")}
                    />
                  )}
                  {latestSuggestions?.evalRules && (
                    <SuggestionCard
                      title="Eval Rules"
                      rationale={latestSuggestions.evalRules.rationale}
                      preview={JSON.stringify(latestSuggestions.evalRules.replacement, null, 2)}
                      onApply={() => applySuggestions(latestSuggestions, "evalRules")}
                    />
                  )}
                  {latestSuggestions?.extractRules && (
                    <SuggestionCard
                      title="Extract Rules"
                      rationale={latestSuggestions.extractRules.rationale}
                      preview={JSON.stringify(latestSuggestions.extractRules.replacement, null, 2)}
                      onApply={() => applySuggestions(latestSuggestions, "extractRules")}
                    />
                  )}
                  {latestSuggestions?.snapshotEval && (
                    <SuggestionCard
                      title="Snapshot Settings"
                      rationale={latestSuggestions.snapshotEval.rationale}
                      preview={JSON.stringify(latestSuggestions.snapshotEval.patch, null, 2)}
                      onApply={() => applySuggestions(latestSuggestions, "snapshotEval")}
                    />
                  )}
                  {(latestSuggestions?.notes ?? []).length > 0 && (
                    <div className="space-y-2 rounded-md border p-3">
                      <h5 className="text-sm font-medium">Notes</h5>
                      <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                        {latestSuggestions?.notes?.map((note, index) => (
                          <li key={`${note}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuggestionCard({
  title,
  rationale,
  preview,
  onApply
}: {
  title: string;
  rationale?: string;
  preview: string;
  onApply: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-medium">{title}</h5>
        <Button type="button" size="sm" variant="outline" onClick={onApply}>
          Apply
        </Button>
      </div>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{preview}</pre>
    </div>
  );
}

