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
  const [defaultQueueWorkers, setDefaultQueueWorkers] = useState<string>('1');

  const effectiveAssistantAgentName = useMemo(
    () => scenarioAssistantAgentName || agents[0]?.name || '',
    [scenarioAssistantAgentName, agents]
  );

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const settings = await source.getWorkspaceSettings();
      setScenarioAssistantAgentName(settings?.scenarioAssistantAgentName ?? '');
      setDefaultQueueWorkers(String(settings?.defaultQueueWorkers ?? 1));
    } catch (error: unknown) {
      setScenarioAssistantAgentName('');
      setDefaultQueueWorkers('1');
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
          disabled={librariesLoading || loadingSettings}
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
          <CardTitle className="text-base">Evaluation Queue</CardTitle>
          <CardDescription>
            Control how many queued evaluation runs may execute in parallel.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Evaluation workers</Label>
            <Select
              value={defaultQueueWorkers}
              onValueChange={(value) => void saveDefaultQueueWorkers(value)}
              disabled={savingSettings}
            >
              <SelectTrigger className="h-9 text-sm">
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
