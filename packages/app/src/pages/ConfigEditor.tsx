import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Server, Bot, FileText, Play, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type { AgentConfig, AgentEntry, EvalConfig, Scenario, ScenarioEntry, ServerConfig, ServerEntry } from "@/types/eval";
import type { SnapshotRecord } from "@/lib/data-sources/types";

const emptyConfig = (): EvalConfig => ({
  id: `cfg-${Date.now()}`,
  name: "",
  configName: "",
  description: "",
  servers: [],
  serverEntries: [],
  serverRefs: [],
  agents: [],
  agentEntries: [],
  agentRefs: [],
  scenarios: [],
  scenarioEntries: [],
  scenarioRefs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

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
  const [selectedLibraryAgentId, setSelectedLibraryAgentId] = useState("");
  const [expandedInlineAgentIds, setExpandedInlineAgentIds] = useState<Record<string, boolean>>({});
  const [expandedViewAgentIds, setExpandedViewAgentIds] = useState<Record<string, boolean>>({});
  const [expandedViewServerIds, setExpandedViewServerIds] = useState<Record<string, boolean>>({});
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

  const serverEntries = useMemo<ServerEntry[]>(() => {
    if (config.serverEntries && config.serverEntries.length > 0) return config.serverEntries;
    return [
      ...(config.serverRefs ?? []).map((ref) => ({ kind: "referenced" as const, ref })),
      ...config.servers.map((server) => ({ kind: "inline" as const, server }))
    ];
  }, [config.serverEntries, config.serverRefs, config.servers]);

  const setServerEntries = (entries: ServerEntry[]) => {
    patch({
      serverEntries: entries,
      serverRefs: entries
        .filter((entry): entry is Extract<ServerEntry, { kind: "referenced" }> => entry.kind === "referenced")
        .map((entry) => entry.ref),
      servers: entries
        .filter((entry): entry is Extract<ServerEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.server)
    });
  };

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

  const agentEntries = useMemo<AgentEntry[]>(() => {
    if (config.agentEntries && config.agentEntries.length > 0) return config.agentEntries;
    return [
      ...(config.agentRefs ?? []).map((ref) => ({ kind: "referenced" as const, ref })),
      ...config.agents.map((agent) => ({ kind: "inline" as const, agent }))
    ];
  }, [config.agentEntries, config.agentRefs, config.agents]);

  const setAgentEntries = (entries: AgentEntry[]) => {
    patch({
      agentEntries: entries,
      agentRefs: entries
        .filter((entry): entry is Extract<AgentEntry, { kind: "referenced" }> => entry.kind === "referenced")
        .map((entry) => entry.ref),
      agents: entries
        .filter((entry): entry is Extract<AgentEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.agent)
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
      toast({ title: "Validation Error", description: "Config ID is required.", variant: "destructive" });
      return;
    }
    const normalizedServerRefs = serverEntries
      .filter((entry): entry is Extract<ServerEntry, { kind: "referenced" }> => entry.kind === "referenced")
      .map((entry) => entry.ref)
      .map((ref) => {
        const matched = libServers.find((item) => item.id === ref);
        return matched?.id || ref;
      });
    const normalizedServerEntries = serverEntries.map((entry) => {
      if (entry.kind === "referenced") {
        const matched = libServers.find((item) => item.id === entry.ref);
        return { kind: "referenced" as const, ref: matched?.id || entry.ref };
      }
      return entry;
    });
    const normalizedAgentRefs = agentEntries
      .filter((entry): entry is Extract<AgentEntry, { kind: "referenced" }> => entry.kind === "referenced")
      .map((entry) => entry.ref)
      .map((ref) => {
        const matched = libAgents.find((item) => item.id === ref);
        return matched?.id || ref;
      });
    const normalizedAgentEntries = agentEntries.map((entry) => {
      if (entry.kind === "referenced") {
        const matched = libAgents.find((item) => item.id === entry.ref);
        return { kind: "referenced" as const, ref: matched?.id || entry.ref };
      }
      return entry;
    });

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
      serverEntries: normalizedServerEntries,
      serverRefs: normalizedServerRefs,
      servers: normalizedServerEntries
        .filter((entry): entry is Extract<ServerEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.server),
      agentEntries: normalizedAgentEntries,
      agentRefs: normalizedAgentRefs,
      agents: normalizedAgentEntries
        .filter((entry): entry is Extract<AgentEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.agent),
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

  const displayConfigName = config.configName?.trim() || config.name;
  const title = isNew ? "New MCP Evaluation" : editing ? `Editing: ${displayConfigName}` : displayConfigName;
  const configBasePath = isNew ? "/mcp-evaluations/new" : `/mcp-evaluations/${encodeURIComponent(config.id || id || "")}`;
  const isBrokenConfig = Boolean(existing?.loadError);

  const importServerFromLibrary = () => {
    const template = libServers.find((item) => item.id === selectedLibraryServerId);
    if (!template) return;
    const inlineCopy = { ...structuredClone(template), id: `srv-${Date.now()}` };
    setServerEntries([...serverEntries, { kind: "inline", server: inlineCopy }]);
    setSelectedLibraryServerId("");
  };

  const addServerReference = () => {
    const template = libServers.find((item) => item.id === selectedLibraryServerId);
    if (!template) return;
    const refName = template.id;
    const existing = new Set(
      serverEntries
        .filter((entry): entry is Extract<ServerEntry, { kind: "referenced" }> => entry.kind === "referenced")
        .map((entry) => entry.ref)
    );
    if (!existing.has(refName)) {
      setServerEntries([...serverEntries, { kind: "referenced", ref: refName }]);
    }
    setSelectedLibraryServerId("");
  };

  const addInlineServerEntry = () => {
    const createdAt = Date.now();
    const inlineServer: ServerConfig = {
      id: `srv-${createdAt}`,
      name: "",
      transport: "stdio",
      authType: "none",
      oauthRedirectUrl: "http://localhost:6274/oauth/",
    };
    setServerEntries([{ kind: "inline", server: inlineServer }, ...serverEntries]);
  };

  const removeServerEntryAt = (index: number) => {
    setServerEntries(serverEntries.filter((_, entryIndex) => entryIndex !== index));
  };

  const moveServerEntry = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= serverEntries.length) return;
    const nextEntries = [...serverEntries];
    const [moved] = nextEntries.splice(index, 1);
    nextEntries.splice(nextIndex, 0, moved);
    setServerEntries(nextEntries);
  };

  const convertReferencedServerToInline = (index: number) => {
    const entry = serverEntries[index];
    if (!entry || entry.kind !== "referenced") return;
    const template = findLibraryServerByRef(entry.ref);
    if (!template) {
      toast({ title: "Referenced server not found", variant: "destructive" });
      return;
    }
    const inlineCopy = { ...structuredClone(template), id: `srv-${Date.now()}` };
    const nextEntries = [...serverEntries];
    nextEntries[index] = { kind: "inline", server: inlineCopy };
    setServerEntries(nextEntries);
    toast({ title: "Referenced server converted to inline", description: inlineCopy.name || inlineCopy.id });
    setSelectedLibraryServerId("");
  };

  const libraryAgentRefOptions = useMemo(
    () =>
      libAgents
        .map((item) => ({
          id: item.id,
          ref: item.id,
          label: item.name || item.id,
          model: item.model
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [libAgents]
  );

  const toggleDefaultAgent = (agentName: string, checked: boolean) => {
    const nextDefaults = checked
      ? Array.from(new Set([...defaultRunAgentNames, agentName]))
      : defaultRunAgentNames.filter((name) => name !== agentName);

    patch({
      runDefaults: {
        ...(config.runDefaults ?? {}),
        selectedAgentNames: nextDefaults
      }
    });
  };

  const createCustomInlineAgentName = (baseName: string) => {
    const usedNames = new Set([
      ...agentEntries
        .filter((entry): entry is Extract<AgentEntry, { kind: "inline" }> => entry.kind === "inline")
        .map((entry) => entry.agent.name || entry.agent.id),
      ...libAgents.map((agent) => agent.name || agent.id)
    ]);
    const customBase = `${baseName}-custom`;
    let customName = customBase;
    let suffix = 2;
    while (usedNames.has(customName)) {
      customName = `${customBase}-${suffix}`;
      suffix += 1;
    }
    return customName;
  };

  const addInlineAgentEntry = () => {
    const createdAt = Date.now();
    const inlineAgent: AgentConfig = {
      id: `agt-${createdAt}`,
      name: "",
      provider: "openai",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 4096,
    };
    setAgentEntries([{ kind: "inline", agent: inlineAgent }, ...agentEntries]);
    setExpandedInlineAgentIds((prev) => ({ ...prev, [inlineAgent.id]: true }));
  };

  const addAgentReference = () => {
    const template = libAgents.find((item) => item.id === selectedLibraryAgentId);
    if (!template) return;
    const refName = template.id;
    const existing = new Set(
      agentEntries
        .filter((entry): entry is Extract<AgentEntry, { kind: "referenced" }> => entry.kind === "referenced")
        .map((entry) => entry.ref)
    );
    if (!existing.has(refName)) {
      setAgentEntries([...agentEntries, { kind: "referenced", ref: refName }]);
    }
    setSelectedLibraryAgentId("");
  };

  const importAgentFromLibraryInline = () => {
    const template = libAgents.find((item) => item.id === selectedLibraryAgentId);
    if (!template) return;
    const displayName = template.name || template.id;
    const customName = createCustomInlineAgentName(displayName);
    const inlineCopy: AgentConfig = {
      ...structuredClone(template),
      id: `agt-${Date.now()}`,
      name: customName
    };
    setAgentEntries([...agentEntries, { kind: "inline", agent: inlineCopy }]);
    setExpandedInlineAgentIds((prev) => ({ ...prev, [inlineCopy.id]: true }));
    setSelectedLibraryAgentId("");
    toast({ title: "Imported agent as inline", description: customName });
  };

  const removeAgentEntryAt = (index: number) => {
    const entry = agentEntries[index];
    if (!entry) return;
    const name = entry.kind === "inline" ? (entry.agent.name || entry.agent.id) : entry.ref;
    const nextDefaults = defaultRunAgentNames.filter((item) => item !== name);
    patch({
      runDefaults: {
        ...(config.runDefaults ?? {}),
        selectedAgentNames: nextDefaults
      }
    });
    if (entry.kind === "inline") {
      setExpandedInlineAgentIds((prev) => {
        const next = { ...prev };
        delete next[entry.agent.id];
        return next;
      });
    }
    setAgentEntries(agentEntries.filter((_, entryIndex) => entryIndex !== index));
  };

  const moveAgentEntry = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= agentEntries.length) return;
    const nextEntries = [...agentEntries];
    const [moved] = nextEntries.splice(index, 1);
    nextEntries.splice(nextIndex, 0, moved);
    setAgentEntries(nextEntries);
  };

  const convertReferencedAgentToInline = (index: number) => {
    const entry = agentEntries[index];
    if (!entry || entry.kind !== "referenced") return;
    const template = findLibraryAgentByRef(entry.ref);
    if (!template) {
      toast({ title: "Referenced agent not found", variant: "destructive" });
      return;
    }
    const displayName = template.name || template.id;
    const customName = createCustomInlineAgentName(displayName);
    const inlineCopy: AgentConfig = {
      ...structuredClone(template),
      id: `agt-${Date.now()}`,
      name: customName
    };
    const nextEntries = [...agentEntries];
    nextEntries[index] = { kind: "inline", agent: inlineCopy };
    setAgentEntries(nextEntries);
    setExpandedInlineAgentIds((prev) => ({ ...prev, [inlineCopy.id]: true }));
    toast({ title: "Referenced agent converted to inline", description: customName });
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

  const findLibraryServerByRef = (ref: string) =>
    libServers.find((item) => item.id === ref);
  const findLibraryAgentByRef = (ref: string) =>
    libAgents.find((item) => item.id === ref);
  const findLibraryScenarioByRef = (ref: string) =>
    libScenarios.find((item) => item.id === ref || item.name === ref);
  const referencedServerRefs = serverEntries
    .filter((entry): entry is Extract<ServerEntry, { kind: "referenced" }> => entry.kind === "referenced")
    .map((entry) => entry.ref);
  const referencedServers = referencedServerRefs
    .map(findLibraryServerByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const inlineServerEntries = serverEntries
    .filter((entry): entry is Extract<ServerEntry, { kind: "inline" }> => entry.kind === "inline");
  const inlineServers = inlineServerEntries.map((entry) => entry.server);
  const serverViewRows = serverEntries.flatMap((entry) => {
    if (entry.kind === "referenced") {
      const server = findLibraryServerByRef(entry.ref);
      return server ? [{ server, origin: "referenced" as const, ref: entry.ref }] : [];
    }
    return [{ server: entry.server, origin: "inline" as const, ref: undefined }];
  });
  const referencedAgentRefs = agentEntries
    .filter((entry): entry is Extract<AgentEntry, { kind: "referenced" }> => entry.kind === "referenced")
    .map((entry) => entry.ref);
  const referencedAgents = referencedAgentRefs
    .map(findLibraryAgentByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const inlineAgentEntries = agentEntries
    .filter((entry): entry is Extract<AgentEntry, { kind: "inline" }> => entry.kind === "inline");
  const inlineAgents = inlineAgentEntries.map((entry) => entry.agent);
  const agentViewRows = agentEntries.flatMap((entry) => {
    if (entry.kind === "referenced") {
      const agent = findLibraryAgentByRef(entry.ref);
      return agent ? [{ agent, origin: "referenced" as const, ref: entry.ref }] : [];
    }
    return [{ agent: entry.agent, origin: "inline" as const, ref: undefined }];
  });
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
  const missingServerRefs = referencedServerRefs.filter((ref) => !findLibraryServerByRef(ref));
  const missingAgentRefs = referencedAgentRefs.filter((ref) => !findLibraryAgentByRef(ref));
  const missingScenarioRefs = referencedScenarioIds.filter((ref) => !findLibraryScenarioByRef(ref));
  const missingServerRefSet = new Set(missingServerRefs);
  const missingScenarioRefSet = new Set(missingScenarioRefs);
  const totalServerCount = serverEntries.length;
  const totalAgentCount = agentEntries.length;
  const totalScenarioCount = scenarioEntries.length;

  useEffect(() => {
    if (!selectedLibraryAgentId) return;
    const exists = libAgents.some((item) => item.id === selectedLibraryAgentId);
    if (!exists) setSelectedLibraryAgentId("");
  }, [libAgents, selectedLibraryAgentId]);

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
          <div className={`grid gap-4 ${readOnly ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            {!readOnly && (
              <div className="space-y-1.5">
                <Label className="text-xs">Config ID</Label>
                <Input value={config.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} placeholder="e.g. check-weather" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Name (optional)</Label>
              <Input value={config.configName || ""} onChange={(e) => patch({ configName: e.target.value })} disabled={readOnly} placeholder="e.g. Weather checks baseline" />
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
              <CardContent className="pt-4 space-y-3">
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
                    <Button type="button" size="sm" variant="outline" className="h-8" onClick={addInlineServerEntry}>
                      Add server
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryServerId} onClick={addServerReference}>
                      Add Ref
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryServerId} onClick={importServerFromLibrary}>
                      Import Inline
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {serverEntries.map((entry, index) => {
                    const referenceServer = entry.kind === "referenced" ? findLibraryServerByRef(entry.ref) : null;
                    const rowName =
                      entry.kind === "inline"
                        ? (entry.server.name?.trim() || entry.server.id)
                        : (referenceServer?.name || entry.ref);
                    const rowKey = entry.kind === "inline" ? entry.server.id : entry.ref;
                    const isMissingRef = entry.kind === "referenced" && !referenceServer;
                    return (
                      <div key={`server-entry-${index}-${rowKey}`} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{index + 1}.</span>
                          <span className="truncate font-medium">{rowName}</span>
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
                                onClick={() => convertReferencedServerToInline(index)}
                                disabled={isMissingRef}
                              >
                                Convert to inline
                              </Button>
                              <Button size="sm" variant="outline" asChild>
                                <Link
                                  to={
                                    referenceServer
                                      ? `/libraries/servers/${encodeURIComponent(referenceServer.id)}`
                                      : "/libraries/servers"
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
                            onClick={() => moveServerEntry(index, -1)}
                            disabled={index === 0}
                            aria-label="Move server up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => moveServerEntry(index, 1)}
                            disabled={index === serverEntries.length - 1}
                            aria-label="Move server down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => removeServerEntryAt(index)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {serverEntries.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No servers configured yet. Add inline servers or references.
                    </p>
                  )}
                </div>
                {missingServerRefs.length > 0 && (
                  <p className="text-xs text-destructive">
                    Missing server refs: {missingServerRefs.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {readOnly ? (
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  {serverViewRows.map((row, index) => {
                    const viewServerKey = row.ref ?? row.server.id;
                    const expanded = Boolean(expandedViewServerIds[viewServerKey]);
                    return (
                      <div key={`server-view-${index}-${viewServerKey}`} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground">{index + 1}.</span>
                            <div className="truncate font-medium text-sm">{row.server.name || row.server.id}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={row.origin === "inline" ? "secondary" : "outline"}>
                              {row.origin === "inline" ? "Inline" : "Referenced"}
                            </Badge>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              onClick={() =>
                                setExpandedViewServerIds((prev) => ({
                                  ...prev,
                                  [viewServerKey]: !Boolean(prev[viewServerKey])
                                }))
                              }
                              aria-label={expanded ? "Collapse server details" : "Expand server details"}
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                            </Button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                            <Badge variant="outline" className="text-xs font-mono">
                              {row.server.transport}
                            </Badge>
                            {row.server.url && (
                              <span className="text-xs font-mono text-muted-foreground break-all">
                                {row.server.url}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {serverViewRows.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No servers configured.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <ServerForm
              servers={inlineServers}
              onChange={(servers) => {
                let cursor = 0;
                const nextEntries = serverEntries.map((entry) => {
                  if (entry.kind === "referenced") return entry;
                  const nextServer = servers[cursor];
                  cursor += 1;
                  return { kind: "inline" as const, server: nextServer ?? entry.server };
                });
                setServerEntries(nextEntries);
              }}
              readOnly={readOnly}
              allowAdd={false}
              allowStructureEdits={false}
            />
          )}
        </TabsContent>

        <TabsContent value="agents">
          {!readOnly && (
            <Card className="mb-4">
              <CardContent className="pt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Select value={selectedLibraryAgentId} onValueChange={setSelectedLibraryAgentId}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select agent from library" />
                    </SelectTrigger>
                    <SelectContent>
                      {libraryAgentRefOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-8" onClick={addInlineAgentEntry}>
                      Add agent
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryAgentId} onClick={addAgentReference}>
                      Add Ref
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={!selectedLibraryAgentId} onClick={importAgentFromLibraryInline}>
                      Import Inline
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {agentEntries.map((entry, index) => {
                    const referenceAgent = entry.kind === "referenced" ? findLibraryAgentByRef(entry.ref) : null;
                    const rowName =
                      entry.kind === "inline"
                        ? (entry.agent.name?.trim() || entry.agent.id)
                        : (referenceAgent?.name || entry.ref);
                    const rowModel = entry.kind === "inline" ? entry.agent.model : (referenceAgent?.model || "unknown");
                    const rowKey = entry.kind === "inline" ? entry.agent.id : entry.ref;
                    const isMissingRef = entry.kind === "referenced" && !referenceAgent;
                    const defaultName = entry.kind === "inline" ? entry.agent.id : entry.ref;
                    const defaultChecked = defaultRunAgentNames.includes(defaultName);
                    const inlineExpanded = entry.kind === "inline" && Boolean(expandedInlineAgentIds[entry.agent.id]);
                    return (
                      <div key={`agent-entry-${index}-${rowKey}`} className="rounded-md border text-sm">
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground">{index + 1}.</span>
                            <span className="truncate font-medium">{rowName}</span>
                            <Badge variant={entry.kind === "inline" ? "secondary" : "outline"}>
                              {entry.kind === "inline" ? "Inline" : "Referenced"}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-[10px]">{rowModel}</Badge>
                            {defaultChecked && (
                              <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50">
                                Default
                              </Badge>
                            )}
                            {isMissingRef && <Badge variant="destructive">Missing</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            <label className="mx-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={defaultChecked}
                                onChange={(e) => toggleDefaultAgent(defaultName, e.target.checked)}
                              />
                              <span>Default</span>
                            </label>
                            {entry.kind === "inline" && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setExpandedInlineAgentIds((prev) => ({
                                    ...prev,
                                    [entry.agent.id]: !Boolean(prev[entry.agent.id])
                                  }))
                                }
                              >
                                {inlineExpanded ? "Collapse" : "Expand"}
                              </Button>
                            )}
                            {entry.kind === "referenced" && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => convertReferencedAgentToInline(index)}
                                  disabled={isMissingRef}
                                >
                                  Convert to inline
                                </Button>
                                <Button size="sm" variant="outline" asChild>
                                  <Link
                                    to={
                                      referenceAgent
                                        ? `/libraries/agents/${encodeURIComponent(referenceAgent.id)}`
                                        : "/libraries/agents"
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
                              onClick={() => moveAgentEntry(index, -1)}
                              disabled={index === 0}
                              aria-label="Move agent up"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => moveAgentEntry(index, 1)}
                              disabled={index === agentEntries.length - 1}
                              aria-label="Move agent down"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => removeAgentEntryAt(index)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                        {entry.kind === "inline" && inlineExpanded && (
                          <div className="border-t px-3 py-3 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Name</Label>
                                <Input
                                  value={entry.agent.name}
                                  onChange={(e) => {
                                    const nextEntries = [...agentEntries];
                                    nextEntries[index] = {
                                      kind: "inline",
                                      agent: { ...entry.agent, name: e.target.value }
                                    };
                                    setAgentEntries(nextEntries);
                                  }}
                                  placeholder="e.g. GPT-5 Mini custom"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Provider</Label>
                                <Select
                                  value={entry.agent.provider}
                                  onValueChange={(value) => {
                                    const nextEntries = [...agentEntries];
                                    nextEntries[index] = {
                                      kind: "inline",
                                      agent: { ...entry.agent, provider: value as AgentConfig["provider"] }
                                    };
                                    setAgentEntries(nextEntries);
                                  }}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Model</Label>
                                <Input
                                  value={entry.agent.model}
                                  onChange={(e) => {
                                    const nextEntries = [...agentEntries];
                                    nextEntries[index] = {
                                      kind: "inline",
                                      agent: { ...entry.agent, model: e.target.value }
                                    };
                                    setAgentEntries(nextEntries);
                                  }}
                                  className="font-mono text-xs"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Max Tokens</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={128000}
                                  value={entry.agent.maxTokens}
                                  onChange={(e) => {
                                    const nextEntries = [...agentEntries];
                                    nextEntries[index] = {
                                      kind: "inline",
                                      agent: { ...entry.agent, maxTokens: parseInt(e.target.value) || 0 }
                                    };
                                    setAgentEntries(nextEntries);
                                  }}
                                  className="font-mono text-xs"
                                />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Temperature</Label>
                              <Input
                                type="number"
                                min={0}
                                max={2}
                                step={0.01}
                                value={entry.agent.temperature}
                                onChange={(e) => {
                                  const nextEntries = [...agentEntries];
                                  nextEntries[index] = {
                                    kind: "inline",
                                    agent: { ...entry.agent, temperature: Number(e.target.value) || 0 }
                                  };
                                  setAgentEntries(nextEntries);
                                }}
                                className="font-mono text-xs"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">System Prompt</Label>
                              <Textarea
                                value={entry.agent.systemPrompt || ""}
                                onChange={(e) => {
                                  const nextEntries = [...agentEntries];
                                  nextEntries[index] = {
                                    kind: "inline",
                                    agent: { ...entry.agent, systemPrompt: e.target.value }
                                  };
                                  setAgentEntries(nextEntries);
                                }}
                                rows={3}
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {agentEntries.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No agents configured yet. Add inline agents or references.
                    </p>
                  )}
                </div>
                {missingAgentRefs.length > 0 && (
                  <p className="text-xs text-destructive">
                    Missing agent refs: {missingAgentRefs.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {readOnly ? (
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  {agentViewRows.map((row, index) => {
                    const name = row.agent.name || row.agent.id;
                    const isDefault = defaultRunAgentNames.includes(row.origin === "inline" ? row.agent.id : (row.ref || row.agent.id));
                    const viewAgentKey = row.ref ?? row.agent.id;
                    const expanded = Boolean(expandedViewAgentIds[viewAgentKey]);
                    return (
                      <div key={`agent-view-${index}-${row.ref ?? row.agent.id}`} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground">{index + 1}.</span>
                            <div className="truncate font-medium text-sm">{name}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isDefault && (
                              <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50">
                                Default
                              </Badge>
                            )}
                            <Badge variant={row.origin === "inline" ? "secondary" : "outline"}>
                              {row.origin === "inline" ? "Inline" : "Referenced"}
                            </Badge>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              onClick={() =>
                                setExpandedViewAgentIds((prev) => ({
                                  ...prev,
                                  [viewAgentKey]: !Boolean(prev[viewAgentKey])
                                }))
                              }
                              aria-label={expanded ? "Collapse agent details" : "Expand agent details"}
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                            </Button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                            <ProviderBadge provider={row.agent.provider} />
                            <Badge variant="outline" className="text-xs font-mono">
                              {row.agent.model}
                            </Badge>
                            <Badge variant="outline" className="text-xs font-mono">
                              max_tokens: {row.agent.maxTokens}
                            </Badge>
                            <Badge variant="outline" className="text-xs font-mono">
                              temperature: {row.agent.temperature}
                            </Badge>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {agentViewRows.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No agents configured.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}
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
                      Add scenario
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
