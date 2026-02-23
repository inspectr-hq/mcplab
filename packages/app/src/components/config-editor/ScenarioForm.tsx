import { ChevronDown, ChevronUp, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AgentConfig, ServerConfig, Scenario, EvalRule, ExtractRule } from "@/types/eval";
import { useEffect, useState } from "react";
import { ScenarioAssistantDialog } from "@/components/config-editor/ScenarioAssistantDialog";

interface ScenarioFormProps {
  scenarios: Scenario[];
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
  allowAdd = !readOnly
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scenarios</h3>
        {!readOnly && allowAdd && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Add Scenario
          </Button>
        )}
      </div>
      {scenarios.map((sc, i) => (
        <ScenarioCard
          key={sc.id}
          scenario={sc}
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
        />
      ))}
      {scenarios.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No scenarios configured. Add one to get started.</p>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, index, total, agents, servers, configId, configPath, defaultAssistantAgentName, assistantInitialPrompt, assistantAutoOpenNonce, snapshotEval, onUpdate, onMoveUp, onMoveDown, onRemove, readOnly }: {
  scenario: Scenario; index: number; total: number; agents: AgentConfig[]; servers: ServerConfig[];
  configId?: string;
  configPath?: string;
  defaultAssistantAgentName?: string;
  assistantInitialPrompt?: string;
  assistantAutoOpenNonce?: number;
  snapshotEval?: { enabled: boolean; mode: "warn" | "fail_on_drift"; baselineSnapshotId?: string };
  onUpdate: (patch: Partial<Scenario>) => void; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void; readOnly?: boolean;
}) {
  const [newRuleType, setNewRuleType] = useState<EvalRule["type"]>("required_tool");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newExtractName, setNewExtractName] = useState("");
  const [newExtractPattern, setNewExtractPattern] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);

  const addRule = () => {
    if (!newRuleValue.trim()) return;
    onUpdate({ evalRules: [...scenario.evalRules, { type: newRuleType, value: newRuleValue.trim() }] });
    setNewRuleValue("");
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
  };

  const ruleTypeBadgeColor: Record<EvalRule["type"], string> = {
    required_tool: "border-sky-300/60 bg-sky-500/10 text-sky-700",
    forbidden_tool: "border-rose-300/60 bg-rose-500/10 text-rose-700",
    response_contains: "border-violet-300/60 bg-violet-500/10 text-violet-700",
    response_not_contains: "border-amber-300/60 bg-amber-500/10 text-amber-700",
  };
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

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">
          {index + 1}. {scenario.name || `Scenario ${index + 1}`}
        </CardTitle>
        {!readOnly && (
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
              <Sparkles className="h-3.5 w-3.5" />
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
      <CardContent className="space-y-3">
        <ScenarioAssistantDialog
          open={assistantOpen}
          onOpenChange={setAssistantOpen}
          configId={configId}
          configPath={configPath}
          scenario={scenario}
          agents={agents}
          servers={servers}
          snapshotEval={snapshotEval}
          defaultAssistantAgentName={defaultAssistantAgentName}
          initialUserMessage={assistantInitialPrompt}
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
                    <Sparkles className="h-3.5 w-3.5" />
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
                            <span className="font-mono break-all">{rule.value}</span>
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
                  <div className="flex gap-2 items-end">
                    <Select value={newRuleType} onValueChange={(v) => setNewRuleType(v as EvalRule["type"])}>
                      <SelectTrigger className="h-8 w-[14.5rem] shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="required_tool">Required Tool</SelectItem>
                        <SelectItem value="forbidden_tool">Forbidden Tool</SelectItem>
                        <SelectItem value="response_contains">Text matches pattern</SelectItem>
                        <SelectItem value="response_not_contains">Text must not match</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={newRuleValue} onChange={(e) => setNewRuleValue(e.target.value)} placeholder="Value" className="h-8 text-xs font-mono" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())} />
                    <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={addRule}>Add</Button>
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
                    <Sparkles className="h-3.5 w-3.5" />
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
      </CardContent>
    </Card>
  );
}
