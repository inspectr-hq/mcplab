import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  DECISION_DEFAULTS,
  DECISION_PROVIDERS,
  isDecisionEngineEnabled,
  normalizeEvaluationDecisionConfig,
  type DecisionConnectionTestResult,
  type EvaluationDecisionConfig,
  type LlmAgentConfig
} from '@/types/eval';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';

type Props = {
  evaluationJudgeAgentName: string;
  llmAgents: LlmAgentConfig[];
  savedDecision?: EvaluationDecisionConfig;
  decisionError: string;
  loadingSettings: boolean;
  savingSettings: boolean;
  librariesLoading: boolean;
  onDecisionSaved: (decision?: EvaluationDecisionConfig) => void;
  onDecisionError: (error: string) => void;
  onSavingChange: (saving: boolean) => void;
  onTestingChange: (testing: boolean) => void;
};

const DecisionEngineSettings = ({
  evaluationJudgeAgentName,
  llmAgents,
  savedDecision,
  decisionError,
  loadingSettings,
  savingSettings,
  librariesLoading,
  onDecisionSaved,
  onDecisionError,
  onSavingChange,
  onTestingChange
}: Props) => {
  const { source } = useDataSource();
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
  const [savedDecisionError, setSavedDecisionError] = useState('');
  const [testingDecision, setTestingDecision] = useState(false);
  const [decisionConnectionResult, setDecisionConnectionResult] =
    useState<DecisionConnectionTestResult>();
  const decisionTestController = useRef<AbortController | null>(null);

  useEffect(() => {
    let normalized: EvaluationDecisionConfig | undefined;
    let error = '';
    try {
      normalized = savedDecision ? normalizeEvaluationDecisionConfig(savedDecision) : undefined;
    } catch {
      error =
        'Saved Decision Engine configuration is invalid. Select a provider to replace it, or save None to clear it. Semantic checks fall back to the Evaluation Judge.';
    }
    setDecisionProvider(normalized?.provider ?? '');
    setDecisionEnabled(isDecisionEngineEnabled(normalized));
    setDecisionModel(normalized?.model ?? '');
    setDecisionBaseUrl(normalized?.baseUrl ?? DECISION_DEFAULTS.baseUrl);
    setDecisionPassThreshold(String(normalized?.passThreshold ?? DECISION_DEFAULTS.passThreshold));
    setDecisionFailThreshold(String(normalized?.failThreshold ?? DECISION_DEFAULTS.failThreshold));
    setSavedDecisionError(error);
  }, [savedDecision]);

  useEffect(() => {
    setTestingDecision(false);
    onTestingChange(false);
    setDecisionConnectionResult(undefined);
    return () => {
      decisionTestController.current?.abort();
      decisionTestController.current = null;
    };
  }, [decisionProvider, decisionModel, decisionBaseUrl, source, onTestingChange]);

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
      onDecisionError(error instanceof Error ? error.message : String(error));
      return;
    }
    const controller = new AbortController();
    decisionTestController.current = controller;
    setTestingDecision(true);
    onTestingChange(true);
    onDecisionError('');
    setDecisionConnectionResult(undefined);
    try {
      const result = await source.testDecisionConnection(decision, controller.signal);
      if (!controller.signal.aborted) setDecisionConnectionResult(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        onDecisionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (decisionTestController.current === controller) {
        decisionTestController.current = null;
        setTestingDecision(false);
        onTestingChange(false);
      }
    }
  };

  const saveDecisionSettings = async () => {
    let decision: EvaluationDecisionConfig | null = null;
    try {
      decision = readDecisionDraft();
      if (
        isDecisionEngineEnabled(decision) &&
        !llmAgents.some(
          (agent) =>
            agent.id === evaluationJudgeAgentName || agent.name === evaluationJudgeAgentName
        )
      ) {
        throw new Error(
          'Select an LLM evaluation judge as backup before enabling the Decision Engine.'
        );
      }
    } catch (error) {
      onDecisionError(error instanceof Error ? error.message : String(error));
      return;
    }
    onSavingChange(true);
    onDecisionError('');
    try {
      await source.updateWorkspaceSettings({ evaluationDecision: decision });
      onDecisionSaved(decision ?? undefined);
      setSavedDecisionError('');
      toast({
        title: 'Settings updated',
        description: decision
          ? 'Decision Engine configuration saved.'
          : 'Decision Engine cleared. Semantic checks use the Evaluation Judge.'
      });
    } catch (error) {
      onDecisionError(error instanceof Error ? error.message : String(error));
    } finally {
      onSavingChange(false);
    }
  };

  return (
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
                  onDecisionError('');
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
                        decisionError ? 'decision-error' : undefined,
                        savedDecisionError ? 'decision-config-error' : undefined
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
              example <code>tev1:4b</code> or <code>tev1:0.8b</code>). Suggestions do not show which
              models are installed.
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
                  aria-describedby={
                    [
                      decisionError ? 'decision-error' : undefined,
                      savedDecisionError ? 'decision-config-error' : undefined
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
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
                  aria-describedby={`decision-threshold-help${decisionError ? ' decision-error' : ''}${savedDecisionError ? ' decision-config-error' : ''}`}
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
                  aria-describedby={`decision-threshold-help${decisionError ? ' decision-error' : ''}${savedDecisionError ? ' decision-config-error' : ''}`}
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
        {savedDecisionError && (
          <p id="decision-config-error" role="alert" className="text-sm text-destructive">
            {savedDecisionError}
          </p>
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
            Test connection sends one small decision request using the current values without saving
            them.
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
  );
};

export default DecisionEngineSettings;
