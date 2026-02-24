import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useLibraries } from "@/contexts/LibraryContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";

const SettingsPage = () => {
  const { source } = useDataSource();
  const { agents, reload: reloadLibraries, loading: librariesLoading } = useLibraries();
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingAssistantAgent, setSavingAssistantAgent] = useState(false);
  const [scenarioAssistantAgentName, setScenarioAssistantAgentName] = useState<string>("");

  const effectiveAssistantAgentName = useMemo(
    () => scenarioAssistantAgentName || agents[0]?.name || "",
    [scenarioAssistantAgentName, agents]
  );

  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      const settings = await source.getWorkspaceSettings();
      setScenarioAssistantAgentName(settings?.scenarioAssistantAgentName ?? "");
    } catch (error: any) {
      setScenarioAssistantAgentName("");
      toast({
        title: "Could not load settings",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, [source]);

  const saveAssistantAgentSetting = async (nextAgentName: string) => {
    setScenarioAssistantAgentName(nextAgentName);
    setSavingAssistantAgent(true);
    try {
      await source.updateWorkspaceSettings({
        scenarioAssistantAgentName: nextAgentName || undefined
      });
      toast({
        title: "Settings updated",
        description: nextAgentName
          ? `Scenario Assistant Agent set to ${nextAgentName}.`
          : "Scenario Assistant Agent cleared (will use first available agent by default)."
      });
    } catch (error: any) {
      toast({
        title: "Could not save settings",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setSavingAssistantAgent(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([reloadLibraries(), loadSettings()]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
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
          <CardTitle className="text-base">Scenario Assistant</CardTitle>
          <CardDescription>
            Default assistant model used on library scenario pages. If unset, MCP Lab uses the first available agent automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.3fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Assistant Agent</Label>
            <Select
              value={effectiveAssistantAgentName || "__none__"}
              onValueChange={(value) =>
                void saveAssistantAgentSetting(value === "__none__" ? "" : value)
              }
              disabled={savingAssistantAgent}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select assistant agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (use first agent)</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.name || agent.id}>
                    {(agent.name || agent.id)} · {agent.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Applies to `/libraries/scenarios/:scenarioId`. MCP Evaluation editors can still override the assistant agent from their evaluation context.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Saved in workspace settings
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
