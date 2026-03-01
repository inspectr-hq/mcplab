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
import { ProviderBadge } from "@/components/ProviderBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfigs } from "@/contexts/ConfigContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { ServerForm } from "@/components/config-editor/ServerForm";
import { AgentForm } from "@/components/config-editor/AgentForm";
import { ScenarioForm } from "@/components/config-editor/ScenarioForm";
import { toast } from "@/hooks/use-toast";
import { isUiFeatureEnabled } from "@/lib/feature-flags";
import type { AgentConfig, EvalConfig, Scenario, ScenarioEntry, ServerConfig } from "@/types/eval";
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
  scenarioEntries: [],
  scenarioRefs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const ServerListReadOnly = ({ servers }: { servers: ServerConfig[] }) => (
  <div className="space-y-2">
    {servers.map((server) => (
      <div key={server.id} className="rounded-md border p-3">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm">{server.name || server.id}</div>
          <Badge variant="secondary" className="font-mono text-xs">
            {server.transport}
          </Badge>
          {server.authType && server.authType !== "none" && (
            <Badge variant="outline" className="text-xs">
              {server.authType}
            </Badge>
          )}
        </div>
        {server.url && (
          <div className="mt-1 text-xs font-mono text-muted-foreground break-all">
            {server.url}
          </div>
        )}
        {server.command && (
          <div className="mt-1 text-xs font-mono text-muted-foreground">
            {[server.command, ...(server.args ?? [])].join(" ")}
          </div>
        )}
      </div>
    ))}
  </div>
);

const InlineServersReadOnly = ({ servers }: { servers: ServerConfig[] }) => (
  <Card>
    <CardContent className="pt-4 space-y-3">
      <div className="text-sm font-medium">Inline servers</div>
      <ServerListReadOnly servers={servers} />
    </CardContent>
  </Card>
);

const AgentListReadOnly = ({
  agents,
  defaultAgentNames = [],
}: {
  agents: AgentConfig[];
  defaultAgentNames?: string[];
}) => (
  <div className="space-y-2">
    {agents.map((agent) => (
      <div key={agent.id} className="rounded-md border p-3">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm">{agent.name || agent.id}</div>
          {defaultAgentNames.includes(agent.name || agent.id) && (
            <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50">
              Default
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ProviderBadge provider={agent.provider} />
          <Badge variant="outline" className="text-xs font-mono">
            {agent.model}
          </Badge>
        </div>
      </div>
    ))}
  </div>
);

const InlineAgentsReadOnly = ({
  agents,
  defaultAgentNames = [],
}: {
  agents: AgentConfig[];
  defaultAgentNames?: string[];
}) => (
  <Card>
    <CardContent className="pt-4 space-y-3">
      <div className="text-sm font-medium">Inline agents</div>
      <AgentListReadOnly agents={agents} defaultAgentNames={defaultAgentNames} />
    </CardContent>
  </Card>
);

const ConfigEditor = () => {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getConfig, addConfig, updateConfig, loading } = useConfigs();
  const { source } = useDataSource();
  const snapshotsUiEnabled = isUiFeatureEnabled("snapshots", false);
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
  const [selectedLibraryScenarioId, setSelectedLibraryScenarioId] = useState("");
  const [selectedReferenceAgentToImport, setSelectedReferenceAgentToImport] = useState("");
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
    let active = true;
    source.listSnapshots().then((next) => {
      if (active) setSnapshots(next);
    }).catch(() => {
      if (active) setSnapshots([]);
    });
    return () => {
      active = false;
    };
  }, [source]);

  useEffect(() => {
    if (!snapshotRunId.trim()) {
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
  }, [snapshotRunId, source]);

  const patch = (updates: Partial<EvalConfig>) => setConfig((c) => ({ ...c, ...updates }));

  const scenarioEntries = useMemo<ScenarioEntry[]>(() => {
    if (config.scenarioEntries && config.scenarioEntries.length > 0) return config.scenarioEntries;
    return [
      ...(config.scenarioRefs ?? []).map((ref) => ({ kind: "referenced" as const, ref })),
      ...config.scenarios.map((scenario) => ({ kind: "inline" as const, scenario }))
    ];
  }, [config.scenarioEntries, config.scenarioRefs, config.scenarios]);

  const setScenarioEntries = (entries: ScenarioEntry[]) => {
    patch({
      scenarioEntries: entries,
      scenarioRefs: entries
        .filter((entry): entry is Extract<ScenarioEntry, { kind: "referenced" }> => entry.kind === "referenced")
        .map((entry) => entry.ref),
      scenarios: entries
        .filter((entry): entry is Extract<ScenarioEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.scenario)
    });
  };

  const readOnly = !editing;
  const defaultRunAgentNames = config.runDefaults?.selectedAgentNames ?? [];

  const persistSnapshotPolicy = async (
    nextPolicy: {
      enabled: boolean;
      mode: "warn" | "fail_on_drift";
      baselineSnapshotId?: string;
      baselineSourceRunId?: string;
    }
  ) => {
    if (!config.id || readOnly === false) {
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
    } catch (error: unknown) {
      toast({
        title: "Could not update snapshot policy",
        description: (error instanceof Error ? error.message : String(error)),
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
    } catch (error: unknown) {
      toast({
        title: "Could not generate baseline",
        description: (error instanceof Error ? error.message : String(error)),
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
    const normalizedScenarioRefs = scenarioEntries
      .filter((entry): entry is Extract<ScenarioEntry, { kind: "referenced" }> => entry.kind === "referenced")
      .map((entry) => entry.ref)
      .map((ref) => {
        const matched = libScenarios.find((item) => item.id === ref || item.name === ref);
        return matched?.id || ref;
      });
    const normalizedScenarioEntries = scenarioEntries.map((entry) => {
      if (entry.kind === "referenced") {
        const matched = libScenarios.find((item) => item.id === entry.ref || item.name === entry.ref);
        return { kind: "referenced" as const, ref: matched?.id || entry.ref };
      }
      return entry;
    });
    const unnamedInline = normalizedScenarioEntries
      .filter((entry): entry is Extract<ScenarioEntry, { kind: "inline" }> => entry.kind === "inline")
      .some((entry) => !entry.scenario.name?.trim());
    if (unnamedInline) {
      toast({
        title: "Validation Error",
        description: "Inline scenarios must have a name before saving.",
        variant: "destructive"
      });
      return;
    }
    const nextConfig = {
      ...config,
      scenarioEntries: normalizedScenarioEntries,
      scenarioRefs: normalizedScenarioRefs,
      scenarios: normalizedScenarioEntries
        .filter((entry): entry is Extract<ScenarioEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.scenario as Scenario),
      updatedAt: new Date().toISOString()
    };
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

  const libraryAgentRefOptions = useMemo(
    () =>
      libAgents
        .map((item) => ({
          id: item.id,
          ref: item.name || item.id,
          label: item.name || item.id,
          model: item.model
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [libAgents]
  );

  const toggleAgentReference = (refName: string) => {
    const existing = new Set(config.agentRefs ?? []);
    if (existing.has(refName)) {
      patch({
        agentRefs: (config.agentRefs ?? []).filter((item) => item !== refName),
        runDefaults: {
          ...(config.runDefaults ?? {}),
          selectedAgentNames: defaultRunAgentNames.filter((name) => name !== refName)
        }
      });
      return;
    }
    patch({ agentRefs: [...(config.agentRefs ?? []), refName] });
  };

  const selectAllAgentReferences = () => {
    patch({ agentRefs: libraryAgentRefOptions.map((option) => option.ref) });
  };

  const clearAgentReferences = () => {
    const referencedNames = new Set(libraryAgentRefOptions.map((option) => option.ref));
    patch({
      agentRefs: [],
      runDefaults: {
        ...(config.runDefaults ?? {}),
        selectedAgentNames: defaultRunAgentNames.filter((name) => !referencedNames.has(name))
      }
    });
  };

  const toggleDefaultAgent = (agentName: string, checked: boolean, ensureRef = false) => {
    const nextDefaults = checked
      ? Array.from(new Set([...defaultRunAgentNames, agentName]))
      : defaultRunAgentNames.filter((name) => name !== agentName);

    const nextRefs =
      checked && ensureRef && !(config.agentRefs ?? []).includes(agentName)
        ? [...(config.agentRefs ?? []), agentName]
        : config.agentRefs ?? [];

    patch({
      agentRefs: nextRefs,
      runDefaults: {
        ...(config.runDefaults ?? {}),
        selectedAgentNames: nextDefaults
      }
    });
  };

  const importSelectedReferencedAgentInline = () => {
    const selectedRef = selectedReferenceAgentToImport.trim();
    if (!selectedRef) return;
    const template = libAgents.find((item) => (item.name || item.id) === selectedRef);
    if (!template) {
      toast({ title: "Referenced agent not found", variant: "destructive" });
      return;
    }
    const name = template.name || template.id;
    if (config.agents.some((agent) => (agent.name || agent.id) === name)) {
      toast({ title: "Agent already exists inline" });
      return;
    }
    const usedNames = new Set([
      ...config.agents.map((agent) => agent.name || agent.id),
      ...libAgents.map((agent) => agent.name || agent.id)
    ]);
    const customBase = `${name}-custom`;
    let customName = customBase;
    let suffix = 2;
    while (usedNames.has(customName)) {
      customName = `${customBase}-${suffix}`;
      suffix += 1;
    }
    patch({
      agents: [{ ...structuredClone(template), id: `agt-${Date.now()}`, name: customName }, ...config.agents]
    });
    setSelectedReferenceAgentToImport("");
    toast({ title: "Imported referenced agent", description: customName });
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
      servers: nextServers
    });
    setScenarioEntries([...scenarioEntries, { kind: "inline", scenario: importedScenario }]);
    setSelectedLibraryScenarioId("");
  };

  const addInlineScenarioEntry = () => {
    const createdAt = Date.now();
    const inlineScenario: Scenario = {
      id: `scn-${createdAt}`,
      name: "",
      serverIds: [],
      prompt: "",
      evalRules: [],
      extractRules: [],
    };
    setScenarioEntries([{ kind: "inline", scenario: inlineScenario }, ...scenarioEntries]);
  };

  const addScenarioReference = () => {
    const template = libScenarios.find((item) => item.id === selectedLibraryScenarioId);
    if (!template) return;
    const refId = template.id;
    const existing = new Set(
      scenarioEntries
        .filter((entry): entry is Extract<ScenarioEntry, { kind: "referenced" }> => entry.kind === "referenced")
        .map((entry) => entry.ref)
    );
    if (!existing.has(refId)) {
      setScenarioEntries([...scenarioEntries, { kind: "referenced", ref: refId }]);
    }
    setSelectedLibraryScenarioId("");
  };

  const removeScenarioEntryAt = (index: number) => {
    setScenarioEntries(scenarioEntries.filter((_, entryIndex) => entryIndex !== index));
  };

  const moveScenarioEntry = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= scenarioEntries.length) return;
    const nextEntries = [...scenarioEntries];
    const [moved] = nextEntries.splice(index, 1);
    nextEntries.splice(nextIndex, 0, moved);
    setScenarioEntries(nextEntries);
  };

  const convertReferencedScenarioToInline = (index: number) => {
    const entry = scenarioEntries[index];
    if (!entry || entry.kind !== "referenced") return;
    const template = findLibraryScenarioByRef(entry.ref);
    if (!template) {
      toast({ title: "Referenced scenario not found", variant: "destructive" });
      return;
    }
    const usedNames = new Set(
      scenarioEntries
        .filter((item): item is Extract<ScenarioEntry, { kind: "inline" }> => item.kind === "inline")
        .map((item) => item.scenario.name?.trim().toLowerCase())
        .filter(Boolean) as string[]
    );
    const baseName = `${(template.name || template.id).trim()}-custom`;
    let nextName = baseName;
    let suffix = 2;
    while (usedNames.has(nextName.toLowerCase())) {
      nextName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    const createdAt = Date.now();
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
      const imported = { ...structuredClone(templateServer), id: `srv-${createdAt}-${mappedServerIds.length}` };
      nextServers.push(imported);
      mappedServerIds.push(imported.id);
    }
    patch({ servers: nextServers });
    const inlineCopy: Scenario = {
      ...structuredClone(template),
      id: `scn-${createdAt}`,
      name: nextName,
      serverIds: mappedServerIds,
    };
    const nextEntries = [...scenarioEntries];
    nextEntries[index] = { kind: "inline", scenario: inlineCopy };
    setScenarioEntries(nextEntries);
    toast({ title: "Referenced scenario converted to inline", description: nextName });
  };

  const removeRef = (
    key: "serverRefs" | "agentRefs" | "scenarioRefs",
    value: string
  ) => {
    if (key === "scenarioRefs") {
      setScenarioEntries(scenarioEntries.filter((entry) => !(entry.kind === "referenced" && entry.ref === value)));
      return;
    }
    const next = (config[key] ?? []).filter((item) => item !== value);
    patch({ [key]: next } as Partial<EvalConfig>);
  };

  const moveRef = (
    key: "serverRefs" | "agentRefs" | "scenarioRefs",
    index: number,
    direction: -1 | 1
  ) => {
    if (key === "scenarioRefs") return;
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
    libScenarios.find((item) => item.id === ref || item.name === ref);
  const referencedServers = (config.serverRefs ?? [])
    .map(findLibraryServerByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const referencedAgents = (config.agentRefs ?? [])
    .map(findLibraryAgentByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const inlineAgentNameSet = new Set(config.agents.map((agent) => agent.name || agent.id));
  const importableReferencedAgentOptions = referencedAgents
    .map((agent) => {
      const name = agent.name || agent.id;
      return { value: name, label: `${name} · ${agent.model}` };
    })
    .filter((item) => !inlineAgentNameSet.has(item.value));
  const referencedScenarioIds = scenarioEntries
    .filter((entry): entry is Extract<ScenarioEntry, { kind: "referenced" }> => entry.kind === "referenced")
    .map((entry) => entry.ref);
  const inlineScenarioEntries = scenarioEntries
    .filter((entry): entry is Extract<ScenarioEntry, { kind: "inline" }> => entry.kind === "inline");
  const inlineScenarios = inlineScenarioEntries.map((entry) => entry.scenario);
  const scenarioViewRows = scenarioEntries.flatMap((entry) => {
    if (entry.kind === "referenced") {
      const scenario = findLibraryScenarioByRef(entry.ref);
      return scenario ? [{ scenario, origin: "referenced" as const }] : [];
    }
    return [{ scenario: entry.scenario, origin: "inline" as const }];
  });
  const scenarioViewAgents = Array.from(
    new Map(
      [...libAgents, ...config.agents, ...referencedAgents].map((agent) => [agent.name || agent.id, agent] as const)
    ).values()
  );
  const scenarioViewServers = Array.from(
    new Map(
      [...libServers, ...config.servers, ...referencedServers].map((server) => [server.name || server.id, server] as const)
    ).values()
  );
  const missingServerRefs = (config.serverRefs ?? []).filter((ref) => !findLibraryServerByRef(ref));
  const missingAgentRefs = (config.agentRefs ?? []).filter((ref) => !findLibraryAgentByRef(ref));
  const missingScenarioRefs = referencedScenarioIds.filter((ref) => !findLibraryScenarioByRef(ref));
  const missingServerRefSet = new Set(missingServerRefs);
  const missingScenarioRefSet = new Set(missingScenarioRefs);
  const totalServerCount = config.servers.length + referencedServers.length;
  const totalAgentCount = config.agents.length + referencedAgents.length;
  const totalScenarioCount = scenarioEntries.length;

  useEffect(() => {
    if (!selectedReferenceAgentToImport) return;
    const stillAvailable = importableReferencedAgentOptions.some(
      (option) => option.value === selectedReferenceAgentToImport
    );
    if (!stillAvailable) setSelectedReferenceAgentToImport("");
  }, [importableReferencedAgentOptions, selectedReferenceAgentToImport]);

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
          {isView && !editing && (
            <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {isView && !editing && existing && !isBrokenConfig && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/run?configId=${encodeURIComponent(existing.id)}`}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run MCP Evaluation
              </Link>
            </Button>
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

      {snapshotsUiEnabled && (
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

          {config.id && (
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
      )}

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
                      {libServers
                        .filter((item) => !(config.serverRefs ?? []).includes(item.name || item.id))
                        .map((item) => (
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
                <ServerListReadOnly servers={referencedServers} />
              </CardContent>
            </Card>
          )}
          {readOnly && config.servers.length === 0 && referencedServers.length > 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No inline servers configured. Using {referencedServers.length} referenced server{referencedServers.length !== 1 ? "s" : ""} above.
            </p>
          ) : readOnly ? (
            <InlineServersReadOnly servers={config.servers} />
          ) : (
            <ServerForm servers={config.servers} onChange={(servers) => patch({ servers })} readOnly={readOnly} />
          )}
        </TabsContent>

        <TabsContent value="agents">
          {!readOnly && <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Library agents</Label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={selectAllAgentReferences}
                      disabled={(config.agentRefs ?? []).length === libraryAgentRefOptions.length || libraryAgentRefOptions.length === 0}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={clearAgentReferences}
                      disabled={(config.agentRefs ?? []).length === 0}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_90px_90px] items-center px-2 text-[11px] text-muted-foreground">
                    <span>Agent</span>
                    <span className="text-center">Ref</span>
                    <span className="text-center">Default</span>
                  </div>
                  {libraryAgentRefOptions.map((option) => {
                    const refChecked = (config.agentRefs ?? []).includes(option.ref);
                    const defaultChecked = defaultRunAgentNames.includes(option.ref);
                    const managedInline = inlineAgentNameSet.has(option.ref);
                    return (
                      <div key={option.id} className="grid grid-cols-[minmax(0,1fr)_90px_90px] items-center gap-2 rounded-md border p-2 text-sm">
                        <span className="truncate">{option.label}</span>
                        <label className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={refChecked}
                            onChange={() => toggleAgentReference(option.ref)}
                          />
                          <span>(ref)</span>
                        </label>
                        {managedInline ? (
                          <span className="mx-auto text-[11px] text-muted-foreground">inline</span>
                        ) : (
                          <label className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={defaultChecked}
                              onChange={(e) => toggleDefaultAgent(option.ref, e.target.checked, true)}
                            />
                            <span>Default</span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
                {libraryAgentRefOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">No library agents available.</p>
                )}
              </div>
              {missingAgentRefs.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  Missing agent refs: {missingAgentRefs.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>}
          {readOnly && referencedAgents.length > 0 && (
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
                <AgentListReadOnly agents={referencedAgents} defaultAgentNames={defaultRunAgentNames} />
              </CardContent>
            </Card>
          )}
          {readOnly && config.agents.length === 0 && referencedAgents.length > 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No inline agents configured. Using {referencedAgents.length} referenced agent{referencedAgents.length !== 1 ? "s" : ""} above.
            </p>
          ) : readOnly ? (
            <InlineAgentsReadOnly agents={config.agents} defaultAgentNames={defaultRunAgentNames} />
          ) : (
            <AgentForm
              agents={config.agents}
              onChange={(agents) => patch({ agents })}
              defaultAgentNames={defaultRunAgentNames}
              onToggleDefaultAgent={(agentName, checked) => toggleDefaultAgent(agentName, checked)}
              importReferenceOptions={importableReferencedAgentOptions}
              selectedImportReference={selectedReferenceAgentToImport}
              onSelectImportReference={setSelectedReferenceAgentToImport}
              onImportSelectedReference={importSelectedReferencedAgentInline}
              readOnly={readOnly}
            />
          )}
        </TabsContent>

        <TabsContent value="scenarios">
          {!readOnly && (
            <Card className="mb-4">
              <CardContent className="pt-4 space-y-3">
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
                    <Button type="button" size="sm" variant="outline" className="h-8" onClick={addInlineScenarioEntry}>
                      Add Inline
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryScenarioId} onClick={addScenarioReference}>
                      Add Ref
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryScenarioId} onClick={importScenarioFromLibrary}>
                      Import Inline
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {scenarioEntries.map((entry, index) => {
                    const referenceScenario = entry.kind === "referenced" ? findLibraryScenarioByRef(entry.ref) : null;
                    const rowTitle =
                      entry.kind === "inline"
                        ? entry.scenario.name?.trim() || entry.scenario.id
                        : referenceScenario?.name || entry.ref;
                    const isMissingRef = entry.kind === "referenced" && missingScenarioRefSet.has(entry.ref);
                    return (
                      <div key={`scenario-entry-${index}-${entry.kind === "inline" ? entry.scenario.id : entry.ref}`} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{index + 1}.</span>
                          <span className="truncate font-medium">{rowTitle}</span>
                          <Badge variant={entry.kind === "inline" ? "secondary" : "outline"}>
                            {entry.kind === "inline" ? "Inline" : "Referenced"}
                          </Badge>
                          {isMissingRef && <Badge variant="destructive">Missing</Badge>}
                        </div>
                        <div className="flex items-center gap-1">
                          {entry.kind === "referenced" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => convertReferencedScenarioToInline(index)}
                                disabled={isMissingRef}
                              >
                                Convert to inline
                              </Button>
                              <Button size="sm" variant="outline" asChild>
                                <Link
                                  to={
                                    referenceScenario
                                      ? `/libraries/scenarios/${encodeURIComponent(referenceScenario.id)}`
                                      : "/libraries/scenarios"
                                  }
                                >
                                  Edit
                                </Link>
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => moveScenarioEntry(index, -1)}
                            disabled={index === 0}
                            aria-label="Move scenario up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => moveScenarioEntry(index, 1)}
                            disabled={index === scenarioEntries.length - 1}
                            aria-label="Move scenario down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => removeScenarioEntryAt(index)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {scenarioEntries.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No scenarios configured yet. Add inline scenarios or references.
                    </p>
                  )}
                </div>
                {missingScenarioRefs.length > 0 && (
                  <p className="text-xs text-destructive">
                    Missing scenario refs: {missingScenarioRefs.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {readOnly ? (
            <ScenarioForm
              scenarios={scenarioViewRows.map((row) => row.scenario)}
              scenarioOrigins={scenarioViewRows.map((row) => row.origin)}
              agents={scenarioViewAgents}
              servers={scenarioViewServers}
              configId={config.id}
              configPath={config.sourcePath}
              defaultAssistantAgentName={config.runDefaults?.selectedAgentNames?.[0]}
              snapshotEval={config.snapshotEval}
              onChange={() => {}}
              readOnly
            />
          ) : (
            <ScenarioForm
              scenarios={inlineScenarios}
              scenarioOrigins={inlineScenarios.map(() => "inline")}
              agents={[...config.agents, ...referencedAgents]}
              servers={[...config.servers, ...referencedServers]}
              configId={config.id}
              configPath={config.sourcePath}
              defaultAssistantAgentName={config.runDefaults?.selectedAgentNames?.[0]}
              snapshotEval={config.snapshotEval}
              onChange={(scenarios) => {
                let cursor = 0;
                const nextEntries = scenarioEntries.map((entry) => {
                  if (entry.kind === "referenced") return entry;
                  const nextScenario = scenarios[cursor];
                  cursor += 1;
                  return { kind: "inline" as const, scenario: nextScenario ?? entry.scenario };
                });
                setScenarioEntries(nextEntries);
              }}
              readOnly={readOnly}
              allowAdd={false}
              allowStructureEdits={false}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConfigEditor;
