import { Check, ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { AgentConfig } from "@/types/eval";
import { cn } from "@/lib/utils";

interface AgentFormProps {
  agents: AgentConfig[];
  onChange: (agents: AgentConfig[]) => void;
  defaultAgentNames?: string[];
  onToggleDefaultAgent?: (agentName: string, checked: boolean) => void;
  importReferenceOptions?: Array<{ value: string; label: string }>;
  selectedImportReference?: string;
  onSelectImportReference?: (value: string) => void;
  onImportSelectedReference?: () => void;
  readOnly?: boolean;
}

const modelSuggestions: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
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

export function AgentForm({
  agents,
  onChange,
  defaultAgentNames = [],
  onToggleDefaultAgent,
  importReferenceOptions = [],
  selectedImportReference = "",
  onSelectImportReference,
  onImportSelectedReference,
  readOnly
}: AgentFormProps) {
  const { source } = useDataSource();
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [openModelPickerFor, setOpenModelPickerFor] = useState<string | null>(null);
  const [manualModelInputFor, setManualModelInputFor] = useState<Record<string, boolean>>({});
  const [openAgents, setOpenAgents] = useState<Record<string, boolean>>({});

  const update = (index: number, patch: Partial<AgentConfig>) => {
    const next = agents.map((a, i) => (i === index ? { ...a, ...patch } : a));
    onChange(next);
  };

  const remove = (index: number) => {
    const target = agents[index];
    onChange(agents.filter((_, i) => i !== index));
    if (target) {
      setOpenAgents((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    }
  };
  const add = () => {
    const created = emptyAgent();
    onChange([created, ...agents]);
    setOpenAgents((prev) => ({ ...prev, [created.id]: true }));
  };
  const modelOptionsFor = (provider: AgentConfig["provider"]) =>
    Array.from(new Set([...(modelSuggestions[provider] || []), ...(providerModels[provider] || [])]));
  const fetchModels = async (provider: AgentConfig["provider"]) => {
    if (provider !== "anthropic" && provider !== "openai" && provider !== "azure") {
      toast({
        title: "Provider discovery not supported",
        description: "Model discovery is currently available for Anthropic, OpenAI, and Azure OpenAI.",
      });
      return;
    }
    setLoadingProvider(provider);
    try {
      const response = await source.listProviderModels(provider);
      setProviderModels((prev) => ({ ...prev, [provider]: response.items }));
      toast({
        title: response.kind === "deployments" ? "Deployments loaded" : "Models loaded",
        description: `${response.items.length} ${response.kind} from ${response.source}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Could not load provider models",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    } finally {
      setLoadingProvider((prev) => (prev === provider ? null : prev));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agents</h3>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Select value={selectedImportReference} onValueChange={onSelectImportReference}>
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue placeholder="Import agent from library..." />
              </SelectTrigger>
              <SelectContent>
                {importReferenceOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onImportSelectedReference}
              disabled={!selectedImportReference || !onImportSelectedReference}
            >
              Import agent
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Add Agent
            </Button>
          </div>
        )}
      </div>
      {agents.map((agent, i) => (
        <Collapsible
          key={agent.id}
          open={openAgents[agent.id] ?? false}
          onOpenChange={(open) => setOpenAgents((prev) => ({ ...prev, [agent.id]: open }))}
        >
          <Card className="border-dashed">
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <div className="flex min-w-0 items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7">
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", (openAgents[agent.id] ?? false) ? "rotate-0" : "-rotate-90")} />
                  </Button>
                </CollapsibleTrigger>
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm font-medium">{agent.name || `Agent ${i + 1}`}</CardTitle>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{agent.model}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={defaultAgentNames.includes(agent.name || agent.id)}
                    onChange={(e) => onToggleDefaultAgent?.(agent.name || agent.id, e.target.checked)}
                    disabled={readOnly || !onToggleDefaultAgent}
                  />
                  <span>Default</span>
                </label>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CollapsibleContent>
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
                <Label className="text-xs">{agent.provider === "azure" ? "Deployment" : "Model"}</Label>
                {(() => {
                  const modelOptions = modelOptionsFor(agent.provider);
                  const supportsDiscovery =
                    agent.provider === "anthropic" || agent.provider === "openai" || agent.provider === "azure";
                  const isKnownModel = modelOptions.includes(agent.model);
                  const showManualInput = Boolean(manualModelInputFor[agent.id]) || (Boolean(agent.model) && !isKnownModel);
                  return (
                    <>
                <div className="flex items-center gap-2">
                  <Popover
                    open={openModelPickerFor === agent.id}
                    onOpenChange={(open) => setOpenModelPickerFor(open ? agent.id : null)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={openModelPickerFor === agent.id}
                        className="h-9 flex-1 justify-between font-mono text-xs"
                        disabled={readOnly}
                      >
                        <span className="truncate text-left">{agent.model || "Select model..."}</span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[420px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder={`Search ${agent.provider === "azure" ? "deployments" : "models"}...`} />
                        <CommandList>
                          <CommandEmpty>
                            No {agent.provider === "azure" ? "deployments" : "models"} found.
                          </CommandEmpty>
                          <CommandGroup heading={agent.provider === "azure" ? "Deployments" : "Models"}>
                            {modelOptions.map((modelName) => (
                              <CommandItem
                                key={modelName}
                                value={modelName}
                                onSelect={(value) => {
                                  update(i, { model: value });
                                  setManualModelInputFor((prev) => ({ ...prev, [agent.id]: false }));
                                  setOpenModelPickerFor(null);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    agent.model === modelName ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="font-mono text-xs">{modelName}</span>
                              </CommandItem>
                            ))}
                            {!readOnly && (
                              <CommandItem
                                value="__custom_model_id__"
                                onSelect={() => {
                                  setManualModelInputFor((prev) => ({ ...prev, [agent.id]: true }));
                                  setOpenModelPickerFor(null);
                                }}
                              >
                                <span className="font-medium">
                                  {agent.provider === "azure" ? "Custom deployment ID..." : "Custom model ID..."}
                                </span>
                              </CommandItem>
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {!readOnly && supportsDiscovery && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 text-xs"
                      onClick={() => void fetchModels(agent.provider)}
                      disabled={loadingProvider === agent.provider}
                      title={
                        agent.provider === "azure"
                          ? "Fetch Azure OpenAI deployments from local app server (env-based)"
                          : `Fetch ${agent.provider} models from local app server`
                      }
                    >
                      {loadingProvider === agent.provider ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
                      {agent.provider === "azure" ? "Fetch Deployments" : "Fetch Models"}
                    </Button>
                  )}
                </div>
                {showManualInput && (
                  <div className="space-y-1">
                    <Input
                      value={agent.model}
                      onChange={(e) => update(i, { model: e.target.value })}
                      disabled={readOnly}
                      placeholder={agent.provider === "azure" ? "Type deployment name manually" : "Type model name manually"}
                      className="font-mono text-xs"
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => setManualModelInputFor((prev) => ({ ...prev, [agent.id]: false }))}
                      >
                        Hide manual input
                      </button>
                    )}
                  </div>
                )}
                {(providerModels[agent.provider]?.length ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Loaded {providerModels[agent.provider]?.length} {agent.provider === "azure" ? "deployment names" : "models"} from provider discovery.
                  </p>
                )}
                    </>
                  );
                })()}
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
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ))}
      {agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No agents configured. Add one to get started.</p>
      )}
    </div>
  );
}
