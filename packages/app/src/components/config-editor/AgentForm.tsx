import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentConfig } from "@/types/eval";

interface AgentFormProps {
  agents: AgentConfig[];
  onChange: (agents: AgentConfig[]) => void;
  readOnly?: boolean;
}

const modelSuggestions: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  azure: ["gpt-4o", "gpt-4-turbo"],
  google: ["gemini-2.0-flash", "gemini-1.5-pro"],
  custom: [],
};

const emptyAgent = (): AgentConfig => ({
  id: `agt-${Date.now()}`,
  name: "",
  provider: "openai",
  model: "gpt-4o",
  temperature: 0,
  maxTokens: 4096,
});

export function AgentForm({ agents, onChange, readOnly }: AgentFormProps) {
  const update = (index: number, patch: Partial<AgentConfig>) => {
    const next = agents.map((a, i) => (i === index ? { ...a, ...patch } : a));
    onChange(next);
  };

  const remove = (index: number) => onChange(agents.filter((_, i) => i !== index));
  const add = () => onChange([...agents, emptyAgent()]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agents</h3>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Add Agent
          </Button>
        )}
      </div>
      {agents.map((agent, i) => (
        <Card key={agent.id} className="border-dashed">
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{agent.name || `Agent ${i + 1}`}</CardTitle>
            {!readOnly && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={agent.name} onChange={(e) => update(i, { name: e.target.value })} disabled={readOnly} placeholder="e.g. GPT-4o" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <Select value={agent.provider} onValueChange={(v) => update(i, { provider: v as AgentConfig["provider"], model: modelSuggestions[v]?.[0] || "" })} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="azure">Azure OpenAI</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Model</Label>
                <Input value={agent.model} onChange={(e) => update(i, { model: e.target.value })} disabled={readOnly} placeholder="Model name" className="font-mono text-xs" list={`models-${agent.id}`} />
                <datalist id={`models-${agent.id}`}>
                  {(modelSuggestions[agent.provider] || []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Tokens</Label>
                <Input type="number" min={1} max={128000} value={agent.maxTokens} onChange={(e) => update(i, { maxTokens: parseInt(e.target.value) || 0 })} disabled={readOnly} className="font-mono text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Temperature</Label>
                <span className="text-xs font-mono text-muted-foreground">{agent.temperature.toFixed(2)}</span>
              </div>
              <Slider value={[agent.temperature]} onValueChange={([v]) => update(i, { temperature: v })} min={0} max={2} step={0.01} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">System Prompt</Label>
              <Textarea value={agent.systemPrompt || ""} onChange={(e) => update(i, { systemPrompt: e.target.value })} disabled={readOnly} placeholder="Optional system prompt..." rows={2} className="text-xs" />
            </div>
          </CardContent>
        </Card>
      ))}
      {agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No agents configured. Add one to get started.</p>
      )}
    </div>
  );
}
