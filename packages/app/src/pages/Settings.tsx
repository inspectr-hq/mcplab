import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  DECISION_DEFAULTS,
  DECISION_PROVIDERS,
  normalizeEvaluationDecisionConfig,
  type EvaluationDecisionConfig,
  type DecisionConnectionTestResult
} from '@/types/eval';
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { useLibraries } from '@/contexts/LibraryContext';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';

const SettingsPage = () => {
  const { source } = useDataSource();
  const { agents, reload: reloadLibraries, loading: librariesLoading } = useLibraries();
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [scenarioAssistantAgentName, setScenarioAssistantAgentName] = useState<string>('');
  const [evaluationJudgeAgentName, setEvaluationJudgeAgentName] = useState<string>('');
  const [defaultQueueWorkers, setDefaultQueueWorkers] = useState<string>('1');
  const [decisionProvider, setDecisionProvider] = useState<
    EvaluationDecisionConfig['provider'] | ''
  >('');
  const [decisionModel, setDecisionModel] = useState('');
  const [decisionEnabled, setDecisionEnabled] = useState(false);
  const [decisionBaseUrl, setDecisionBaseUrl] = useState<string>(DECISION_DEFAULTS.baseUrl);
  const [decisionPassThreshold, setDecisionPassThreshold] = useState(
    String(DECISION_DEFAULTS.passThreshold)
  );
  const [decisionFailThreshold, setDecisionFailThreshold] = useState(
    String(DECISION_DEFAULTS.failThreshold)
  );
  const [savedDecision, setSavedDecision] = useState<EvaluationDecisionConfig>();
  const [decisionError, setDecisionError] = useState('');
  const [testingDecision, setTestingDecision] = useState(false);
  const [decisionConnectionResult, setDecisionConnectionResult] =
    useState<DecisionConnectionTestResult>();
  const decisionTestController = useRef<AbortController | null>(null);
  const llmAgents = agents.filter((agent) => agent.type !== 'browser');

  useEffect(() => {
    decisionTestController.current?.abort();
    decisionTestController.current = null;
    setTestingDecision(false);
    setDecisionConnectionResult(undefined);
  }, [
    decisionProvider,
    decisionEnabled,
    decisionModel,
    decisionBaseUrl,
    decisionPassThreshold,
    decisionFailThreshold,
    source
  ]);

  useEffect(
    () => () => {
      decisionTestController.current?.abort();
      decisionTestController.current = null;
    },
    []
  );

  const applyDecisionSettings = (decision?: EvaluationDecisionConfig) => {
    setSavedDecision(decision);
    let normalized: EvaluationDecisionConfig | undefined;
    let error = '';
    try {
      normalized = decision ? normalizeEvaluationDecisionConfig(decision) : undefined;
    } catch {
      error =
        'Saved Decision Engine configuration is invalid. Select a provider to replace it, or save None to clear it. Semantic checks fall back to the Evaluation Judge.';
    }
    setDecisionProvider(normalized?.provider ?? '');
    setDecisionEnabled(Boolean(normalized) && normalized?.enabled !== false);
    setDecisionModel(normalized?.model ?? '');
    setDecisionBaseUrl(normalized?.baseUrl ?? DECISION_DEFAULTS.baseUrl);
    setDecisionPassThreshold(String(normalized?.passThreshold ?? DECISION_DEFAULTS.passThreshold));
    setDecisionFailThreshold(String(normalized?.failThreshold ?? DECISION_DEFAULTS.failThreshold));
    setDecisionError(error);
  };

  const effectiveAssistantAgentName = useMemo(
    () => scenarioAssistantAgentName || agents[0]?.name || '',
    [scenarioAssistantAgentName, agents]
  );

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const settings = await source.getWorkspaceSettings();
      setScenarioAssistantAgentName(settings?.scenarioAssistantAgentName ?? '');
      setEvaluationJudgeAgentName(settings?.evaluationJudgeAgentName ?? '');
      setDefaultQueueWorkers(String(settings?.defaultQueueWorkers ?? 1));
      applyDecisionSettings(settings?.evaluationDecision);
    } catch (error: unknown) {
      setScenarioAssistantAgentName('');
      setEvaluationJudgeAgentName('');
      setDefaultQueueWorkers('1');
      applyDecisionSettings();
      toast({
        title: 'Could not load settings',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setLoadingSettings(false);
    }
  }, [source]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveAssistantAgentSetting = async (nextAgentName: string) => {
    const previousAgentName = scenarioAssistantAgentName;
    setScenarioAssistantAgentName(nextAgentName);
    setSavingSettings(true);
    try {
      await source.updateWorkspaceSettings({
        scenarioAssistantAgentName: nextAgentName || undefined
      });
      toast({
        title: 'Settings updated',
        description: nextAgentName
          ? `Default assistant agent set to ${nextAgentName}.`
          : 'Default assistant agent cleared (will use first available agent by default).'
      });
    } catch (error: unknown) {
      setScenarioAssistantAgentName(previousAgentName);
      toast({
        title: 'Could not save settings',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const saveDefaultQueueWorkers = async (nextValue: string) => {
    const previousValue = defaultQueueWorkers;
    setDefaultQueueWorkers(nextValue);
    setSavingSettings(true);
    try {
      await source.updateWorkspaceSettings({
        defaultQueueWorkers: Number(nextValue)
      });
      toast({
        title: 'Settings updated',
        description: `Evaluation workers set to ${nextValue}.`
      });
    } catch (error: unknown) {
      setDefaultQueueWorkers(previousValue);
      toast({
        title: 'Could not save settings',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const saveEvaluationJudgeSetting = async (nextAgentName: string) => {
    if (!nextAgentName && savedDecision && savedDecision.enabled !== false) {
      setDecisionError(
        'Turn off and save, or clear, the Decision Engine before removing its backup LLM evaluation judge.'
      );
      return;
    }
    const previousAgentName = evaluationJudgeAgentName;
    setEvaluationJudgeAgentName(nextAgentName);
    setSavingSettings(true);
    try {
      await source.updateWorkspaceSettings({
        evaluationJudgeAgentName: nextAgentName || null
      });
      toast({
        title: 'Settings updated',
        description: nextAgentName
          ? `Default evaluation judge set to ${nextAgentName}.`
          : 'Default evaluation judge cleared.'
      });
    } catch (error: unknown) {
      setEvaluationJudgeAgentName(previousAgentName);
      toast({
        title: 'Could not save settings',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const readDecisionDraft = (): EvaluationDecisionConfig | null => {
    if (!decisionProvider) return null;
    if (!decisionPassThreshold.trim() || !decisionFailThreshold.trim()) {
      throw new Error('Enter both pass and fail probability thresholds.');
    }
    return normalizeEvaluationDecisionConfig({
      provider: decisionProvider,
      model: decisionModel,
      passThreshold: Number(decisionPassThreshold),
      failThreshold: Number(decisionFailThreshold),
      ...(!decisionEnabled ? { enabled: false } : {}),
      ...(decisionProvider === 'ollama' ? { baseUrl: decisionBaseUrl } : {})
    });
  };

  const testDecisionSettings = async () => {
    let decision: EvaluationDecisionConfig | null;
    try {
      decision = readDecisionDraft();
      if (!decision) throw new Error('Select a Decision Engine before testing the connection.');
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : String(error));
      return;
    }
    const controller = new AbortController();
    decisionTestController.current = controller;
    setTestingDecision(true);
    setDecisionError('');
    setDecisionConnectionResult(undefined);
    try {
      const result = await source.testDecisionConnection(decision, controller.signal);
      if (!controller.signal.aborted) setDecisionConnectionResult(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        setDecisionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (decisionTestController.current === controller) {
        decisionTestController.current = null;
        setTestingDecision(false);
      }
    }
  };

  const saveDecisionSettings = async () => {
    let decision: EvaluationDecisionConfig | null = null;
    try {
      decision = readDecisionDraft();
      if (decision && decision.enabled !== false) {
        if (
          !llmAgents.some(
            (agent) =>
              agent.id === evaluationJudgeAgentName || agent.name === evaluationJudgeAgentName
          )
        ) {
          throw new Error(
            'Select an LLM evaluation judge as backup before enabling the Decision Engine.'
          );
        }
      }
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : String(error));
      return;
    }
    setSavingSettings(true);
    setDecisionError('');
    try {
      await source.updateWorkspaceSettings({ evaluationDecision: decision });
      setSavedDecision(decision ?? undefined);
      toast({
        title: 'Settings updated',
        description: decision
          ? 'Decision Engine configuration saved.'
          : 'Decision Engine cleared. Semantic checks use the Evaluation Judge.'
      });
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([reloadLibraries(), loadSettings()]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <SettingsIcon className="h-6 w-6" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Workspace-level MCP Lab settings and defaults.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void refreshAll()}
          disabled={librariesLoading || loadingSettings || savingSettings || testingDecision}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Assistant Defaults</CardTitle>
          <CardDescription>
            Default assistant agent used across assistant flows. If unset, MCP Lab uses the first
            available agent automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Default Assistant Agent</Label>
            <Select
              value={effectiveAssistantAgentName || '__none__'}
              onValueChange={(value) =>
                void saveAssistantAgentSetting(value === '__none__' ? '' : value)
              }
              disabled={savingSettings}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select assistant agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (use first agent)</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name || agent.id} · {agent.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Applies to the assistant flows that use the workspace default. MCP Evaluation editors
              can still override the assistant agent from their evaluation context.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">Saved in workspace settings</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Evaluation Judge</CardTitle>
          <CardDescription>
            Default judge agent used by semantic agent checks during scenario evaluation runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="evaluation-judge">
              Default Evaluation Judge
            </Label>
            <Select
              value={evaluationJudgeAgentName || '__none__'}
              onValueChange={(value) =>
                void saveEvaluationJudgeSetting(value === '__none__' ? '' : value)
              }
              disabled={savingSettings}
            >
              <SelectTrigger id="evaluation-judge" className="h-9 text-sm">
                <SelectValue placeholder="Select evaluation judge" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {llmAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name || agent.id} · {agent.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used by agent checks that semantically evaluate the final answer. If unset, runs with
              agent checks will fail before execution.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">Saved in workspace settings</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base">Decision Engine</CardTitle>
            <Switch
              id="decision-enabled"
              className="shrink-0"
              checked={decisionEnabled}
              onCheckedChange={setDecisionEnabled}
              disabled={!decisionProvider || savingSettings || loadingSettings}
              aria-label="Use Decision Engine"
              aria-describedby="decision-enabled-help"
            />
          </div>
          <CardDescription>
            Optionally evaluate semantic checks with a decision model. The Evaluation Judge handles
            uncertain decisions and unavailable engines.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p id="decision-enabled-help" className="text-xs text-muted-foreground">
            {decisionEnabled
              ? 'On: semantic checks use the Decision Engine with judge fallback.'
              : 'Off: semantic checks use the Evaluation Judge. Your decision configuration is kept.'}{' '}
            Click Save Decision Engine to apply changes.
          </p>
          <div className="space-y-1.5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="decision-provider" className="text-xs">
                  Decision provider
                </Label>
                <Select
                  value={decisionProvider || '__none__'}
                  disabled={savingSettings || loadingSettings}
                  onValueChange={(value) => {
                    const provider =
                      value === '__none__' ? '' : (value as EvaluationDecisionConfig['provider']);
                    setDecisionProvider(provider);
                    if (!provider) setDecisionEnabled(false);
                    else if (!decisionProvider) setDecisionEnabled(true);
                    setDecisionModel(provider ? DECISION_PROVIDERS[provider].defaultModel : '');
                    setDecisionError('');
                  }}
                >
                  <SelectTrigger id="decision-provider" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {Object.entries(DECISION_PROVIDERS).map(([provider, { label }]) => (
                      <SelectItem key={provider} value={provider}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {decisionProvider && (
                <div className="space-y-1.5">
                  <Label htmlFor="decision-model" className="text-xs">
                    {DECISION_PROVIDERS[decisionProvider].modelLabel}
                  </Label>
                  {!DECISION_PROVIDERS[decisionProvider].editableModel &&
                  DECISION_PROVIDERS[decisionProvider].models.length > 1 ? (
                    <Select
                      value={decisionModel}
                      onValueChange={setDecisionModel}
                      disabled={savingSettings || loadingSettings}
                    >
                      <SelectTrigger id="decision-model" className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DECISION_PROVIDERS[decisionProvider].models.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="decision-model"
                      className="h-9 text-sm"
                      value={decisionModel}
                      onChange={(event) => setDecisionModel(event.target.value)}
                      disabled={savingSettings || loadingSettings}
                      readOnly={!DECISION_PROVIDERS[decisionProvider].editableModel}
                      list="decision-model-suggestions"
                      aria-describedby={
                        [
                          decisionProvider === 'ollama' ? 'ollama-model-help' : undefined,
                          decisionError ? 'decision-error' : undefined
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    />
                  )}
                  <datalist id="decision-model-suggestions">
                    {DECISION_PROVIDERS[decisionProvider].models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </div>
              )}
            </div>
            {decisionProvider === 'ollama' && (
              <p id="ollama-model-help" className="text-xs text-muted-foreground">
                Enter the exact model name from <code>ollama list</code>, including its tag (for
                example <code>tev1:4b</code> or <code>tev1:0.8b</code>). Suggestions do not show
                which models are installed.
              </p>
            )}
          </div>
          {decisionProvider && (
            <>
              <p className="text-xs text-muted-foreground">
                {DECISION_PROVIDERS[decisionProvider].credentials}
              </p>
              {decisionProvider === 'ollama' && (
                <div className="space-y-1.5">
                  <Label htmlFor="decision-url" className="text-xs">
                    Ollama server URL
                  </Label>
                  <Input
                    id="decision-url"
                    type="url"
                    value={decisionBaseUrl}
                    onChange={(event) => setDecisionBaseUrl(event.target.value)}
                    disabled={savingSettings || loadingSettings}
                    aria-describedby={decisionError ? 'decision-error' : undefined}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use a URL reachable from the MCPLab backend. Ollama fallback uses the configured
                    judge, which may be hosted.
                  </p>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="decision-pass" className="text-xs">
                    Pass probability threshold
                  </Label>
                  <Input
                    id="decision-pass"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={decisionPassThreshold}
                    onChange={(event) => setDecisionPassThreshold(event.target.value)}
                    disabled={savingSettings || loadingSettings}
                    aria-invalid={!!decisionError}
                    aria-describedby={`decision-threshold-help${decisionError ? ' decision-error' : ''}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="decision-fail" className="text-xs">
                    Fail probability threshold
                  </Label>
                  <Input
                    id="decision-fail"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={decisionFailThreshold}
                    onChange={(event) => setDecisionFailThreshold(event.target.value)}
                    disabled={savingSettings || loadingSettings}
                    aria-invalid={!!decisionError}
                    aria-describedby={`decision-threshold-help${decisionError ? ' decision-error' : ''}`}
                  />
                </div>
              </div>
              <p id="decision-threshold-help" className="text-xs text-muted-foreground">
                Both thresholds describe the probability that the assertion is satisfied. Pass at or
                above the pass threshold; fail at or below the fail threshold. Between them, the
                Evaluation Judge decides. Use 0 ≤ fail threshold &lt; pass threshold ≤ 1.
              </p>
            </>
          )}
          {decisionError && (
            <p id="decision-error" role="alert" className="text-sm text-destructive">
              {decisionError}
            </p>
          )}
          {decisionConnectionResult && (
            <p
              role={decisionConnectionResult.ok ? 'status' : 'alert'}
              className={`text-sm ${decisionConnectionResult.ok ? 'text-success' : 'text-destructive'}`}
            >
              {decisionConnectionResult.message}
            </p>
          )}
          {decisionProvider && (
            <p className="text-xs text-muted-foreground">
              Test connection sends one small decision request using the current values without
              saving them.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void saveDecisionSettings()}
              disabled={savingSettings || loadingSettings || librariesLoading || testingDecision}
            >
              {savingSettings ? 'Saving...' : 'Save Decision Engine'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void testDecisionSettings()}
              disabled={!decisionProvider || savingSettings || loadingSettings || testingDecision}
            >
              {testingDecision ? 'Testing...' : 'Test connection'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Evaluation Queue</CardTitle>
          <CardDescription>
            Control how many queued evaluation runs may execute in parallel.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="evaluation-workers" className="text-xs">
              Evaluation workers
            </Label>
            <Select
              value={defaultQueueWorkers}
              onValueChange={(value) => void saveDefaultQueueWorkers(value)}
              disabled={savingSettings}
            >
              <SelectTrigger id="evaluation-workers" className="h-9 text-sm">
                <SelectValue placeholder="Select worker count" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, index) => String(index + 1)).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Number of queued evaluation runs that may execute in parallel.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">Saved in workspace settings</div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
