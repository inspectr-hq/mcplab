import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AgentConfig, ServerConfig, Scenario, EvalRule, ExtractRule } from "@/types/eval";
import { useState } from "react";

interface ScenarioFormProps {
  scenarios: Scenario[];
  agents: AgentConfig[];
  servers: ServerConfig[];
  onChange: (scenarios: Scenario[]) => void;
  readOnly?: boolean;
}

const emptyScenario = (): Scenario => ({
  id: `scn-${Date.now()}`,
  name: "",
  agentId: "",
  serverIds: [],
  prompt: "",
  testMode: "total",
  steps: [],
  evalRules: [],
  extractRules: [],
});

export function ScenarioForm({ scenarios, agents, servers, onChange, readOnly }: ScenarioFormProps) {
  const update = (index: number, patch: Partial<Scenario>) => {
    const next = scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const remove = (index: number) => onChange(scenarios.filter((_, i) => i !== index));
  const add = () => onChange([...scenarios, emptyScenario()]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scenarios</h3>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Add Scenario
          </Button>
        )}
      </div>
      {scenarios.map((sc, i) => (
        <ScenarioCard key={sc.id} scenario={sc} index={i} agents={agents} servers={servers} onUpdate={(patch) => update(i, patch)} onRemove={() => remove(i)} readOnly={readOnly} />
      ))}
      {scenarios.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No scenarios configured. Add one to get started.</p>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, index, agents, servers, onUpdate, onRemove, readOnly }: {
  scenario: Scenario; index: number; agents: AgentConfig[]; servers: ServerConfig[];
  onUpdate: (patch: Partial<Scenario>) => void; onRemove: () => void; readOnly?: boolean;
}) {
  const [newRuleType, setNewRuleType] = useState<EvalRule["type"]>("required_tool");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newExtractName, setNewExtractName] = useState("");
  const [newExtractPattern, setNewExtractPattern] = useState("");

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

  const ruleTypeColor: Record<EvalRule["type"], string> = {
    required_tool: "bg-success/10 text-success border-success/20",
    forbidden_tool: "bg-destructive/10 text-destructive border-destructive/20",
    response_contains: "bg-primary/10 text-primary border-primary/20",
    response_not_contains: "bg-muted text-muted-foreground border-border",
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">{scenario.name || `Scenario ${index + 1}`}</CardTitle>
        {!readOnly && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={scenario.name} onChange={(e) => onUpdate({ name: e.target.value })} disabled={readOnly} placeholder="e.g. List directory" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Agent</Label>
            <Select value={scenario.agentId} onValueChange={(v) => onUpdate({ agentId: v })} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

        <div className="space-y-1.5">
          <Label className="text-xs">Prompt</Label>
          <Textarea value={scenario.prompt} onChange={(e) => onUpdate({ prompt: e.target.value })} disabled={readOnly} placeholder="The prompt to send to the agent..." rows={3} className="text-xs" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Test Mode</Label>
            <Select value={scenario.testMode} onValueChange={(v) => onUpdate({ testMode: v as Scenario["testMode"] })} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total scenario</SelectItem>
                <SelectItem value="per_step">Per step</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Execution</Label>
            <p className="rounded-md border bg-muted/20 px-2 py-2 text-xs text-muted-foreground">
              {scenario.testMode === "per_step"
                ? "Each step is executed independently in order."
                : "Single run using the scenario prompt."}
            </p>
          </div>
        </div>

        {scenario.testMode === "per_step" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Steps (one per line)</Label>
            <Textarea
              value={scenario.steps.join("\n")}
              onChange={(e) =>
                onUpdate({
                  steps: e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                })
              }
              disabled={readOnly}
              placeholder="Step 1&#10;Step 2&#10;Step 3"
              rows={4}
              className="text-xs"
            />
          </div>
        )}

        {/* Eval Rules */}
        <div className="space-y-2">
          <Label className="text-xs">Eval Rules</Label>
          <div className="flex flex-wrap gap-1.5">
            {scenario.evalRules.map((rule, ri) => (
              <Badge key={ri} variant="outline" className={`text-xs gap-1 ${ruleTypeColor[rule.type]}`}>
                <span className="font-semibold">{ruleTypeLabel[rule.type]}:</span> {rule.value}
                {!readOnly && (
                  <X className="h-3 w-3 cursor-pointer ml-0.5" onClick={() => removeRule(ri)} />
                )}
              </Badge>
            ))}
          </div>
          {!readOnly && (
            <div className="flex gap-2 items-end">
              <Select value={newRuleType} onValueChange={(v) => setNewRuleType(v as EvalRule["type"])}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="required_tool">Required Tool</SelectItem>
                  <SelectItem value="forbidden_tool">Forbidden Tool</SelectItem>
                  <SelectItem value="response_contains">Response Contains</SelectItem>
                  <SelectItem value="response_not_contains">Not Contains</SelectItem>
                </SelectContent>
              </Select>
              <Input value={newRuleValue} onChange={(e) => setNewRuleValue(e.target.value)} placeholder="Value" className="h-8 text-xs font-mono" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRule())} />
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={addRule}>Add</Button>
            </div>
          )}
        </div>

        {/* Extract Rules */}
        <div className="space-y-2">
          <Label className="text-xs">Extract Rules</Label>
          <div className="flex flex-wrap gap-1.5">
            {scenario.extractRules.map((rule, ri) => (
              <Badge key={ri} variant="outline" className="text-xs gap-1">
                <span className="font-semibold">{rule.name}:</span> <code className="font-mono">{rule.pattern}</code>
                {!readOnly && (
                  <X className="h-3 w-3 cursor-pointer ml-0.5" onClick={() => removeExtract(ri)} />
                )}
              </Badge>
            ))}
          </div>
          {!readOnly && (
            <div className="flex gap-2 items-end">
              <Input value={newExtractName} onChange={(e) => setNewExtractName(e.target.value)} placeholder="Name" className="h-8 text-xs w-28" />
              <Input value={newExtractPattern} onChange={(e) => setNewExtractPattern(e.target.value)} placeholder="Regex pattern" className="h-8 text-xs font-mono" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtract())} />
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={addExtract}>Add</Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
