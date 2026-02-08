import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Save, Server, Bot, FileText, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfigs } from "@/contexts/ConfigContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { ServerForm } from "@/components/config-editor/ServerForm";
import { AgentForm } from "@/components/config-editor/AgentForm";
import { ScenarioForm } from "@/components/config-editor/ScenarioForm";
import { toast } from "@/hooks/use-toast";
import type { EvalConfig } from "@/types/eval";
import type { SnapshotRecord } from "@/lib/data-sources/types";

const emptyConfig = (): EvalConfig => ({
  id: `cfg-${Date.now()}`,
  name: "",
  description: "",
  servers: [],
  agents: [],
  scenarios: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const ConfigEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getConfig, addConfig, updateConfig, loading } = useConfigs();
  const { mode, source } = useDataSource();
  const { servers: libServers, agents: libAgents, scenarios: libScenarios } = useLibraries();

  const isNew = id === "new";
  const isView = !isNew && !!id;
  const existing = isView ? getConfig(id!) : undefined;

  const [editing, setEditing] = useState(isNew);
  const [config, setConfig] = useState<EvalConfig>(() =>
    existing ? structuredClone(existing) : emptyConfig()
  );
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [snapshotRunId, setSnapshotRunId] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotBaselineId, setSnapshotBaselineId] = useState("");
  const [snapshotRunIsFullyPassing, setSnapshotRunIsFullyPassing] = useState<boolean | null>(null);
  const [updatingSnapshotPolicy, setUpdatingSnapshotPolicy] = useState(false);
  const [generatingBaseline, setGeneratingBaseline] = useState(false);
  const [selectedLibraryServerId, setSelectedLibraryServerId] = useState("");
  const [selectedLibraryAgentId, setSelectedLibraryAgentId] = useState("");
  const [selectedLibraryScenarioId, setSelectedLibraryScenarioId] = useState("");

  useEffect(() => {
    if (existing && !editing) {
      setConfig(structuredClone(existing));
    }
  }, [existing, editing]);

  useEffect(() => {
    if (mode !== "workspace") return;
    let active = true;
    source.listSnapshots().then((next) => {
      if (active) setSnapshots(next);
    }).catch(() => {
      if (active) setSnapshots([]);
    });
    return () => {
      active = false;
    };
  }, [mode, source]);

  useEffect(() => {
    if (mode !== "workspace" || !snapshotRunId.trim()) {
      setSnapshotRunIsFullyPassing(null);
      return;
    }
    let active = true;
    source
      .getResult(snapshotRunId.trim())
      .then((result) => {
        if (!active) return;
        if (!result) {
          setSnapshotRunIsFullyPassing(false);
          return;
        }
        const fullyPassing =
          result.overallPassRate === 1 &&
          result.scenarios.every((scenario) => scenario.runs.every((run) => run.passed));
        setSnapshotRunIsFullyPassing(fullyPassing);
      })
      .catch(() => {
        if (active) setSnapshotRunIsFullyPassing(false);
      });
    return () => {
      active = false;
    };
  }, [mode, snapshotRunId, source]);

  const patch = (updates: Partial<EvalConfig>) => setConfig((c) => ({ ...c, ...updates }));

  const readOnly = !editing;

  const persistSnapshotPolicy = async (
    nextPolicy: {
      enabled: boolean;
      mode: "warn" | "fail_on_drift";
      baselineSnapshotId?: string;
      baselineSourceRunId?: string;
    }
  ) => {
    if (mode !== "workspace" || !config.id || readOnly === false) {
      patch({
        snapshotEval: {
          enabled: nextPolicy.enabled,
          mode: nextPolicy.mode,
          baselineSnapshotId: nextPolicy.baselineSnapshotId,
          baselineSourceRunId: nextPolicy.baselineSourceRunId,
          lastUpdatedAt: new Date().toISOString()
        }
      });
      return;
    }
    setUpdatingSnapshotPolicy(true);
    try {
      const updated = await source.updateSnapshotPolicy(config.id, nextPolicy);
      setConfig(updated);
      toast({ title: "Snapshot policy updated" });
    } catch (error: any) {
      toast({
        title: "Could not update snapshot policy",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setUpdatingSnapshotPolicy(false);
    }
  };

  const generateBaseline = async () => {
    if (!config.id || !snapshotRunId.trim()) return;
    setGeneratingBaseline(true);
    try {
      const response = await source.generateSnapshotEvalBaseline(
        snapshotRunId.trim(),
        config.id,
        snapshotName.trim() || undefined
      );
      setConfig(response.config);
      setSnapshotBaselineId(response.snapshot.id);
      setSnapshots((prev) => [response.snapshot, ...prev.filter((item) => item.id !== response.snapshot.id)]);
      toast({
        title: "Snapshot baseline generated",
        description: `${response.snapshot.name} (${response.snapshot.id})`
      });
    } catch (error: any) {
      toast({
        title: "Could not generate baseline",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setGeneratingBaseline(false);
    }
  };

  const handleSave = async () => {
    if (!config.name.trim()) {
      toast({ title: "Validation Error", description: "Configuration name is required.", variant: "destructive" });
      return;
    }
    const nextConfig = { ...config, updatedAt: new Date().toISOString() };
    if (isNew) {
      const created = await addConfig(nextConfig);
      setConfig(created);
      toast({ title: "Configuration Created", description: `"${created.name}" has been saved.` });
      navigate(`/configs/${created.id}`);
    } else {
      const updated = await updateConfig(config.id, nextConfig);
      setConfig(updated);
      toast({ title: "Configuration Updated", description: `"${updated.name}" has been updated.` });
      setEditing(false);
      if (updated.id !== id) {
        navigate(`/configs/${updated.id}`, { replace: true });
      }
    }
  };

  const title = isNew ? "New Configuration" : editing ? `Editing: ${config.name}` : config.name;

  const importServerFromLibrary = () => {
    const template = libServers.find((item) => item.id === selectedLibraryServerId);
    if (!template) return;
    const name = template.name || template.id;
    if (config.servers.some((srv) => (srv.name || srv.id) === name)) {
      toast({ title: "Server already exists in config" });
      return;
    }
    patch({
      servers: [...config.servers, { ...structuredClone(template), id: `srv-${Date.now()}` }]
    });
    setSelectedLibraryServerId("");
  };

  const importAgentFromLibrary = () => {
    const template = libAgents.find((item) => item.id === selectedLibraryAgentId);
    if (!template) return;
    const name = template.name || template.id;
    if (config.agents.some((agent) => (agent.name || agent.id) === name)) {
      toast({ title: "Agent already exists in config" });
      return;
    }
    patch({
      agents: [...config.agents, { ...structuredClone(template), id: `agt-${Date.now()}` }]
    });
    setSelectedLibraryAgentId("");
  };

  const importScenarioFromLibrary = () => {
    const template = libScenarios.find((item) => item.id === selectedLibraryScenarioId);
    if (!template) return;
    const nextAgents = [...config.agents];
    const nextServers = [...config.servers];
    let mappedAgentId: string | undefined = undefined;

    if (template.agentId) {
      const templateAgent = libAgents.find((item) => item.id === template.agentId);
      if (templateAgent) {
        const templateAgentName = templateAgent.name || templateAgent.id;
        const existingAgent = nextAgents.find((item) => (item.name || item.id) === templateAgentName);
        if (existingAgent) {
          mappedAgentId = existingAgent.id;
        } else {
          const imported = { ...structuredClone(templateAgent), id: `agt-${Date.now()}` };
          nextAgents.push(imported);
          mappedAgentId = imported.id;
        }
      }
    }

    const mappedServerIds: string[] = [];
    for (const templateServerId of template.serverIds) {
      const templateServer = libServers.find((item) => item.id === templateServerId);
      if (!templateServer) continue;
      const templateServerName = templateServer.name || templateServer.id;
      const existingServer = nextServers.find((item) => (item.name || item.id) === templateServerName);
      if (existingServer) {
        mappedServerIds.push(existingServer.id);
        continue;
      }
      const imported = { ...structuredClone(templateServer), id: `srv-${Date.now()}-${mappedServerIds.length}` };
      nextServers.push(imported);
      mappedServerIds.push(imported.id);
    }

    const importedScenario = {
      ...structuredClone(template),
      id: `scn-${Date.now()}`,
      agentId: mappedAgentId,
      serverIds: mappedServerIds.length > 0 ? mappedServerIds : []
    };

    patch({
      agents: nextAgents,
      servers: nextServers,
      scenarios: [...config.scenarios, importedScenario]
    });
    setSelectedLibraryScenarioId("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link to="/configs"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {isNew
              ? "Create a new evaluation configuration"
              : loading
                ? "Loading configuration..."
                : existing
                  ? `Last updated ${new Date(config.updatedAt).toLocaleDateString()}`
                  : "Configuration not found"}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isView && !editing && existing && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/run?configId=${encodeURIComponent(existing.id)}`}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Test Config
              </Link>
            </Button>
          )}
          {isView && !editing && (
            <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {editing && (
            <>
              {!isNew && (
                <Button variant="outline" size="sm" onClick={() => { setConfig(structuredClone(existing!)); setEditing(false); }}>Cancel</Button>
              )}
                <Button size="sm" onClick={() => void handleSave()}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />Save
                </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4">
        <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs">
          <Server className="h-3 w-3" />{config.servers.length} server{config.servers.length !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs">
          <Bot className="h-3 w-3" />{config.agents.length} agent{config.agents.length !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline" className="gap-1.5 py-1 px-3 text-xs">
          <FileText className="h-3 w-3" />{config.scenarios.length} scenario{config.scenarios.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Meta fields */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Configuration Name</Label>
              <Input value={config.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} placeholder="e.g. Basic OpenAI Eval" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input value={config.description || ""} onChange={(e) => patch({ description: e.target.value })} disabled={readOnly} placeholder="Brief description..." />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Snapshot Evaluation</p>
              <p className="text-xs text-muted-foreground">Config baseline versioning. One active baseline is selected; scenarios can opt in/out below.</p>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Enable snapshot baseline</Label>
              <Switch
                checked={config.snapshotEval?.enabled ?? false}
                disabled={updatingSnapshotPolicy}
                onCheckedChange={(checked) => {
                  const current = config.snapshotEval;
                  void persistSnapshotPolicy({
                    enabled: checked,
                    mode: current?.mode ?? "warn",
                    baselineSnapshotId: current?.baselineSnapshotId,
                    baselineSourceRunId: current?.baselineSourceRunId
                  });
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Drift mode</Label>
              <Select
                value={config.snapshotEval?.mode ?? "warn"}
                onValueChange={(modeValue) => {
                  const current = config.snapshotEval;
                  void persistSnapshotPolicy({
                    enabled: current?.enabled ?? false,
                    mode: modeValue as "warn" | "fail_on_drift",
                    baselineSnapshotId: current?.baselineSnapshotId,
                    baselineSourceRunId: current?.baselineSourceRunId
                  });
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="fail_on_drift">Fail on drift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Active baseline</Label>
              <p className="rounded-md border bg-muted/20 px-2 py-2 text-xs font-mono">
                {config.snapshotEval?.baselineSnapshotId ?? "No baseline linked"}
              </p>
            </div>
          </div>

          {mode === "workspace" && config.id && (
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Generate baseline from passing run</Label>
                <Input
                  value={snapshotRunId}
                  onChange={(e) => setSnapshotRunId(e.target.value)}
                  placeholder="Run id (e.g. 20260208-140213)"
                  className="h-8 font-mono text-xs"
                />
                {snapshotRunIsFullyPassing === false && (
                  <p className="text-[11px] text-destructive">Run is missing or not fully passing.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Snapshot name (optional)</Label>
                <Input
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="e.g. config-baseline-v1"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Switch baseline</Label>
                <Select value={snapshotBaselineId || config.snapshotEval?.baselineSnapshotId || ""} onValueChange={(value) => {
                  setSnapshotBaselineId(value);
                  void persistSnapshotPolicy({
                    enabled: config.snapshotEval?.enabled ?? true,
                    mode: config.snapshotEval?.mode ?? "warn",
                    baselineSnapshotId: value || undefined,
                    baselineSourceRunId: config.snapshotEval?.baselineSourceRunId
                  });
                }}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select snapshot" />
                  </SelectTrigger>
                  <SelectContent>
                    {snapshots.map((snapshot) => (
                      <SelectItem key={snapshot.id} value={snapshot.id}>
                        {snapshot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => void generateBaseline()}
                  disabled={generatingBaseline || !snapshotRunId.trim() || snapshotRunIsFullyPassing !== true}
                >
                  {generatingBaseline ? "Generating..." : "Generate Baseline"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() =>
                    void persistSnapshotPolicy({
                      enabled: config.snapshotEval?.enabled ?? false,
                      mode: config.snapshotEval?.mode ?? "warn",
                      baselineSnapshotId: undefined,
                      baselineSourceRunId: undefined
                    })
                  }
                  disabled={updatingSnapshotPolicy}
                >
                  Clear Baseline
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabbed sections */}
      <Tabs defaultValue="servers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="servers" className="gap-1.5"><Server className="h-3.5 w-3.5" />Servers</TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5"><Bot className="h-3.5 w-3.5" />Agents</TabsTrigger>
          <TabsTrigger value="scenarios" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Scenarios</TabsTrigger>
        </TabsList>

        <TabsContent value="servers">
          <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedLibraryServerId} onValueChange={setSelectedLibraryServerId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Import server from library" />
                  </SelectTrigger>
                  <SelectContent>
                    {libServers.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryServerId} onClick={importServerFromLibrary}>
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>
          <ServerForm servers={config.servers} onChange={(servers) => patch({ servers })} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="agents">
          <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedLibraryAgentId} onValueChange={setSelectedLibraryAgentId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Import agent from library" />
                  </SelectTrigger>
                  <SelectContent>
                    {libAgents.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryAgentId} onClick={importAgentFromLibrary}>
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>
          <AgentForm agents={config.agents} onChange={(agents) => patch({ agents })} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="scenarios">
          <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedLibraryScenarioId} onValueChange={setSelectedLibraryScenarioId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Import scenario from library" />
                  </SelectTrigger>
                  <SelectContent>
                    {libScenarios.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryScenarioId} onClick={importScenarioFromLibrary}>
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>
          <ScenarioForm
            scenarios={config.scenarios}
            agents={config.agents}
            servers={config.servers}
            snapshotEval={config.snapshotEval}
            onChange={(scenarios) => patch({ scenarios })}
            readOnly={readOnly}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConfigEditor;
