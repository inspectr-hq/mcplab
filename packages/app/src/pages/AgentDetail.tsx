import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AgentTypeIcon } from '@/components/AgentTypeIcon';
import { ArrowLeft, Check, ChevronDown, Loader2, RefreshCw, Wifi, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useLibraries } from '@/contexts/useLibraries';
import { useDataSource } from '@/contexts/useDataSource';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { DEFAULT_AGENT_TEMPERATURE, resolveAgentTemperature } from '@/lib/agent-temperature';
import { createEmptyAgent } from '@/lib/agent-factory';
import type {
  AgentConfig,
  AgentConnectionTestResult,
  ProviderModelsResponse,
  LlmAgentConfig
} from '@/types/eval';
import { formatProvider } from '@/lib/provider-format';
import { useRoverStatus } from '@/hooks/use-rover-status';

const modelSuggestions: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  azure: ['gpt-4o', 'gpt-4-turbo'],
  azure_foundry: [],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  custom: []
};

const providerHints: Record<string, string> = {
  anthropic: 'Check that `ANTHROPIC_API_KEY` is set in your environment',
  openai: 'Check that `OPENAI_API_KEY` is set in your environment',
  azure: 'Check that Azure OpenAI env vars are configured in your environment',
  azure_foundry:
    'Set AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY, or reuse AZURE_OPENAI_API_KEY for the same resource.'
};

type ConnectState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: AgentConnectionTestResult; testedAt: string }
  | { status: 'error'; message: string; testedAt: string }
  | { status: 'unsupported' };

const AgentDetail = () => {
  const { agentName } = useParams<{ agentName: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { agents, setAgents, browserProviders } = useLibraries();
  const { source } = useDataSource();
  const roverStatus = useRoverStatus();

  const isNew = agentName === 'new';
  const decodedParam = agentName ? decodeURIComponent(agentName) : '';
  const existingAgent = isNew
    ? null
    : (agents.find((a) => a.id === decodedParam) ?? agents.find((a) => a.name === decodedParam));

  const requestedType = searchParams.get('type') === 'browser' ? 'browser' : 'llm';
  const [form, setForm] = useState<AgentConfig>(
    () => existingAgent ?? createEmptyAgent(requestedType)
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectState, setConnectState] = useState<ConnectState>({ status: 'idle' });
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [providerModels, setProviderModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [openModelPicker, setOpenModelPicker] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const connectionController = useRef<AbortController | null>(null);
  const modelRequest = useRef({ revision: 0 });
  const hydratedRouteRef = useRef<string | null>(null);
  const browserProviderOptions = Object.values(browserProviders).map((provider) => ({
    id: provider.id,
    name: provider.name
  }));

  useEffect(() => {
    const routeKey = isNew
      ? `new:${requestedType}:${decodedParam || 'new'}`
      : `agt:${decodedParam}`;
    if (hydratedRouteRef.current === routeKey) return;
    if (isNew) {
      setForm(createEmptyAgent(requestedType));
      hydratedRouteRef.current = routeKey;
      return;
    }
    if (!existingAgent) return;
    setForm(existingAgent);
    hydratedRouteRef.current = routeKey;
  }, [isNew, decodedParam, existingAgent, requestedType]);

  useEffect(() => {
    connectionController.current?.abort();
    connectionController.current = null;
    setConnectState({ status: 'idle' });
    setShowConnectPanel(false);
    return () => connectionController.current?.abort();
  }, [form]);

  useEffect(() => {
    const requestState = modelRequest.current;
    requestState.revision++;
    setProviderModels(null);
    setLoadingModels(false);
    return () => {
      requestState.revision++;
    };
  }, [form.provider]);

  const isAzureDeployment = form.provider === 'azure' || form.provider === 'azure_foundry';
  const supportsDiscovery =
    form.provider === 'anthropic' || form.provider === 'openai' || isAzureDeployment;

  const modelOptions = Array.from(
    new Set([...(modelSuggestions[form.provider] || []), ...(providerModels ?? [])])
  );

  const isKnownModel = modelOptions.includes(form.model);
  const showManualField =
    isAzureDeployment || showManualInput || (Boolean(form.model) && !isKnownModel);

  const handleConnect = async () => {
    setShowConnectPanel(true);
    if (form.type === 'browser') {
      setConnectState({ status: 'unsupported' });
      toast({
        title: 'Browser Agent connection is handled by Rover',
        description: 'Open Rover and connect the configured browser provider.'
      });
      return;
    }
    if (form.provider === 'google' || form.provider === 'custom') {
      setConnectState({ status: 'unsupported' });
      return;
    }
    const controller = new AbortController();
    connectionController.current?.abort();
    connectionController.current = controller;
    setConnectState({ status: 'loading' });
    try {
      const result = await source.testAgentConnection(form, controller.signal);
      if (controller.signal.aborted) return;
      setConnectState(
        result.ok
          ? { status: 'success', result, testedAt: new Date().toISOString() }
          : { status: 'error', message: result.message, testedAt: new Date().toISOString() }
      );
    } catch (err) {
      if (!controller.signal.aborted)
        setConnectState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          testedAt: new Date().toISOString()
        });
    } finally {
      if (connectionController.current === controller) connectionController.current = null;
    }
  };

  const fetchModels = async () => {
    if (!supportsDiscovery) {
      toast({
        title: 'Provider discovery not supported',
        description:
          'Model lists are available for Anthropic and OpenAI. Azure deployments use configured suggestions.'
      });
      return;
    }
    const requestState = modelRequest.current;
    const requestId = ++requestState.revision;
    setLoadingModels(true);
    try {
      const response = await source.listProviderModels(
        form.provider as ProviderModelsResponse['provider']
      );
      if (requestId !== requestState.revision) return;
      setProviderModels(response.items);
      toast({
        title: response.kind === 'deployments' ? 'Deployments loaded' : 'Models loaded',
        description: `${response.items.length} ${response.kind} from ${response.source}`
      });
    } catch (error: unknown) {
      if (requestId !== requestState.revision) return;
      toast({
        title: 'Could not load provider models',
        description: String(error instanceof Error ? error.message : error),
        variant: 'destructive'
      });
    } finally {
      if (requestId === requestState.revision) setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    if (form.type !== 'browser' && !form.model.trim()) {
      toast({
        title: isAzureDeployment ? 'Deployment name is required' : 'Model is required',
        variant: 'destructive'
      });
      return;
    }
    if (form.type === 'browser' && !form.url?.trim()) {
      toast({ title: 'Browser agent URL is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await setAgents([...agents, form]);
        toast({ title: 'Agent created' });
        navigate(`/libraries/agents/${encodeURIComponent(form.id)}`);
      } else {
        const next = agents.map((a) => (a.id === existingAgent?.id ? form : a));
        await setAgents(next);
        toast({ title: 'Agent saved' });
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
    toast({ title: 'Agent deleted' });
    navigate('/libraries/agents');
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

  const roverConnected = roverStatus.connected && roverStatus.provider === form.provider;

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
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <AgentTypeIcon agent={form} className="h-6 w-6" />
            {isNew ? 'New Agent' : form.name}
          </h1>
        </div>
        {form.type === 'browser' ? (
          <div className="flex items-center gap-2">
            {roverConnected && roverStatus.pageUrl ? (
              <a
                href={roverStatus.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="max-w-xs rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title={`Open ${roverStatus.pageUrl}`}
              >
                <span className="block truncate">{roverStatus.pageUrl}</span>
              </a>
            ) : null}
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span
                className={`h-2.5 w-2.5 rounded-full ${roverConnected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
              />
              <span>{roverConnected ? 'Rover connected' : 'Rover not connected'}</span>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connectState.status === 'loading'}
          >
            <Wifi className="mr-2 h-4 w-4" />
            Test Connection
          </Button>
        )}
      </div>

      {form.type !== 'browser' && (
        <p className="text-xs text-muted-foreground">
          Test Connection sends a small inference request to the configured model or deployment
          using backend credentials. It does not save the agent.
        </p>
      )}

      {/* Connect Panel */}
      {showConnectPanel && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Connection Test</CardTitle>
            <button
              type="button"
              onClick={() => {
                connectionController.current?.abort();
                setConnectState({ status: 'idle' });
                setShowConnectPanel(false);
              }}
              aria-label="Close connection test"
              className="rounded-sm opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>Provider:</span>
              <span className="font-medium text-foreground">{formatProvider(form.provider)}</span>
              <span>·</span>
              <span>{isAzureDeployment ? 'Deployment' : 'Model'}:</span>
              <code className="font-mono text-xs">{form.model}</code>
            </div>

            {connectState.status === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing connection...
              </div>
            )}

            {connectState.status === 'success' && (
              <div className="space-y-2">
                <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">
                  <Check className="h-4 w-4 shrink-0" />
                  {connectState.result.message}
                </p>
                <p className="text-xs text-muted-foreground">
                  {connectState.result.model && <>Returned model: {connectState.result.model} · </>}
                  {connectState.result.durationMs} ms · Tested at{' '}
                  {new Date(connectState.testedAt).toLocaleString()}
                </p>
              </div>
            )}

            {connectState.status === 'error' && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  <span className="font-medium">✗ Connection failed</span>. {connectState.message}
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

            {connectState.status === 'unsupported' && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Connection testing is not supported for the{' '}
                <span className="font-medium">{form.provider}</span> provider. Supported providers:
                Anthropic, OpenAI, Azure OpenAI, Azure Foundry.
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
              <Label>Agent type</Label>
              <Select
                value={form.type ?? 'llm'}
                onValueChange={(v) =>
                  setForm((f) =>
                    v === 'browser'
                      ? {
                          id: f.id,
                          name: f.name,
                          type: 'browser',
                          provider: 'claude',
                          model: '',
                          maxTokens: 0,
                          url: f.type === 'browser' ? f.url : '',
                          newConversationBetweenScenarios:
                            f.type === 'browser' ? f.newConversationBetweenScenarios : true
                        }
                      : {
                          id: f.id,
                          name: f.name,
                          type: 'llm',
                          provider: 'openai',
                          model: f.model || 'gpt-4o',
                          maxTokens: f.maxTokens || 4096,
                          temperature: f.type === 'llm' ? f.temperature : DEFAULT_AGENT_TEMPERATURE,
                          maxTurns: f.type === 'llm' ? f.maxTurns : undefined,
                          systemPrompt: f.type === 'llm' ? f.systemPrompt : undefined
                        }
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llm">LLM Agent</SelectItem>
                  <SelectItem value="browser">Browser Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-provider">Provider</Label>
              <Select
                value={form.provider}
                onValueChange={(v) =>
                  setForm((f) =>
                    f.type === 'browser'
                      ? { ...f, provider: v }
                      : {
                          ...f,
                          provider: v as LlmAgentConfig['provider'],
                          model: modelSuggestions[v]?.[0] || ''
                        }
                  )
                }
              >
                <SelectTrigger id="agent-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {form.type === 'browser' ? (
                    browserProviderOptions.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="azure">Azure OpenAI</SelectItem>
                      <SelectItem value="azure_foundry">Azure Foundry</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {form.type === 'browser' && (
              <div className="space-y-1.5">
                <Label htmlFor="agent-conversation-behavior">Conversation behavior</Label>
                <Select
                  value={form.newConversationBetweenScenarios === false ? 'same' : 'new'}
                  onValueChange={(value) =>
                    setForm((current) =>
                      current.type === 'browser'
                        ? {
                            ...current,
                            newConversationBetweenScenarios: value !== 'same'
                          }
                        : current
                    )
                  }
                >
                  <SelectTrigger id="agent-conversation-behavior">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Start a new conversation between scenarios</SelectItem>
                    <SelectItem value="same">Continue the same conversation</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Default for queue runs. It can be overridden when starting an evaluation.
                </p>
              </div>
            )}
          </div>

          {form.type === 'browser' && (
            <div className="space-y-1.5">
              <Label>Browser agent URL</Label>
              <Input
                value={form.url ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://provider.example"
              />
              <p className="text-[11px] text-muted-foreground">
                Rover opens this URL when the queued Browser Agent needs attention.
              </p>
            </div>
          )}

          {form.type !== 'browser' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="agent-model">
                  {isAzureDeployment ? 'Deployment name' : 'Model'}
                </Label>
                <div className="flex items-center gap-2">
                  {isAzureDeployment ? (
                    <>
                      <Input
                        id="agent-model"
                        value={form.model}
                        onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                        placeholder="Type deployment name manually"
                        list="agent-deployment-suggestions"
                        className="h-9 min-w-0 flex-1 font-mono text-xs"
                      />
                      <datalist id="agent-deployment-suggestions">
                        {modelOptions.map((deployment) => (
                          <option key={deployment} value={deployment} />
                        ))}
                      </datalist>
                    </>
                  ) : (
                    <Popover open={openModelPicker} onOpenChange={setOpenModelPicker}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          id={showManualField ? undefined : 'agent-model'}
                          aria-expanded={openModelPicker}
                          aria-controls="agent-model-command-list"
                          className="h-9 flex-1 justify-between font-mono text-xs"
                        >
                          <span className="truncate text-left">
                            {form.model ||
                              (isAzureDeployment ? 'Select deployment...' : 'Select model...')}
                          </span>
                          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[420px] p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder={`Search ${isAzureDeployment ? 'deployments' : 'models'}...`}
                          />
                          <CommandList id="agent-model-command-list">
                            <CommandEmpty>
                              No {isAzureDeployment ? 'deployments' : 'models'} found.
                            </CommandEmpty>
                            <CommandGroup heading={isAzureDeployment ? 'Deployments' : 'Models'}>
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
                                      'mr-2 h-4 w-4',
                                      form.model === modelName ? 'opacity-100' : 'opacity-0'
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
                                  {isAzureDeployment
                                    ? 'Custom deployment ID...'
                                    : 'Custom model ID...'}
                                </span>
                              </CommandItem>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                  {supportsDiscovery && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 text-xs"
                      onClick={() => void fetchModels()}
                      disabled={loadingModels}
                      title={
                        isAzureDeployment
                          ? 'Load deployment suggestions from backend environment variables'
                          : `Fetch ${form.provider} models`
                      }
                    >
                      {loadingModels ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
                      {isAzureDeployment ? 'Load configured deployments' : 'Fetch Models'}
                    </Button>
                  )}
                </div>
                {showManualField && !isAzureDeployment && (
                  <Input
                    id="agent-model"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder={
                      isAzureDeployment
                        ? 'Type deployment name manually'
                        : 'Type model name manually'
                    }
                    className="font-mono text-xs"
                  />
                )}
                {form.provider === 'azure_foundry' && (
                  <p className="text-xs text-muted-foreground">
                    Set AZURE_FOUNDRY_ENDPOINT on the backend and AZURE_FOUNDRY_API_KEY, or reuse
                    AZURE_OPENAI_API_KEY for the same resource. Enter the exact deployment name.
                    Suggestions come from AZURE_FOUNDRY_DEPLOYMENTS; they do not query Azure.
                  </p>
                )}
                {form.provider === 'azure' && (
                  <p className="text-xs text-muted-foreground">
                    Uses the selected deployment when it matches configured deployment suggestions;
                    otherwise falls back to AZURE_OPENAI_DEPLOYMENT. Azure Foundry uses the
                    deployment selected for each agent.
                  </p>
                )}
                {providerModels !== null &&
                  (providerModels.length > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Loaded {providerModels.length}{' '}
                      {isAzureDeployment
                        ? 'deployment names from configuration'
                        : 'models from provider discovery'}
                      .
                    </p>
                  ) : form.provider === 'azure' ? (
                    <p className="text-xs text-muted-foreground">
                      Set AZURE_OPENAI_DEPLOYMENT on the MCPLab backend as the fallback.
                      AZURE_OPENAI_DEPLOYMENTS and AZURE_OPENAI_DEPLOYMENT_NAME add selectable
                      deployment suggestions.
                    </p>
                  ) : null)}
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
          )}

          {form.type !== 'browser' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Max Turns</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxTurns ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setForm((f) => ({ ...f, maxTurns: v ? parseInt(v) || undefined : undefined }));
                  }}
                  placeholder="30 (default)"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Maximum number of LLM round-trips (tool calls + final answer) per eval run.
                </p>
              </div>
            </div>
          )}

          {form.type !== 'browser' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Temperature</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {resolveAgentTemperature(form.temperature).toFixed(2)}
                </span>
              </div>
              <Slider
                value={[resolveAgentTemperature(form.temperature)]}
                onValueChange={([v]) => setForm((f) => ({ ...f, temperature: v }))}
                min={0}
                max={2}
                step={0.01}
              />
            </div>
          )}

          {form.type !== 'browser' && (
            <div className="space-y-1.5">
              <Label>System Prompt</Label>
              <Textarea
                value={form.systemPrompt || ''}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="Optional system prompt..."
                rows={3}
                className="text-xs"
              />
            </div>
          )}

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
                onClick={() => navigate('/libraries/agents')}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isNew ? 'Create Agent' : 'Save'}
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
              This will permanently remove the agent <span className="font-mono">{form.name}</span>.
              This action cannot be undone.
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
