import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { isDecisionEngineEnabled, type EvaluationDecisionConfig } from '@/types/eval';
import { RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { useLibraries } from '@/contexts/LibraryContext';
import { useDataSource } from '@/contexts/DataSourceContext';
import { toast } from '@/hooks/use-toast';
import DecisionEngineSettings from '@/components/settings/DecisionEngineSettings';

const SettingsPage = () => {
  const { source } = useDataSource();
  const { agents, reload: reloadLibraries, loading: librariesLoading } = useLibraries();
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [assistantAgentName, setAssistantAgentName] = useState<string>('');
  const [defaultEvaluationAgentName, setDefaultEvaluationAgentName] = useState('');
  const [evaluationJudgeAgentName, setEvaluationJudgeAgentName] = useState<string>('');
  const [defaultQueueWorkers, setDefaultQueueWorkers] = useState<string>('1');
  const [savedDecision, setSavedDecision] = useState<EvaluationDecisionConfig>();
  const [decisionError, setDecisionError] = useState('');
  const [testingDecision, setTestingDecision] = useState(false);
  const llmAgents = agents.filter((agent) => agent.type !== 'browser');

  const effectiveAssistantAgentName = useMemo(
    () => assistantAgentName || agents[0]?.name || '',
    [assistantAgentName, agents]
  );

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const settings = await source.getWorkspaceSettings();
      setAssistantAgentName(settings?.assistantAgentName ?? '');
      setDefaultEvaluationAgentName(settings?.defaultEvaluationAgentName ?? '');
      setEvaluationJudgeAgentName(settings?.evaluationJudgeAgentName ?? '');
      setDefaultQueueWorkers(String(settings?.defaultQueueWorkers ?? 1));
      setSavedDecision(settings?.evaluationDecision);
    } catch (error: unknown) {
      setAssistantAgentName('');
      setDefaultEvaluationAgentName('');
      setEvaluationJudgeAgentName('');
      setDefaultQueueWorkers('1');
      setSavedDecision(undefined);
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

  const agentSettings = {
    defaultEvaluationAgentName: {
      name: defaultEvaluationAgentName,
      setName: setDefaultEvaluationAgentName,
      label: 'evaluation agent',
      cleared: 'Default evaluation agent cleared.'
    },
    assistantAgentName: {
      name: assistantAgentName,
      setName: setAssistantAgentName,
      label: 'assistant agent',
      cleared: 'Default assistant agent cleared (will use first available agent by default).'
    },
    evaluationJudgeAgentName: {
      name: evaluationJudgeAgentName,
      setName: setEvaluationJudgeAgentName,
      label: 'evaluation judge',
      cleared: 'Default evaluation judge cleared.'
    }
  };

  const saveAgentSetting = async (key: keyof typeof agentSettings, name: string) => {
    const field = agentSettings[key];
    field.setName(name);
    setSavingSettings(true);
    try {
      await source.updateWorkspaceSettings({ [key]: name || null });
      toast({
        title: 'Settings updated',
        description: name ? `Default ${field.label} set to ${name}.` : field.cleared
      });
    } catch (error: unknown) {
      field.setName(field.name);
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
    if (!nextAgentName && isDecisionEngineEnabled(savedDecision)) {
      setDecisionError(
        'Turn off and save, or clear, the Decision Engine before removing its backup LLM evaluation judge.'
      );
      return;
    }
    await saveAgentSetting('evaluationJudgeAgentName', nextAgentName);
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
          <CardTitle className="text-base">Evaluation Defaults</CardTitle>
          <CardDescription>
            LLM agent used when an evaluation has no agents configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="default-evaluation-agent">
              Default Evaluation Agent
            </Label>
            <Select
              value={defaultEvaluationAgentName || '__none__'}
              onValueChange={(value) =>
                void saveAgentSetting(
                  'defaultEvaluationAgentName',
                  value === '__none__' ? '' : value
                )
              }
              disabled={savingSettings || loadingSettings || librariesLoading}
            >
              <SelectTrigger
                id="default-evaluation-agent"
                className="h-9 text-sm"
                aria-describedby="default-evaluation-agent-help"
              >
                <SelectValue placeholder="Select evaluation agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {defaultEvaluationAgentName &&
                  !llmAgents.some((agent) => agent.id === defaultEvaluationAgentName) && (
                    <SelectItem value={defaultEvaluationAgentName} disabled>
                      {defaultEvaluationAgentName} (unavailable)
                    </SelectItem>
                  )}
                {llmAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name || agent.id} · {agent.model || agent.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="default-evaluation-agent-help" className="text-xs text-muted-foreground">
              Evaluation agents and explicit run selections take precedence. Inheritance is resolved
              when a run is created.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">Saved in workspace settings</div>
        </CardContent>
      </Card>

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
                void saveAgentSetting('assistantAgentName', value === '__none__' ? '' : value)
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

      <DecisionEngineSettings
        evaluationJudgeAgentName={evaluationJudgeAgentName}
        llmAgents={llmAgents}
        savedDecision={savedDecision}
        decisionError={decisionError}
        loadingSettings={loadingSettings}
        savingSettings={savingSettings}
        librariesLoading={librariesLoading}
        onDecisionSaved={setSavedDecision}
        onDecisionError={setDecisionError}
        onSavingChange={setSavingSettings}
        onTestingChange={setTestingDecision}
      />

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
