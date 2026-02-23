import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Server, Bot, FileText, Play, ExternalLink, ChevronUp, ChevronDown, AlertTriangle, X } from "lucide-react";
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
  serverRefs: [],
  agents: [],
  agentRefs: [],
  scenarios: [],
  scenarioRefs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const ConfigEditor = () => {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const activeTab = useMemo(() => {
    const tab = tabParam || searchParams.get("tab");
    return tab === "agents" || tab === "scenarios" || tab === "servers" ? tab : "agents";
  }, [tabParam, searchParams]);

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
      toast({ title: "Validation Error", description: "MCP evaluation name is required.", variant: "destructive" });
      return;
    }
    const nextConfig = { ...config, updatedAt: new Date().toISOString() };
    if (isNew) {
      const created = await addConfig(nextConfig);
      setConfig(created);
      toast({ title: "MCP Evaluation Created", description: `"${created.name}" has been saved.` });
      navigate(`/mcp-evaluations/${created.id}`);
    } else {
      const updated = await updateConfig(config.id, nextConfig);
      setConfig(updated);
      toast({ title: "MCP Evaluation Updated", description: `"${updated.name}" has been updated.` });
      setEditing(false);
      if (updated.id !== id) {
        navigate(`/mcp-evaluations/${updated.id}`, { replace: true });
      }
    }
  };

  const title = isNew ? "New MCP Evaluation" : editing ? `Editing: ${config.name}` : config.name;
  const configBasePath = isNew ? "/mcp-evaluations/new" : `/mcp-evaluations/${encodeURIComponent(config.id || id || "")}`;
  const isBrokenConfig = Boolean(existing?.loadError);

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

  const addServerReference = () => {
    const template = libServers.find((item) => item.id === selectedLibraryServerId);
    if (!template) return;
    const refName = template.name || template.id;
    const nextRefs = Array.from(new Set([...(config.serverRefs ?? []), refName]));
    patch({ serverRefs: nextRefs });
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

  const addAgentReference = () => {
    const template = libAgents.find((item) => item.id === selectedLibraryAgentId);
    if (!template) return;
    const refName = template.name || template.id;
    const nextRefs = Array.from(new Set([...(config.agentRefs ?? []), refName]));
    patch({ agentRefs: nextRefs });
    setSelectedLibraryAgentId("");
  };

  const importScenarioFromLibrary = () => {
    const template = libScenarios.find((item) => item.id === selectedLibraryScenarioId);
    if (!template) return;
    const nextAgents = [...config.agents];
    const nextServers = [...config.servers];

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
      serverIds: mappedServerIds.length > 0 ? mappedServerIds : []
    };

    patch({
      agents: nextAgents,
      servers: nextServers,
      scenarios: [...config.scenarios, importedScenario]
    });
    setSelectedLibraryScenarioId("");
  };

  const addScenarioReference = () => {
    const template = libScenarios.find((item) => item.id === selectedLibraryScenarioId);
    if (!template) return;
    const refId = template.name || template.id;
    const nextRefs = Array.from(new Set([...(config.scenarioRefs ?? []), refId]));
    patch({ scenarioRefs: nextRefs });
    setSelectedLibraryScenarioId("");
  };

  const removeRef = (
    key: "serverRefs" | "agentRefs" | "scenarioRefs",
    value: string
  ) => {
    const next = (config[key] ?? []).filter((item) => item !== value);
    patch({ [key]: next } as Partial<EvalConfig>);
  };

  const moveRef = (
    key: "serverRefs" | "agentRefs" | "scenarioRefs",
    index: number,
    direction: -1 | 1
  ) => {
    const current = [...(config[key] ?? [])];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.length) return;
    const [item] = current.splice(index, 1);
    current.splice(nextIndex, 0, item);
    patch({ [key]: current } as Partial<EvalConfig>);
  };

  const findLibraryServerByRef = (ref: string) =>
    libServers.find((item) => (item.name || item.id) === ref);
  const findLibraryAgentByRef = (ref: string) =>
    libAgents.find((item) => (item.name || item.id) === ref);
  const findLibraryScenarioByRef = (ref: string) =>
    libScenarios.find((item) => (item.name || item.id) === ref);
  const referencedServers = (config.serverRefs ?? [])
    .map(findLibraryServerByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const referencedAgents = (config.agentRefs ?? [])
    .map(findLibraryAgentByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const referencedScenarios = (config.scenarioRefs ?? [])
    .map(findLibraryScenarioByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const missingServerRefs = (config.serverRefs ?? []).filter((ref) => !findLibraryServerByRef(ref));
  const missingAgentRefs = (config.agentRefs ?? []).filter((ref) => !findLibraryAgentByRef(ref));
  const missingScenarioRefs = (config.scenarioRefs ?? []).filter((ref) => !findLibraryScenarioByRef(ref));
  const missingServerRefSet = new Set(missingServerRefs);
  const missingAgentRefSet = new Set(missingAgentRefs);
  const missingScenarioRefSet = new Set(missingScenarioRefs);
  const totalServerCount = config.servers.length + referencedServers.length;
  const totalAgentCount = config.agents.length + referencedAgents.length;
  const totalScenarioCount = config.scenarios.length + referencedScenarios.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link to="/mcp-evaluations"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {isNew
              ? "Create a new MCP evaluation"
                : loading
                  ? "Loading configuration..."
                : existing
                  ? existing.loadError
                    ? "MCP evaluation could not be fully loaded"
                    : `Last updated ${new Date(config.updatedAt).toLocaleDateString()}`
                  : "MCP evaluation not found"}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isView && !editing && existing && !isBrokenConfig && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/run?configId=${encodeURIComponent(existing.id)}`}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run MCP Evaluation
              </Link>
            </Button>
          )}
          {isView && !editing && (
            <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {isView && !editing && isBrokenConfig && (
            <Badge variant="destructive" className="py-1 px-3 text-xs">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Broken config
            </Badge>
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

      {isBrokenConfig && !editing && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">This configuration is broken</p>
                <p className="text-xs text-muted-foreground">
                  The file is still present, but it could not be loaded because one or more references or fields are invalid.
                </p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs font-medium mb-1">File</p>
              <p className="text-xs font-mono break-all">{existing?.sourcePath || existing?.description}</p>
            </div>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-medium mb-1 text-destructive">Load Error</p>
              <p className="text-xs break-all text-destructive">{existing?.loadError}</p>
            </div>
            {(missingServerRefs.length > 0 || missingAgentRefs.length > 0 || missingScenarioRefs.length > 0) && (
              <div className="rounded-md border border-destructive/30 bg-background p-3 space-y-1.5">
                <p className="text-xs font-medium">Broken references</p>
                {missingServerRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Servers: <span className="text-destructive">{missingServerRefs.join(", ")}</span>
                  </p>
                )}
                {missingAgentRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Agents: <span className="text-destructive">{missingAgentRefs.join(", ")}</span>
                  </p>
                )}
                {missingScenarioRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Scenarios: <span className="text-destructive">{missingScenarioRefs.join(", ")}</span>
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Valid items still render below. Only the missing references are marked as broken.
            </p>
          </CardContent>
        </Card>
      )}

      {!isBrokenConfig && (config.loadWarnings?.length ?? 0) > 0 && (
        <Card className="border-amber-500/30">
          <CardContent className="pt-4 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              Migration warnings
            </div>
            {config.loadWarnings?.map((warning, index) => (
              <p key={`${warning}-${index}`} className="text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats bar */}
      <div className="flex gap-4">
        <Badge
          variant={activeTab === "agents" ? "default" : "outline"}
          className="py-1 px-3 text-xs"
        >
          <Link to={`${configBasePath}/agents`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Bot className="h-3 w-3" />{totalAgentCount} agent{totalAgentCount !== 1 ? "s" : ""}
          </Link>
        </Badge>
        <Badge
          variant={activeTab === "scenarios" ? "default" : "outline"}
          className="py-1 px-3 text-xs"
        >
          <Link to={`${configBasePath}/scenarios`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <FileText className="h-3 w-3" />{totalScenarioCount} scenario{totalScenarioCount !== 1 ? "s" : ""}
          </Link>
        </Badge>
        <Badge
          variant={activeTab === "servers" ? "default" : "outline"}
          className="py-1 px-3 text-xs"
        >
          <Link to={`${configBasePath}/servers`} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Server className="h-3 w-3" />{totalServerCount} server{totalServerCount !== 1 ? "s" : ""}
          </Link>
        </Badge>
      </div>

      {/* Meta fields */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">MCP Evaluation Name</Label>
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
        <CardContent className="pt-6 space-y-3">
          <div>
            <p className="text-sm font-semibold">Run Defaults</p>
            <p className="text-xs text-muted-foreground">
              Default agent selection for Run UI/CLI. Users can override at run time.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Default agents</Label>
              {!readOnly && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    patch({
                      runDefaults: {
                        ...(config.runDefaults ?? {}),
                        selectedAgentNames: [
                          ...new Set(
                            [
                              ...config.agents.map((a) => a.name || a.id),
                              ...referencedAgents.map((a) => a.name || a.id)
                            ]
                          )
                        ]
                      }
                    })
                  }
                >
                  Select all
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...config.agents, ...referencedAgents].map((agent) => {
                const agentName = agent.name || agent.id;
                const checked = (config.runDefaults?.selectedAgentNames ?? []).includes(agentName);
                return (
                  <label key={`run-default-${agent.id}`} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...(config.runDefaults?.selectedAgentNames ?? []), agentName]
                          : (config.runDefaults?.selectedAgentNames ?? []).filter((name) => name !== agentName);
                        patch({
                          runDefaults: {
                            ...(config.runDefaults ?? {}),
                            selectedAgentNames: Array.from(new Set(next))
                          }
                        });
                      }}
                    />
                    <span>{agent.name || agent.id}</span>
                    {referencedAgents.some((a) => a.id === agent.id) && (
                      <span className="text-xs text-muted-foreground">(ref)</span>
                    )}
                  </label>
                );
              })}
            </div>
            {[...config.agents, ...referencedAgents].length === 0 && (
              <p className="text-xs text-muted-foreground">No agents available yet.</p>
            )}
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
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          if (tab !== "servers" && tab !== "agents" && tab !== "scenarios") return;
          const next = new URLSearchParams(searchParams);
          next.delete("tab");
          setSearchParams(next, { replace: true });
          if (id && id !== "new") {
            navigate(`/mcp-evaluations/${encodeURIComponent(id)}/${tab}`, { replace: true });
            return;
          }
          navigate(`/mcp-evaluations/${id ?? "new"}/${tab}`, { replace: true });
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="agents" className="gap-1.5"><Bot className="h-3.5 w-3.5" />Agents</TabsTrigger>
          <TabsTrigger value="scenarios" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Scenarios</TabsTrigger>
          <TabsTrigger value="servers" className="gap-1.5"><Server className="h-3.5 w-3.5" />Servers</TabsTrigger>
        </TabsList>

        <TabsContent value="servers">
          {!readOnly && (
            <Card className="mb-4">
              <CardContent className="pt-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Select value={selectedLibraryServerId} onValueChange={setSelectedLibraryServerId}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select server from library" />
                    </SelectTrigger>
                    <SelectContent>
                      {libServers.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryServerId} onClick={addServerReference}>
                      Add Ref
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryServerId} onClick={importServerFromLibrary}>
                      Import Inline
                    </Button>
                  </div>
                </div>
                {(config.serverRefs ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(config.serverRefs ?? []).map((ref) => (
                      <Badge
                        key={ref}
                        variant={missingServerRefSet.has(ref) ? "destructive" : "secondary"}
                        className="gap-1"
                      >
                        {missingServerRefSet.has(ref) ? "Missing ref: " : "Ref: "}
                        {ref}
                        <button
                          type="button"
                          onClick={() => removeRef("serverRefs", ref)}
                          className="inline-flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[10px] leading-none hover:bg-background"
                          aria-label={`Remove server reference ${ref}`}
                          title={`Remove server reference ${ref}`}
                        >
                          <X className="h-2.5 w-2.5" />
                          Remove
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {missingServerRefs.length > 0 && (
                  <p className="mt-2 text-xs text-destructive">
                    Missing server refs: {missingServerRefs.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {referencedServers.length > 0 && (
            <Card className="mb-4">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Referenced servers (read-only)</div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/libraries/servers">
                      Edit in Manage Servers
                      <ExternalLink className="ml-1.5 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                <ServerForm servers={referencedServers} onChange={() => {}} readOnly />
              </CardContent>
            </Card>
          )}
          {readOnly && config.servers.length === 0 && referencedServers.length > 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No inline servers configured. Using {referencedServers.length} referenced server{referencedServers.length !== 1 ? "s" : ""} above.
            </p>
          ) : (
            <ServerForm servers={config.servers} onChange={(servers) => patch({ servers })} readOnly={readOnly} />
          )}
        </TabsContent>

        <TabsContent value="agents">
          {!readOnly && <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedLibraryAgentId} onValueChange={setSelectedLibraryAgentId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select agent from library" />
                  </SelectTrigger>
                  <SelectContent>
                    {libAgents.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryAgentId} onClick={addAgentReference}>
                    Add Ref
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryAgentId} onClick={importAgentFromLibrary}>
                    Import Inline
                  </Button>
                </div>
              </div>
              {(config.agentRefs ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(config.agentRefs ?? []).map((ref) => (
                    <Badge
                      key={ref}
                      variant={missingAgentRefSet.has(ref) ? "destructive" : "secondary"}
                      className="gap-1"
                    >
                      {missingAgentRefSet.has(ref) ? "Missing ref: " : "Ref: "}
                      {ref}
                      <button
                        type="button"
                        onClick={() => removeRef("agentRefs", ref)}
                        className="inline-flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[10px] leading-none hover:bg-background"
                        aria-label={`Remove agent reference ${ref}`}
                        title={`Remove agent reference ${ref}`}
                      >
                        <X className="h-2.5 w-2.5" />
                        Remove
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {missingAgentRefs.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  Missing agent refs: {missingAgentRefs.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>}
          {referencedAgents.length > 0 && (
            <Card className="mb-4">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Referenced agents (read-only)</div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/libraries/agents">
                      Edit in Manage Agents
                      <ExternalLink className="ml-1.5 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                <AgentForm agents={referencedAgents} onChange={() => {}} readOnly />
              </CardContent>
            </Card>
          )}
          {readOnly && config.agents.length === 0 && referencedAgents.length > 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No inline agents configured. Using {referencedAgents.length} referenced agent{referencedAgents.length !== 1 ? "s" : ""} above.
            </p>
          ) : (
            <AgentForm agents={config.agents} onChange={(agents) => patch({ agents })} readOnly={readOnly} />
          )}
        </TabsContent>

        <TabsContent value="scenarios">
          {!readOnly && <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedLibraryScenarioId} onValueChange={setSelectedLibraryScenarioId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select scenario from library" />
                  </SelectTrigger>
                  <SelectContent>
                    {libScenarios.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name || item.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryScenarioId} onClick={addScenarioReference}>
                    Add Ref
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryScenarioId} onClick={importScenarioFromLibrary}>
                    Import Inline
                  </Button>
                </div>
              </div>
              {(config.scenarioRefs ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(config.scenarioRefs ?? []).map((ref) => (
                    <Badge
                      key={ref}
                      variant={missingScenarioRefSet.has(ref) ? "destructive" : "secondary"}
                      className="gap-1"
                    >
                      {missingScenarioRefSet.has(ref) ? "Missing ref: " : "Ref: "}
                      {ref}
                      <button
                        type="button"
                        onClick={() => removeRef("scenarioRefs", ref)}
                        className="inline-flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[10px] leading-none hover:bg-background"
                        aria-label={`Remove scenario reference ${ref}`}
                        title={`Remove scenario reference ${ref}`}
                      >
                        <X className="h-2.5 w-2.5" />
                        Remove
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {missingScenarioRefs.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  Missing scenario refs: {missingScenarioRefs.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>}
          {referencedScenarios.length > 0 && (
            <Card className="mb-4">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Referenced scenario order</div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/libraries/scenarios">
                      Scenarios Overview
                      <ExternalLink className="ml-1.5 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  {(config.scenarioRefs ?? []).map((ref, index) => (
                    <div key={`scenario-order-${ref}-${index}`} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm">
                      <span>{index + 1}. {ref}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          asChild
                        >
                          <Link
                            to={
                              findLibraryScenarioByRef(ref)
                                ? `/libraries/scenarios/${encodeURIComponent(findLibraryScenarioByRef(ref)!.id)}`
                                : "/libraries/scenarios"
                            }
                          >
                            Edit
                          </Link>
                        </Button>
                        {!readOnly && (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => moveRef("scenarioRefs", index, -1)}
                              disabled={index === 0}
                              aria-label="Move referenced scenario up"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => moveRef("scenarioRefs", index, 1)}
                              disabled={index === (config.scenarioRefs ?? []).length - 1}
                              aria-label="Move referenced scenario down"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {!readOnly && (
                          <Button type="button" size="sm" variant="outline" onClick={() => removeRef("scenarioRefs", ref)}>
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  Referenced scenarios are shown below in read-only form layout.
                </div>
                <ScenarioForm
                  scenarios={referencedScenarios}
                  agents={libAgents}
                  servers={libServers}
                  configId={config.id}
                  configPath={config.sourcePath}
                  defaultAssistantAgentName={config.runDefaults?.selectedAgentNames?.[0]}
                  snapshotEval={config.snapshotEval}
                  onChange={() => {}}
                  readOnly
                />
              </CardContent>
            </Card>
          )}
          {readOnly && config.scenarios.length === 0 && referencedScenarios.length > 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No inline scenarios configured. Using {referencedScenarios.length} referenced scenario{referencedScenarios.length !== 1 ? "s" : ""} above.
            </p>
          ) : (
            <ScenarioForm
              scenarios={config.scenarios}
              agents={[...config.agents, ...referencedAgents]}
              servers={[...config.servers, ...referencedServers]}
              configId={config.id}
              configPath={config.sourcePath}
              defaultAssistantAgentName={config.runDefaults?.selectedAgentNames?.[0]}
              snapshotEval={config.snapshotEval}
              onChange={(scenarios) => patch({ scenarios })}
              readOnly={readOnly}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConfigEditor;
