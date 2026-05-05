import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Play, Plus, Sparkles, Trash2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AgentConfig, ServerConfig, Scenario, EvalRule, ExtractRule } from "@/types/eval";
import { useEffect, useState, type MouseEvent } from "react";
import { ScenarioAssistantDialog } from "@/components/config-editor/ScenarioAssistantDialog";
import { RunConversationPreview } from "@/components/results/RunConversationPreview";
import { useDataSource } from "@/contexts/DataSourceContext";
import { isUiFeatureEnabled } from "@/lib/feature-flags";
import { ensureOAuthForServers } from "@/lib/oauth-session-utils";

interface ScenarioFormProps {
  scenarios: Scenario[];
  scenarioOrigins?: Array<"referenced" | "inline">;
  scenarioOverrides?: boolean[];
  agents: AgentConfig[];
  servers: ServerConfig[];
  configId?: string;
  configPath?: string;
  defaultAssistantAgentName?: string;
  assistantInitialPromptByScenarioId?: Record<string, string>;
  assistantAutoOpenNonceByScenarioId?: Record<string, number>;
  snapshotEval?: {
    enabled: boolean;
    mode: "warn" | "fail_on_drift";
    baselineSnapshotId?: string;
  };
  onChange: (scenarios: Scenario[]) => void;
  readOnly?: boolean;
  allowAdd?: boolean;
  allowStructureEdits?: boolean;
}

const emptyScenario = (): Scenario => ({
  id: `scn-${Date.now()}`,
  name: "",
  serverIds: [],
  prompt: "",
  evalRules: [],
  extractRules: [],
});

export function ScenarioForm({
  scenarios,
  scenarioOrigins,
  scenarioOverrides,
  agents,
  servers,
  configId,
  configPath,
  defaultAssistantAgentName,
  assistantInitialPromptByScenarioId,
  assistantAutoOpenNonceByScenarioId,
  snapshotEval,
  onChange,
  readOnly,
  allowAdd = !readOnly,
  allowStructureEdits = !readOnly
}: ScenarioFormProps) {
  const update = (index: number, patch: Partial<Scenario>) => {
    const next = scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const remove = (index: number) => onChange(scenarios.filter((_, i) => i !== index));
  const add = () => onChange([...scenarios, emptyScenario()]);
  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= scenarios.length) return;
    const next = [...scenarios];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    onChange(next);
  };

  return (
    <div className={readOnly ? "space-y-2" : "space-y-4"}>
      {!readOnly && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Scenarios</h3>
          {allowAdd && allowStructureEdits && (
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Add Scenario
            </Button>
          )}
        </div>
      )}
      {scenarios.map((sc, i) => (
        <ScenarioCard
          key={sc.id}
          scenario={sc}
          scenarioOrigin={scenarioOrigins?.[i]}
          hasMcpServerOverride={scenarioOverrides?.[i]}
          index={i}
          total={scenarios.length}
          agents={agents}
          servers={servers}
          configId={configId}
          configPath={configPath}
          defaultAssistantAgentName={defaultAssistantAgentName}
          assistantInitialPrompt={assistantInitialPromptByScenarioId?.[sc.id]}
          assistantAutoOpenNonce={assistantAutoOpenNonceByScenarioId?.[sc.id]}
          snapshotEval={snapshotEval}
          onUpdate={(patch) => update(i, patch)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
          onRemove={() => remove(i)}
          readOnly={readOnly}
          allowStructureEdits={allowStructureEdits}
        />
      ))}
      {scenarios.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No scenarios configured. Add one to get started.</p>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, scenarioOrigin, hasMcpServerOverride, index, total, agents, servers, configId, configPath, defaultAssistantAgentName, assistantInitialPrompt, assistantAutoOpenNonce, snapshotEval, onUpdate, onMoveUp, onMoveDown, onRemove, readOnly, allowStructureEdits }: {
  scenario: Scenario; index: number; total: number; agents: AgentConfig[]; servers: ServerConfig[];
  scenarioOrigin?: "referenced" | "inline";
  hasMcpServerOverride?: boolean;
  configId?: string;
  configPath?: string;
  defaultAssistantAgentName?: string;
  assistantInitialPrompt?: string;
  assistantAutoOpenNonce?: number;
  snapshotEval?: { enabled: boolean; mode: "warn" | "fail_on_drift"; baselineSnapshotId?: string };
  onUpdate: (patch: Partial<Scenario>) => void; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void; readOnly?: boolean; allowStructureEdits?: boolean;
}) {
  const { source } = useDataSource();
  const snapshotsUiEnabled = isUiFeatureEnabled("snapshots", false);
  const [newRuleType, setNewRuleType] = useState<EvalRule["type"]>("required_tool");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRulePath, setNewRulePath] = useState("");
  const [newRuleEquals, setNewRuleEquals] = useState("");
  const [toolPickerValue, setToolPickerValue] = useState("");
  const [availableToolNames, setAvailableToolNames] = useState<string[] | null>(null);
  const [toolNamesLoading, setToolNamesLoading] = useState(false);
  const [toolNamesError, setToolNamesError] = useState<string | null>(null);
  const [newExtractName, setNewExtractName] = useState("");
  const [newExtractPattern, setNewExtractPattern] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [previewAgentName, setPreviewAgentName] = useState<string>(
    defaultAssistantAgentName || agents[0]?.id || ""
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAssistantPrompt, setPreviewAssistantPrompt] = useState<string>("");
  const [previewResult, setPreviewResult] = useState<Awaited<
    ReturnType<typeof source.runScenarioPreview>
  > | null>(null);
  const [expanded, setExpanded] = useState(!readOnly);
  const toggleFromHeaderClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, select, textarea, [role='button']")) return;
    setExpanded((prev) => !prev);
  };

  const addRule = () => {
    if (
      newRuleType === "response_jsonpath" ||
      newRuleType === "response_jsonpath_exists" ||
      newRuleType === "response_jsonpath_not_exists"
    ) {
      const path = newRulePath.trim();
      if (!path) return;
      if (newRuleType === "response_jsonpath") {
        const equalsText = newRuleEquals.trim();
        let equals: string | number | boolean | undefined = undefined;
        if (equalsText.length > 0) {
          if (equalsText === "true") equals = true;
          else if (equalsText === "false") equals = false;
          else if (!Number.isNaN(Number(equalsText))) equals = Number(equalsText);
          else equals = equalsText;
        }
        onUpdate({
          evalRules: [...scenario.evalRules, { type: newRuleType, path, ...(equals !== undefined ? { equals } : {}) }]
        });
      } else {
        onUpdate({ evalRules: [...scenario.evalRules, { type: newRuleType, path }] });
      }
      setNewRulePath("");
      setNewRuleEquals("");
      return;
    }

    if (!newRuleValue.trim()) return;
    onUpdate({ evalRules: [...scenario.evalRules, { type: newRuleType, value: newRuleValue.trim() }] });
    setNewRuleValue("");
    setToolPickerValue("");
  };

  const removeRule = (ri: number) => {
    onUpdate({ evalRules: scenario.evalRules.filter((_, i) => i !== ri) });
  };

  const addExtract = () => {
    if (!newExtractName.trim() || !newExtractPattern.trim()) return;
    onUpdate({ extractRules: [...scenario.extractRules, { name: newExtractName.trim(), pattern: newExtractPattern.trim() }] });
    setNewExtractName("");
    setNewExtractPattern("");
  };

  const removeExtract = (ri: number) => {
    onUpdate({ extractRules: scenario.extractRules.filter((_, i) => i !== ri) });
  };

  const toggleServer = (srvId: string) => {
    const next = scenario.serverIds.includes(srvId)
      ? scenario.serverIds.filter((id) => id !== srvId)
      : [...scenario.serverIds, srvId];
    onUpdate({ serverIds: next });
  };

  const ruleTypeLabel: Record<EvalRule["type"], string> = {
    required_tool: "Required",
    forbidden_tool: "Forbidden",
    response_contains: "Contains",
    response_not_contains: "Not Contains",
    response_starts_with: "Starts With",
    response_ends_with: "Ends With",
    response_equals: "Equals",
    response_regex: "Regex",
    response_jsonpath: "JSONPath",
    response_jsonpath_exists: "JSONPath Exists",
    response_jsonpath_not_exists: "JSONPath Not Exists",
  };

  const ruleTypeBadgeColor: Record<EvalRule["type"], string> = {
    required_tool: "border-sky-300/60 bg-sky-500/10 text-sky-700",
    forbidden_tool: "border-rose-300/60 bg-rose-500/10 text-rose-700",
    response_contains: "border-violet-300/60 bg-violet-500/10 text-violet-700",
    response_not_contains: "border-amber-300/60 bg-amber-500/10 text-amber-700",
    response_starts_with: "border-cyan-300/60 bg-cyan-500/10 text-cyan-700",
    response_ends_with: "border-indigo-300/60 bg-indigo-500/10 text-indigo-700",
    response_equals: "border-lime-300/60 bg-lime-500/10 text-lime-700",
    response_regex: "border-fuchsia-300/60 bg-fuchsia-500/10 text-fuchsia-700",
    response_jsonpath: "border-emerald-300/60 bg-emerald-500/10 text-emerald-700",
    response_jsonpath_exists: "border-green-300/60 bg-green-500/10 text-green-700",
    response_jsonpath_not_exists: "border-orange-300/60 bg-orange-500/10 text-orange-700",
  };
  const isToolRule = newRuleType === "required_tool" || newRuleType === "forbidden_tool";
  const isJsonPathRule =
    newRuleType === "response_jsonpath" ||
    newRuleType === "response_jsonpath_exists" ||
    newRuleType === "response_jsonpath_not_exists";
  const selectedServerIds = scenario.serverIds
    .filter((sid) => servers.some((srv) => srv.id === sid));
  const availableAgentIds = agents.map((agent) => agent.id).filter(Boolean);
  const canLoadToolNames = selectedServerIds.length > 0;
  const hasScenarioBaselineOverride = scenario.snapshotEval?.baselineSnapshotId !== undefined;
  const [consumedInitialPrompt, setConsumedInitialPrompt] = useState<string>("");
  const [consumedAutoOpenNonce, setConsumedAutoOpenNonce] = useState<number>(0);

  useEffect(() => {
    const handoff = (assistantInitialPrompt ?? "").trim();
    if (!handoff) return;
    if (consumedInitialPrompt === handoff) return;
    setAssistantOpen(true);
    setConsumedInitialPrompt(handoff);
  }, [assistantInitialPrompt, consumedInitialPrompt]);

  useEffect(() => {
    if (!assistantAutoOpenNonce) return;
    if (assistantAutoOpenNonce === consumedAutoOpenNonce) return;
    setAssistantOpen(true);
    setConsumedAutoOpenNonce(assistantAutoOpenNonce);
  }, [assistantAutoOpenNonce, consumedAutoOpenNonce]);

  useEffect(() => {
    setAvailableToolNames(null);
    setToolNamesError(null);
    setToolPickerValue("");
  }, [scenario.serverIds.join("|")]);

  useEffect(() => {
    setToolPickerValue("");
    setNewRulePath("");
    setNewRuleEquals("");
  }, [newRuleType]);

  useEffect(() => {
    if (previewAgentName && availableAgentIds.includes(previewAgentName)) return;
    setPreviewAgentName(defaultAssistantAgentName || agents[0]?.id || "");
  }, [previewAgentName, defaultAssistantAgentName, agents, availableAgentIds]);

  const runPromptPreview = async () => {
    if (!previewAgentName) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const oauthServerIds = scenario.serverIds.filter((serverId) => {
        const server = servers.find((entry) => entry.id === serverId);
        return server?.authType === "oauth2";
      });
      await ensureOAuthForServers({ serverNames: oauthServerIds, source });

      const preview = await source.runScenarioPreview({
        selectedAgentName: previewAgentName,
        scenario: {
          id: scenario.id,
          name: scenario.name,
          prompt: scenario.prompt,
          serverNames: scenario.serverIds,
          evalRules: scenario.evalRules,
          extractRules: scenario.extractRules
        }
      });
      setPreviewResult(preview);
    } catch (error: unknown) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendPreviewToAssistant = () => {
    if (!previewResult) return;
    const checkItems = buildPreviewCheckItems(scenario.evalRules, previewResult.run.failureReasons);
    const checkSummary = checkItems.length
      ? checkItems
          .map((item) =>
            `${item.status.toUpperCase()} - ${renderEvalRulePreview(item.rule)}${
              item.failureReason ? ` (${item.failureReason})` : ""
            }`
          )
          .join("\n")
      : "No checks configured.";
    const extractedSummary =
      Object.keys(previewResult.run.extractedValues).length > 0
        ? Object.entries(previewResult.run.extractedValues)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join("\n")
        : "No extracted values.";
    const toolSummary =
      previewResult.run.toolCalls.length > 0
        ? previewResult.run.toolCalls
            .map((call, idx) => `${idx + 1}. ${call.name} (${call.duration}ms)`)
            .join("\n")
        : "No tool calls.";
    const prompt = [
      `I ran a prompt preview for scenario '${scenario.id}' and want you to suggest concrete updates.`,
      `Run ID: ${previewResult.runId}`,
      `Agent: ${previewResult.agentName}`,
      `Outcome: ${previewResult.run.passed ? "passed" : "failed"}`,
      `Duration: ${previewResult.run.duration}ms`,
      "",
      "Current check outcomes:",
      checkSummary,
      "",
      "Tool sequence:",
      toolSummary,
      "",
      "Extracted values:",
      extractedSummary,
      "",
      "Final answer:",
      previewResult.run.finalAnswer || "(empty)",
      "",
      "Please propose concrete updates to the Prompt, Checks, and/or Value Capture Rules based on this preview."
    ].join("\n");
    setPreviewAssistantPrompt(prompt);
    setAssistantOpen(true);
  };

  const loadAvailableTools = async () => {
    if (!canLoadToolNames || readOnly) return;
    setToolNamesLoading(true);
    setToolNamesError(null);
    try {
      const oauthServerIds = selectedServerIds.filter((serverId) => {
        const server = servers.find((entry) => entry.id === serverId);
        return server?.authType === "oauth2";
      });
      await ensureOAuthForServers({ serverNames: oauthServerIds, source });

      const discovered = new Set<string>();
      for (const serverId of selectedServerIds) {
        const res = await source.discoverToolsForAnalysis({ serverNames: [serverId] });
        for (const server of res.servers) {
          for (const tool of server.tools) discovered.add(tool.name);
        }
      }
      setAvailableToolNames(Array.from(discovered).sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      setToolNamesError(err instanceof Error ? err.message : "Failed to load tools");
    } finally {
      setToolNamesLoading(false);
    }
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className={readOnly ? "rounded-md border shadow-none" : "border-dashed"}>
        <CardHeader
          className={`${readOnly ? "px-3 py-3" : "pb-3"} flex-row items-center justify-between space-y-0 cursor-pointer`}
          onClick={toggleFromHeaderClick}
        >
          <div className="flex min-w-0 items-center gap-2">
            {!readOnly && (
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
                </Button>
              </CollapsibleTrigger>
            )}
            <span className="text-xs text-muted-foreground">{index + 1}.</span>
            <CardTitle className="truncate text-sm font-medium">
              {scenario.name || `Scenario ${index + 1}`}
            </CardTitle>
          </div>
          {readOnly ? (
            <div className="flex items-center gap-2">
              {scenarioOrigin && (
                <Badge variant={scenarioOrigin === "inline" ? "secondary" : "outline"}>
                  {scenarioOrigin === "referenced" ? "Referenced" : "Inline"}
                </Badge>
              )}
              {hasMcpServerOverride && <Badge variant="secondary">Override</Badge>}
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-label={expanded ? "Collapse scenario details" : "Expand scenario details"}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          ) : allowStructureEdits && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => setAssistantOpen(true)}
                title={
                  agents.length === 0
                      ? "Add at least one agent in the config"
                      : scenario.serverIds.length === 0
                        ? "Select at least one server for this scenario"
                        : "Open Scenario Assistant"
                }
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Ask Assistant
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onMoveUp}
                disabled={index === 0}
                aria-label="Move scenario up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onMoveDown}
                disabled={index === total - 1}
                aria-label="Move scenario down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
        <ScenarioAssistantDialog
          open={assistantOpen}
          onOpenChange={(nextOpen) => {
            setAssistantOpen(nextOpen);
            if (!nextOpen) setPreviewAssistantPrompt("");
          }}
          configId={configId}
          configPath={configPath}
          scenario={scenario}
          agents={agents}
          servers={servers}
          snapshotEval={snapshotEval}
          defaultAssistantAgentName={defaultAssistantAgentName}
          initialUserMessage={previewAssistantPrompt || assistantInitialPrompt}
          onApplyPatch={(patch) =>
            onUpdate({
              ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
              ...(patch.evalRules !== undefined ? { evalRules: patch.evalRules } : {}),
              ...(patch.extractRules !== undefined ? { extractRules: patch.extractRules } : {}),
              ...(patch.snapshotEval !== undefined
                ? {
                    snapshotEval: {
                      ...(scenario.snapshotEval ?? {}),
                      ...patch.snapshotEval
                    }
                  }
                : {})
            })
          }
        />
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input value={scenario.name} onChange={(e) => onUpdate({ name: e.target.value })} disabled={readOnly} placeholder="e.g. List directory" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Servers</Label>
          <div className="flex flex-wrap gap-1.5">
            {servers.map((srv) => (
              <Badge
                key={srv.id}
                variant={scenario.serverIds.includes(srv.id) ? "default" : "outline"}
                className={`cursor-pointer text-xs ${scenario.serverIds.includes(srv.id) ? "" : "opacity-50"}`}
                onClick={() => !readOnly && toggleServer(srv.id)}
              >
                {srv.name || srv.id}
              </Badge>
            ))}
            {servers.length === 0 && <span className="text-xs text-muted-foreground">Add servers above first</span>}
          </div>
        </div>

        <Card className="border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Prompt</CardTitle>
            <p className="text-xs text-muted-foreground">
              The instruction sent to the agent for this scenario. Be explicit about the task, expected output, and constraints.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <Textarea
              value={scenario.prompt}
              onChange={(e) => onUpdate({ prompt: e.target.value })}
              disabled={readOnly}
              placeholder="The prompt to send to the agent..."
              rows={4}
              className="text-xs"
            />
          </CardContent>
        </Card>

        {!readOnly && (
          <Card className="border bg-muted/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Run Prompt Preview</CardTitle>
              <p className="text-xs text-muted-foreground">
                Execute the current draft prompt once and inspect final answer, conversation trace, tool calls, and check outcomes.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label className="text-xs">Agent</Label>
                  <Select value={previewAgentName} onValueChange={setPreviewAgentName}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name || agent.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    onClick={() => void runPromptPreview()}
                    disabled={
                      previewLoading ||
                      !previewAgentName ||
                      !scenario.prompt.trim() ||
                      scenario.serverIds.length === 0
                    }
                  >
                    {previewLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        Run Prompt
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {!scenario.prompt.trim() && (
                <p className="text-[11px] text-muted-foreground">Add a prompt to run preview.</p>
              )}
              {scenario.serverIds.length === 0 && (
                <p className="text-[11px] text-muted-foreground">Select at least one server to run preview.</p>
              )}
              {previewError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {previewError}
                </div>
              )}
              {previewResult && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={previewResult.run.passed ? "default" : "destructive"}>
                      {previewResult.run.passed ? "Passed" : "Failed"}
                    </Badge>
                    <Badge variant="outline">{previewResult.run.duration}ms</Badge>
                    <Badge variant="outline">{previewResult.run.toolCalls.length} tool calls</Badge>
                    <Badge variant="outline" className="font-mono">
                      {previewResult.agentName}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1.5 px-2 text-[11px]"
                      onClick={sendPreviewToAssistant}
                    >
                      <Sparkles className="h-3 w-3" />
                      Send to Assistant
                    </Button>
                  </div>
                  {scenario.evalRules.length === 0 ? (
                    <div className="rounded-md border bg-muted/20 p-2">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Check results
                      </p>
                      <p className="text-xs text-muted-foreground">No checks configured for this scenario.</p>
                    </div>
                  ) : (
                    (() => {
                      const checks = buildPreviewCheckItems(scenario.evalRules, previewResult.run.failureReasons);
                      const passedChecks = checks.filter((check) => check.status === "passed");
                      const failedChecks = checks.filter((check) => check.status === "failed");
                      return (
                        <div className="rounded-md border bg-muted/20 p-2">
                          <div className="mb-2 flex items-center gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Checks
                            </p>
                            <Badge
                              variant="outline"
                              className="h-5 border-success/30 bg-success/10 text-success text-[10px]"
                            >
                              {passedChecks.length} passed
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`h-5 text-[10px] ${failedChecks.length > 0 ? "border-destructive/30 bg-destructive/10 text-destructive" : ""}`}
                            >
                              {failedChecks.length} failed
                            </Badge>
                          </div>
                          <div className="space-y-1">
                            {checks.map((check, idx) => (
                              <div
                                key={`${scenario.id}-preview-check-${idx}`}
                                className={`flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
                                  check.status === "failed"
                                    ? "border-destructive/20 bg-destructive/5"
                                    : "border-success/20 bg-success/5"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {check.status === "failed" ? (
                                      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                    ) : (
                                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                    )}
                                    <span className="font-medium">{formatPreviewEvalRuleLabel(check.rule)}</span>
                                  </div>
                                  {check.failureReason && (
                                    <p className="mt-1 pl-5 text-[11px] text-destructive">
                                      {formatPreviewFailureReason(check.failureReason)}
                                    </p>
                                  )}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={`shrink-0 text-[10px] ${
                                    check.status === "failed"
                                      ? "border-destructive/30 text-destructive"
                                      : "border-success/30 text-success"
                                  }`}
                                >
                                  {check.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()
                  )}
                  {previewResult.run.failureReasons.length > 0 && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                        Check failures
                      </p>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                        {previewResult.run.failureReasons.map((reason, idx) => (
                          <li key={`${previewResult.runId}-failure-${idx}`}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Object.keys(previewResult.run.extractedValues).length > 0 && (
                    <div className="rounded-md border bg-background p-2">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Extracted values
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {Object.entries(previewResult.run.extractedValues).map(([key, value]) => (
                          <div key={key} className="rounded border bg-muted/20 px-2 py-1 text-xs">
                            <div className="font-mono text-[11px] text-muted-foreground">{key}</div>
                            <div className="break-all">{String(value)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <RunConversationPreview run={previewResult.run} fallbackUserPrompt={scenario.prompt} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border bg-muted/20">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm">Checks</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Checks determine pass/fail for the scenario. Add tool checks or text pattern checks for the final answer.
                  </p>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs shrink-0"
                    onClick={() => setAssistantOpen(true)}
                    title="Ask for help improving checks"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Ask Assistant
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-2">
                <Label className="text-xs">Checks (pass / fail)</Label>
                <p className="text-[11px] text-muted-foreground">
                  These determine whether the scenario passes. Add tool checks (required/forbidden) or text pattern checks for the final answer.
                </p>
                <div className="space-y-1.5">
                  {scenario.evalRules.length === 0 ? (
                    <p className="rounded-md border border-dashed bg-background/60 px-2 py-2 text-xs text-muted-foreground">
                      No checks yet. Add tool checks or text pattern checks below.
                    </p>
                  ) : (
                    scenario.evalRules.map((rule, ri) => (
                      <div
                        key={ri}
                        className="flex items-start justify-between gap-2 rounded-md border bg-background px-2 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ruleTypeBadgeColor[rule.type]}`}>
                              {ruleTypeLabel[rule.type]}
                            </span>
                            <span className="font-mono break-all">
                              {rule.path
                                ? rule.equals !== undefined
                                  ? `${rule.path} == ${String(rule.equals)}`
                                  : rule.path
                                : rule.value}
                            </span>
                          </div>
                        </div>
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => removeRule(ri)}
                            aria-label={`Remove check ${ri + 1}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {!readOnly && (
                  <div className="space-y-2">
                    <div className="flex gap-2 items-end">
                      <Select value={newRuleType} onValueChange={(v) => setNewRuleType(v as EvalRule["type"])}>
                        <SelectTrigger className="h-8 w-[14.5rem] shrink-0 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="required_tool">Required Tool</SelectItem>
                          <SelectItem value="forbidden_tool">Forbidden Tool</SelectItem>
                          <SelectItem value="response_contains">Text contains</SelectItem>
                          <SelectItem value="response_not_contains">Text does not contain</SelectItem>
                          <SelectItem value="response_starts_with">Text starts with</SelectItem>
                          <SelectItem value="response_ends_with">Text ends with</SelectItem>
                          <SelectItem value="response_equals">Text equals</SelectItem>
                          <SelectItem value="response_regex">Text matches regex</SelectItem>
                          <SelectItem value="response_jsonpath">JSONPath (optional equals)</SelectItem>
                          <SelectItem value="response_jsonpath_exists">JSONPath exists</SelectItem>
                          <SelectItem value="response_jsonpath_not_exists">JSONPath not exists</SelectItem>
                        </SelectContent>
                      </Select>
                      {isJsonPathRule ? (
                        <>
                          <Input
                            value={newRulePath}
                            onChange={(e) => setNewRulePath(e.target.value)}
                            placeholder="JSONPath (e.g. $.status)"
                            className="h-8 text-xs font-mono"
                            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())}
                          />
                          {newRuleType === "response_jsonpath" && (
                            <Input
                              value={newRuleEquals}
                              onChange={(e) => setNewRuleEquals(e.target.value)}
                              placeholder="Equals (optional)"
                              className="h-8 w-[12rem] text-xs font-mono"
                              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())}
                            />
                          )}
                        </>
                      ) : (
                        <Input
                          value={newRuleValue}
                          onChange={(e) => setNewRuleValue(e.target.value)}
                          placeholder="Value"
                          className="h-8 text-xs font-mono"
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())}
                        />
                      )}
                      <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={addRule}>Add</Button>
                    </div>
                    {isToolRule && (
                      <div className="space-y-1">
                        <div className="flex items-end gap-2">
                          <div className="min-w-0 flex-1">
                            <Label className="mb-1 block text-[11px] text-muted-foreground">
                              Pick from selected server tools (optional)
                            </Label>
                            <Select
                              value={toolPickerValue}
                              onValueChange={(value) => {
                                setToolPickerValue(value);
                                setNewRuleValue(value);
                              }}
                              disabled={toolNamesLoading || !availableToolNames || availableToolNames.length === 0}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue
                                  placeholder={
                                    toolNamesLoading
                                      ? "Loading tools..."
                                      : availableToolNames && availableToolNames.length > 0
                                        ? "Select tool to insert in value field"
                                        : "Load tools first"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {(availableToolNames ?? []).map((toolName) => (
                                  <SelectItem key={toolName} value={toolName}>
                                    {toolName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={loadAvailableTools}
                            disabled={!canLoadToolNames || toolNamesLoading}
                          >
                            {toolNamesLoading ? "Loading..." : availableToolNames ? "Refresh tools" : "Load tools"}
                          </Button>
                        </div>
                        {!canLoadToolNames && (
                          <p className="text-[11px] text-muted-foreground">
                            Select at least one server in this scenario to load tool names.
                          </p>
                        )}
                        {toolNamesError && (
                          <p className="text-[11px] text-destructive">
                            Could not load tools: {toolNamesError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border bg-muted/10">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm">Value Capture Rules</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Formerly “Extract Rules”. These do not fail the run. They capture structured values from the final answer for reporting, snapshots, and comparisons.
                  </p>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs shrink-0"
                    onClick={() => setAssistantOpen(true)}
                    title="Ask for help improving value capture rules"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Ask Assistant
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-2">
                <Label className="text-xs">Value Capture Rules</Label>
                <p className="text-[11px] text-muted-foreground">
                  Use regex patterns to capture values like max concentration, product names, date ranges, or IDs from the final answer text.
                </p>
                <div className="space-y-1.5">
                  {scenario.extractRules.length === 0 ? (
                    <p className="w-full rounded-md border border-dashed bg-background/60 px-2 py-2 text-xs text-muted-foreground">
                      No value capture rules yet. Add one below to capture structured output from the final answer.
                    </p>
                  ) : (
                    scenario.extractRules.map((rule, ri) => (
                      <div
                        key={ri}
                        className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-violet-300/60 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                              {rule.name}
                            </span>
                            <span className="text-[11px] font-semibold text-muted-foreground">regex:</span>
                            <code className="font-mono break-all text-foreground">{rule.pattern}</code>
                          </div>
                        </div>
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => removeExtract(ri)}
                            aria-label={`Remove value capture rule ${ri + 1}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {!readOnly && (
                  <div className="flex gap-2 items-end">
                    <Input value={newExtractName} onChange={(e) => setNewExtractName(e.target.value)} placeholder="Field name" className="h-8 text-xs w-36" />
                    <Input value={newExtractPattern} onChange={(e) => setNewExtractPattern(e.target.value)} placeholder="Regex pattern" className="h-8 text-xs font-mono" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtract())} />
                    <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={addExtract}>Add</Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {snapshotsUiEnabled && (
        <Card className="border bg-amber-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Snapshot Evaluation</CardTitle>
              <p className="text-xs text-muted-foreground">
                Per-scenario toggle for config baseline drift checks.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between rounded-md border bg-white/60 px-2 py-1.5">
                <span>Enabled for this scenario</span>
                <Switch
                  checked={scenario.snapshotEval?.enabled !== false}
                  disabled={readOnly}
                  onCheckedChange={(checked) =>
                    onUpdate({
                      snapshotEval: {
                        ...(scenario.snapshotEval ?? {}),
                        enabled: checked
                      }
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between rounded-md border bg-white/60 px-2 py-1.5">
                  <span>Use config baseline</span>
                  <Switch
                    checked={!hasScenarioBaselineOverride}
                    disabled={readOnly}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onUpdate({
                          snapshotEval: {
                            ...(scenario.snapshotEval ?? {}),
                            baselineSnapshotId: undefined
                          }
                        });
                        return;
                      }
                      onUpdate({
                        snapshotEval: {
                          ...(scenario.snapshotEval ?? {}),
                          baselineSnapshotId: scenario.snapshotEval?.baselineSnapshotId ?? ""
                        }
                      });
                    }}
                  />
                </div>
                {hasScenarioBaselineOverride && (
                  <Input
                    value={scenario.snapshotEval?.baselineSnapshotId ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        snapshotEval: {
                          ...(scenario.snapshotEval ?? {}),
                          baselineSnapshotId: e.target.value
                        }
                      })
                    }
                    disabled={readOnly}
                    placeholder="Override baseline snapshot id"
                    className="h-8 text-xs font-mono"
                  />
                )}
              </div>
              <p>
                Effective baseline snapshot:{" "}
                <span className="font-mono">
                  {scenario.snapshotEval?.baselineSnapshotId || snapshotEval?.baselineSnapshotId || "Not configured"}
                </span>
              </p>
              <p>
                Policy:{" "}
                <span className="font-mono">{snapshotEval?.mode ?? "warn"}</span> · config-level switch{" "}
                <span className="font-mono">{snapshotEval?.enabled ? "on" : "off"}</span>
              </p>
            </CardContent>
          </Card>
        )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function buildPreviewCheckItems(evalRules: EvalRule[], failureReasons: string[]) {
  return evalRules.map((rule) => {
    const failureReason = matchFailureReasonForRule(rule, failureReasons);
    return {
      rule,
      status: failureReason ? ("failed" as const) : ("passed" as const),
      failureReason
    };
  });
}

function renderEvalRulePreview(rule: EvalRule): string {
  if (rule.path) {
    return rule.equals !== undefined
      ? `${rule.type}: ${rule.path} == ${String(rule.equals)}`
      : `${rule.type}: ${rule.path}`;
  }
  return `${rule.type}: ${rule.value ?? ""}`;
}

function formatPreviewEvalRuleLabel(rule: EvalRule): string {
  if (rule.type === "required_tool") return `Required tool · ${rule.value}`;
  if (rule.type === "forbidden_tool") return `Forbidden tool · ${rule.value}`;
  if (rule.type === "response_contains") return `Text contains · ${rule.value}`;
  if (rule.type === "response_not_contains") return `Text does not contain · ${rule.value}`;
  if (rule.type === "response_starts_with") return `Text starts with · ${rule.value}`;
  if (rule.type === "response_ends_with") return `Text ends with · ${rule.value}`;
  if (rule.type === "response_equals") return `Text equals · ${rule.value}`;
  if (rule.type === "response_regex") return `Text matches regex · ${rule.value}`;
  if (rule.type === "response_jsonpath")
    return rule.equals !== undefined
      ? `JSONPath equals · ${rule.path} == ${String(rule.equals)}`
      : `JSONPath exists · ${rule.path}`;
  if (rule.type === "response_jsonpath_exists") return `JSONPath exists · ${rule.path}`;
  if (rule.type === "response_jsonpath_not_exists") return `JSONPath not exists · ${rule.path}`;
  return `${rule.type} · ${rule.value}`;
}

function formatPreviewFailureReason(reason: string): string {
  const trimmed = String(reason ?? "").trim();
  const regexMatch = trimmed.match(/^Regex assertion failed:\s*(.+)$/i);
  if (regexMatch) {
    return `Text match failed: ${regexMatch[1]}`;
  }
  return trimmed;
}

function matchFailureReasonForRule(rule: EvalRule, failureReasons: string[]): string | undefined {
  if (rule.type === "response_jsonpath_exists") {
    const path = String(rule.path ?? "").trim();
    if (!path) return undefined;
    return failureReasons.find(
      (reason) =>
        reason.startsWith(`JSONPath assertion failed: ${path}`) ||
        reason.startsWith(`JSONPath assertion failed: invalid JSON for path ${path}`)
    );
  }
  const expectedPrefix = (() => {
    if (rule.type === "required_tool") return `Required tool not used: ${rule.value}`;
    if (rule.type === "forbidden_tool") return `Forbidden tool used: ${rule.value}`;
    if (rule.type === "response_contains") return `Contains assertion failed: ${rule.value}`;
    if (rule.type === "response_not_contains")
      return `Not-contains assertion failed: ${rule.value}`;
    if (rule.type === "response_starts_with")
      return `Starts-with assertion failed: ${rule.value}`;
    if (rule.type === "response_ends_with") return `Ends-with assertion failed: ${rule.value}`;
    if (rule.type === "response_equals") return `Equals assertion failed: ${rule.value}`;
    if (rule.type === "response_regex") return `Regex assertion failed: ${rule.value}`;
    if (rule.type === "response_jsonpath")
      return rule.equals !== undefined
        ? `JSONPath equals assertion failed: ${rule.path}`
        : `JSONPath assertion failed: ${rule.path}`;
    if (rule.type === "response_jsonpath_not_exists")
      return `JSONPath not-exists assertion failed: ${rule.path}`;
    return "";
  })();
  if (!expectedPrefix) return undefined;
  return failureReasons.find((reason) => reason.startsWith(expectedPrefix));
}
