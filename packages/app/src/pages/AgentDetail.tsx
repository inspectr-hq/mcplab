import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, Loader2, RefreshCw, Wifi, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLibraries } from "@/contexts/LibraryContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/types/eval";

const modelSuggestions: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
  azure: ["gpt-4o", "gpt-4-turbo"],
  google: ["gemini-2.0-flash", "gemini-1.5-pro"],
  custom: [],
};

const providerHints: Record<string, string> = {
  anthropic: "Check that `ANTHROPIC_API_KEY` is set in your environment",
  openai: "Check that `OPENAI_API_KEY` is set in your environment",
  azure: "Check that Azure OpenAI env vars are configured in your environment",
};

type ConnectState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; items: string[]; source: string; kind: string; testedAt: string }
  | { status: "error"; message: string; testedAt: string }
  | { status: "unsupported" };

const emptyAgent = (): AgentConfig => ({
  id: `agt-${Date.now()}`,
  name: "",
  provider: "openai",
  model: "gpt-4o",
  temperature: 0,
  maxTokens: 4096,
});

const AgentDetail = () => {
  const { agentName } = useParams<{ agentName: string }>();
  const navigate = useNavigate();
  const { agents, setAgents } = useLibraries();
  const { source } = useDataSource();

  const isNew = agentName === "new";
  const decodedParam = agentName ? decodeURIComponent(agentName) : "";
  const existingAgent = isNew
    ? null
    : agents.find((a) => a.id === decodedParam) ?? agents.find((a) => a.name === decodedParam);

  const [form, setForm] = useState<AgentConfig>(() => existingAgent ?? emptyAgent());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectState, setConnectState] = useState<ConnectState>({ status: "idle" });
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [openModelPicker, setOpenModelPicker] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    if (existingAgent) setForm(existingAgent);
  }, [existingAgent]);

  const supportsDiscovery =
    form.provider === "anthropic" || form.provider === "openai" || form.provider === "azure";

  const modelOptions = Array.from(
    new Set([...(modelSuggestions[form.provider] || []), ...providerModels])
  );

  const isKnownModel = modelOptions.includes(form.model);
  const showManualField = showManualInput || (Boolean(form.model) && !isKnownModel);

  const handleConnect = async () => {
    setShowConnectPanel(true);
    if (form.provider === "google" || form.provider === "custom") {
      setConnectState({ status: "unsupported" });
      return;
    }
    setConnectState({ status: "loading" });
    try {
      const result = await source.listProviderModels(
        form.provider as "anthropic" | "openai" | "azure"
      );
      setConnectState({
        status: "success",
        items: result.items,
        source: result.source,
        kind: result.kind,
        testedAt: new Date().toISOString(),
      });
    } catch (err) {
      setConnectState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        testedAt: new Date().toISOString(),
      });
    }
  };

  const fetchModels = async () => {
    if (!supportsDiscovery) {
      toast({
        title: "Provider discovery not supported",
        description: "Model discovery is available for Anthropic, OpenAI, and Azure OpenAI.",
      });
      return;
    }
    setLoadingModels(true);
    try {
      const response = await source.listProviderModels(
        form.provider as "anthropic" | "openai" | "azure"
      );
      setProviderModels(response.items);
      toast({
        title: response.kind === "deployments" ? "Deployments loaded" : "Models loaded",
        description: `${response.items.length} ${response.kind} from ${response.source}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Could not load provider models",
        description: String(error instanceof Error ? error.message : error),
        variant: "destructive",
      });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await setAgents([...agents, form]);
        toast({ title: "Agent created" });
        navigate(`/libraries/agents/${encodeURIComponent(form.id)}`);
      } else {
        const next = agents.map((a) => (a.id === existingAgent?.id ? form : a));
        await setAgents(next);
        toast({ title: "Agent saved" });
        if (form.id !== decodedParam) {
          navigate(`/libraries/agents/${encodeURIComponent(form.id)}`, { replace: true });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const next = agents.filter((a) => a.id !== existingAgent?.id);
    await setAgents(next);
    toast({ title: "Agent deleted" });
    navigate("/libraries/agents");
  };

  if (!isNew && !existingAgent) {
    return (
      <div className="space-y-4">
        <Link
          to="/libraries/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Agents
        </Link>
        <p className="text-sm text-muted-foreground">Agent "{decodedParam}" not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <Link
            to="/libraries/agents"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Agents
          </Link>
          <h1 className="text-2xl font-bold">{isNew ? "New Agent" : form.name}</h1>
        </div>
        {!isNew && (
          <Button type="button" onClick={() => void handleConnect()}>
            <Wifi className="mr-2 h-4 w-4" />
            Test Connection
          </Button>
        )}
      </div>

      {/* Connect Panel */}
      {showConnectPanel && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Connection Test</CardTitle>
            <button
              type="button"
              onClick={() => setShowConnectPanel(false)}
              className="rounded-sm opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>Provider:</span>
              <span className="font-medium text-foreground">{form.provider}</span>
              <span className="mx-1">·</span>
              <span>Endpoint:</span>
              <code className="font-mono text-xs">/api/providers/models?provider={form.provider}</code>
            </div>

            {connectState.status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing connection...
              </div>
            )}

            {connectState.status === "success" && (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <Check className="h-4 w-4 shrink-0" />
                  Connected — discovered {connectState.items.length} {connectState.kind} from{" "}
                  {connectState.source}
                </p>
                <div className="rounded-md bg-muted p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    First 5 {connectState.kind}:
                  </p>
                  <ul className="space-y-0.5">
                    {connectState.items.slice(0, 5).map((item) => (
                      <li key={item} className="font-mono text-xs">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tested at {new Date(connectState.testedAt).toLocaleString()}
                </p>
              </div>
            )}

            {connectState.status === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">
                  <span className="font-medium">✗ Connection failed</span> —{" "}
                  {connectState.message}
                </p>
                {providerHints[form.provider] && (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Hint: {providerHints[form.provider]}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Tested at {new Date(connectState.testedAt).toLocaleString()}
                </p>
              </div>
            )}

            {connectState.status === "unsupported" && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Connection testing is not supported for the{" "}
                <span className="font-medium">{form.provider}</span> provider. Supported providers:
                Anthropic, OpenAI, Azure OpenAI.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. GPT-4o"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={form.provider}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    provider: v as AgentConfig["provider"],
                    model: modelSuggestions[v]?.[0] || "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{form.provider === "azure" ? "Deployment" : "Model"}</Label>
              <div className="flex items-center gap-2">
                <Popover open={openModelPicker} onOpenChange={setOpenModelPicker}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={openModelPicker}
                      className="h-9 flex-1 justify-between font-mono text-xs"
                    >
                      <span className="truncate text-left">{form.model || "Select model..."}</span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder={`Search ${form.provider === "azure" ? "deployments" : "models"}...`}
                      />
                      <CommandList>
                        <CommandEmpty>
                          No {form.provider === "azure" ? "deployments" : "models"} found.
                        </CommandEmpty>
                        <CommandGroup
                          heading={form.provider === "azure" ? "Deployments" : "Models"}
                        >
                          {modelOptions.map((modelName) => (
                            <CommandItem
                              key={modelName}
                              value={modelName}
                              onSelect={(value) => {
                                setForm((f) => ({ ...f, model: value }));
                                setShowManualInput(false);
                                setOpenModelPicker(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.model === modelName ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="font-mono text-xs">{modelName}</span>
                            </CommandItem>
                          ))}
                          <CommandItem
                            value="__custom_model_id__"
                            onSelect={() => {
                              setShowManualInput(true);
                              setOpenModelPicker(false);
                            }}
                          >
                            <span className="font-medium">
                              {form.provider === "azure"
                                ? "Custom deployment ID..."
                                : "Custom model ID..."}
                            </span>
                          </CommandItem>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {supportsDiscovery && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 text-xs"
                    onClick={() => void fetchModels()}
                    disabled={loadingModels}
                    title={
                      form.provider === "azure"
                        ? "Fetch Azure OpenAI deployments"
                        : `Fetch ${form.provider} models`
                    }
                  >
                    {loadingModels ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    {form.provider === "azure" ? "Fetch Deployments" : "Fetch Models"}
                  </Button>
                )}
              </div>
              {showManualField && (
                <Input
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder={
                    form.provider === "azure"
                      ? "Type deployment name manually"
                      : "Type model name manually"
                  }
                  className="font-mono text-xs"
                />
              )}
              {providerModels.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Loaded {providerModels.length}{" "}
                  {form.provider === "azure" ? "deployment names" : "models"} from provider
                  discovery.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Max Tokens</Label>
              <Input
                type="number"
                min={1}
                max={128000}
                value={form.maxTokens}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) || 0 }))
                }
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {form.temperature.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[form.temperature]}
              onValueChange={([v]) => setForm((f) => ({ ...f, temperature: v }))}
              min={0}
              max={2}
              step={0.01}
            />
          </div>

          <div className="space-y-1.5">
            <Label>System Prompt</Label>
            <Textarea
              value={form.systemPrompt || ""}
              onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
              placeholder="Optional system prompt..."
              rows={3}
              className="text-xs"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              {!isNew && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate("/libraries/agents")}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isNew ? "Create Agent" : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the agent{" "}
              <span className="font-mono">{form.name}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AgentDetail;
