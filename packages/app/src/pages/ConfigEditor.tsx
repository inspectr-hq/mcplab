import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Bot,
  FileText,
  Play,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProviderBadge } from '@/components/ProviderBadge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useConfigs } from '@/contexts/ConfigContext';
import { useDataSource } from '@/contexts/DataSourceContext';
import { useLibraries } from '@/contexts/LibraryContext';
import { ScenarioForm } from '@/components/config-editor/ScenarioForm';
import { toast } from '@/hooks/use-toast';
import { validateServerAuthConfig } from '@/lib/server-auth-validation';
import { safeText } from '@/lib/utils';
import { DEFAULT_AGENT_TEMPERATURE, resolveAgentTemperature } from '@/lib/agent-temperature';
import type {
  AgentConfig,
  AgentEntry,
  EvalConfig,
  Scenario,
  ScenarioEntry,
  ServerConfig,
  ServerEntry
} from '@/types/eval';

const emptyConfig = (): EvalConfig => ({
  id: `cfg-${Date.now()}`,
  name: '',
  configName: '',
  description: '',
  servers: [],
  serverEntries: [],
  agents: [],
  agentEntries: [],
  scenarios: [],
  scenarioEntries: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const ConfigEditor = () => {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getConfig, addConfig, updateConfig, loading } = useConfigs();
  const { source } = useDataSource();
  const { servers: libServers, agents: libAgents, scenarios: libScenarios } = useLibraries();

  const isNew = id === 'new';
  const isView = !isNew && !!id;
  const existing = isView ? getConfig(id!) : undefined;

  const [editing, setEditing] = useState(isNew || tabParam === 'edit');
  const [config, setConfig] = useState<EvalConfig>(() =>
    existing ? structuredClone(existing) : emptyConfig()
  );
  const [selectedLibraryScenarioId, setSelectedLibraryScenarioId] = useState('');
  const [selectedLibraryAgentId, setSelectedLibraryAgentId] = useState('');
  const [expandedInlineAgentIds, setExpandedInlineAgentIds] = useState<Record<string, boolean>>({});
  const [expandedViewAgentIds, setExpandedViewAgentIds] = useState<Record<string, boolean>>({});
  const [expandedInlineScenarioIds, setExpandedInlineScenarioIds] = useState<
    Record<string, boolean>
  >({});
  const activeTab = useMemo(() => {
    const tab = tabParam || searchParams.get('tab');
    return tab === 'agents' || tab === 'scenarios' ? tab : 'scenarios';
  }, [tabParam, searchParams]);
  const testCaseReturnToPath = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (existing && !editing) {
      setConfig(structuredClone(existing));
    }
  }, [existing, editing]);

  useEffect(() => {
    if (tabParam === 'edit' && !isNew) setEditing(true);
  }, [tabParam, isNew]);

  const patch = (updates: Partial<EvalConfig>) => setConfig((c) => ({ ...c, ...updates }));

  const serverEntries = useMemo<ServerEntry[]>(() => {
    if (config.serverEntries && config.serverEntries.length > 0) return config.serverEntries;
    return (config.servers ?? []).map((server) => ({ kind: 'inline' as const, server }));
  }, [config.serverEntries, config.servers]);

  const setServerEntries = (entries: ServerEntry[]) => {
    patch({
      serverEntries: entries,
      servers: entries
        .filter(
          (entry): entry is Extract<ServerEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => entry.server)
    });
  };

  const scenarioEntries = useMemo<ScenarioEntry[]>(() => {
    if (config.scenarioEntries && config.scenarioEntries.length > 0) return config.scenarioEntries;
    return config.scenarios.map((scenario) => ({ kind: 'inline' as const, scenario }));
  }, [config.scenarioEntries, config.scenarios]);

  const setScenarioEntries = (entries: ScenarioEntry[]) => {
    patch({
      scenarioEntries: entries,
      scenarios: entries
        .filter(
          (entry): entry is Extract<ScenarioEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => entry.scenario)
    });
  };

  const agentEntries = useMemo<AgentEntry[]>(() => {
    if (config.agentEntries && config.agentEntries.length > 0) return config.agentEntries;
    return config.agents.map((agent) => ({ kind: 'inline' as const, agent }));
  }, [config.agentEntries, config.agents]);

  const setAgentEntries = (entries: AgentEntry[]) => {
    patch({
      agentEntries: entries,
      agents: entries
        .filter(
          (entry): entry is Extract<AgentEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => entry.agent)
    });
  };

  const readOnly = !editing;
  const defaultRunAgentNames = config.runDefaults?.selectedAgentNames ?? [];

  const handleSave = async () => {
    if (!config.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Config ID is required.',
        variant: 'destructive'
      });
      return;
    }
    const normalizedServerEntries = serverEntries.map((entry) => {
      if (entry.kind === 'referenced') {
        const matched = libServers.find((item) => item.id === entry.ref);
        return { kind: 'referenced' as const, ref: matched?.id || entry.ref };
      }
      return entry;
    });
    const normalizedAgentEntries = agentEntries.map((entry) => {
      if (entry.kind === 'referenced') {
        const matched = libAgents.find((item) => item.id === entry.ref);
        return { kind: 'referenced' as const, ref: matched?.id || entry.ref };
      }
      return entry;
    });

    const normalizedScenarioEntries = scenarioEntries.map((entry) => {
      if (entry.kind === 'referenced') {
        const matched = libScenarios.find((item) => item.id === entry.ref);
        const normalizedMcpServers = (entry.mcpServers ?? []).map((serverEntry) => {
          if (serverEntry.kind === 'referenced') {
            const serverMatch = libServers.find((item) => item.id === serverEntry.ref);
            return { kind: 'referenced' as const, ref: serverMatch?.id || serverEntry.ref };
          }
          return serverEntry;
        });
        return {
          kind: 'referenced' as const,
          ref: matched?.id || entry.ref,
          ...(entry.mcpServers !== undefined ? { mcpServers: normalizedMcpServers } : {})
        };
      }
      return entry;
    });
    const invalidInlineServer = normalizedServerEntries
      .filter((entry): entry is Extract<ServerEntry, { kind: 'inline' }> => entry.kind === 'inline')
      .map((entry) => ({ server: entry.server, error: validateServerAuthConfig(entry.server) }))
      .find((entry) => Boolean(entry.error));
    if (invalidInlineServer?.error) {
      toast({
        title: 'Validation Error',
        description: invalidInlineServer.error,
        variant: 'destructive'
      });
      return;
    }
    const unnamedInline = normalizedScenarioEntries
      .filter(
        (entry): entry is Extract<ScenarioEntry, { kind: 'inline' }> => entry.kind === 'inline'
      )
      .some((entry) => !entry.scenario.name?.trim());
    if (unnamedInline) {
      toast({
        title: 'Validation Error',
        description: 'Inline scenarios must have a name before saving.',
        variant: 'destructive'
      });
      return;
    }
    const validAgentIds = new Set(
      normalizedAgentEntries.map((entry) => (entry.kind === 'inline' ? entry.agent.id : entry.ref))
    );
    const normalizedDefaultAgentIds = (config.runDefaults?.selectedAgentNames ?? []).filter((id) =>
      validAgentIds.has(id)
    );
    const nextConfig = {
      ...config,
      serverEntries: normalizedServerEntries,
      servers: normalizedServerEntries
        .filter(
          (entry): entry is Extract<ServerEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => entry.server),
      agentEntries: normalizedAgentEntries,
      agents: normalizedAgentEntries
        .filter(
          (entry): entry is Extract<AgentEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => entry.agent),
      scenarioEntries: normalizedScenarioEntries,
      scenarios: normalizedScenarioEntries
        .filter(
          (entry): entry is Extract<ScenarioEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => entry.scenario as Scenario),
      runDefaults:
        normalizedDefaultAgentIds.length > 0
          ? {
              ...(config.runDefaults ?? {}),
              selectedAgentNames: normalizedDefaultAgentIds
            }
          : undefined,
      updatedAt: new Date().toISOString()
    };
    if (isNew) {
      const created = await addConfig(nextConfig);
      setConfig(created);
      const createdDisplayName = safeText(created.configName, safeText(created.name, created.id));
      toast({
        title: 'MCP Evaluation Created',
        description: `"${createdDisplayName}" has been saved.`
      });
      navigate(`/mcp-evaluations/${created.id}`);
    } else {
      const updated = await updateConfig(config.id, nextConfig);
      setConfig(updated);
      const updatedDisplayName = safeText(updated.configName, safeText(updated.name, updated.id));
      toast({
        title: 'MCP Evaluation Updated',
        description: `"${updatedDisplayName}" has been updated.`
      });
      setEditing(false);
      navigate(`/mcp-evaluations/${updated.id}`, { replace: true });
    }
  };

  const displayConfigName = safeText(config.configName, safeText(config.name, config.id));
  const title = isNew
    ? 'New MCP Evaluation'
    : editing
    ? `Editing: ${displayConfigName}`
    : displayConfigName;
  const configBasePath = isNew
    ? '/mcp-evaluations/new'
    : `/mcp-evaluations/${encodeURIComponent(config.id || id || '')}`;
  const isBrokenConfig = Boolean(existing?.loadError);

  const libraryAgentRefOptions = useMemo(
    () =>
      libAgents
        .map((item) => ({
          id: item.id,
          ref: item.id,
          label: safeText(item.name, item.id),
          model: item.model
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [libAgents]
  );

  const toggleDefaultAgent = (agentId: string, checked: boolean) => {
    const nextDefaults = checked
      ? Array.from(new Set([...defaultRunAgentNames, agentId]))
      : defaultRunAgentNames.filter((name) => name !== agentId);

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
        .filter(
          (entry): entry is Extract<AgentEntry, { kind: 'inline' }> => entry.kind === 'inline'
        )
        .map((entry) => safeText(entry.agent.name, entry.agent.id)),
      ...libAgents.map((agent) => safeText(agent.name, agent.id))
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
      name: '',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: DEFAULT_AGENT_TEMPERATURE,
      maxTokens: 4096
    };
    setAgentEntries([{ kind: 'inline', agent: inlineAgent }, ...agentEntries]);
    setExpandedInlineAgentIds((prev) => ({ ...prev, [inlineAgent.id]: true }));
  };

  const addAgentReference = () => {
    const template = libAgents.find((item) => item.id === selectedLibraryAgentId);
    if (!template) return;
    const refName = template.id;
    const existing = new Set(
      agentEntries
        .filter(
          (entry): entry is Extract<AgentEntry, { kind: 'referenced' }> =>
            entry.kind === 'referenced'
        )
        .map((entry) => entry.ref)
    );
    if (!existing.has(refName)) {
      setAgentEntries([...agentEntries, { kind: 'referenced', ref: refName }]);
    }
    setSelectedLibraryAgentId('');
  };

  const addAllAgentReferences = () => {
    const existing = new Set(
      agentEntries
        .filter(
          (entry): entry is Extract<AgentEntry, { kind: 'referenced' }> =>
            entry.kind === 'referenced'
        )
        .map((entry) => entry.ref)
    );
    const newRefs = libAgents
      .filter((agent) => !existing.has(agent.id))
      .map((agent) => ({ kind: 'referenced' as const, ref: agent.id }));
    if (newRefs.length > 0) {
      setAgentEntries([...agentEntries, ...newRefs]);
    }
  };

  const importAgentFromLibraryInline = () => {
    const template = libAgents.find((item) => item.id === selectedLibraryAgentId);
    if (!template) return;
    const displayName = safeText(template.name, template.id);
    const customName = createCustomInlineAgentName(displayName);
    const inlineCopy: AgentConfig = {
      ...structuredClone(template),
      id: `agt-${Date.now()}`,
      name: customName
    };
    setAgentEntries([...agentEntries, { kind: 'inline', agent: inlineCopy }]);
    setExpandedInlineAgentIds((prev) => ({ ...prev, [inlineCopy.id]: true }));
    setSelectedLibraryAgentId('');
    toast({ title: 'Imported agent as inline', description: customName });
  };

  const removeAgentEntryAt = (index: number) => {
    const entry = agentEntries[index];
    if (!entry) return;
    const removedAgentId = entry.kind === 'inline' ? entry.agent.id : entry.ref;
    const nextDefaults = defaultRunAgentNames.filter((item) => item !== removedAgentId);
    patch({
      runDefaults: {
        ...(config.runDefaults ?? {}),
        selectedAgentNames: nextDefaults
      }
    });
    if (entry.kind === 'inline') {
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
    if (!entry || entry.kind !== 'referenced') return;
    const template = findLibraryAgentByRef(entry.ref);
    if (!template) {
      toast({ title: 'Referenced agent not found', variant: 'destructive' });
      return;
    }
    const displayName = safeText(template.name, template.id);
    const customName = createCustomInlineAgentName(displayName);
    const inlineCopy: AgentConfig = {
      ...structuredClone(template),
      id: `agt-${Date.now()}`,
      name: customName
    };
    const nextEntries = [...agentEntries];
    nextEntries[index] = { kind: 'inline', agent: inlineCopy };
    setAgentEntries(nextEntries);
    if (defaultRunAgentNames.includes(entry.ref)) {
      const nextDefaults = defaultRunAgentNames.map((item) =>
        item === entry.ref ? inlineCopy.id : item
      );
      patch({
        runDefaults: {
          ...(config.runDefaults ?? {}),
          selectedAgentNames: Array.from(new Set(nextDefaults))
        }
      });
    }
    setExpandedInlineAgentIds((prev) => ({ ...prev, [inlineCopy.id]: true }));
    toast({ title: 'Referenced agent converted to inline', description: customName });
  };

  const importScenarioFromLibrary = () => {
    const template = libScenarios.find((item) => item.id === selectedLibraryScenarioId);
    if (!template) return;
    const importedScenario = {
      ...structuredClone(template),
      id: `scn-${Date.now()}`,
      serverIds: [...template.serverIds]
    };
    setScenarioEntries([...scenarioEntries, { kind: 'inline', scenario: importedScenario }]);
    setExpandedInlineScenarioIds((prev) => ({ ...prev, [importedScenario.id]: true }));
    setSelectedLibraryScenarioId('');
  };

  const addInlineScenarioEntry = () => {
    const createdAt = Date.now();
    const inlineScenario: Scenario = {
      id: `scn-${createdAt}`,
      name: '',
      serverIds: [],
      prompt: '',
      evalRules: [],
      extractRules: []
    };
    setScenarioEntries([{ kind: 'inline', scenario: inlineScenario }, ...scenarioEntries]);
    setExpandedInlineScenarioIds((prev) => ({ ...prev, [inlineScenario.id]: true }));
  };

  const addScenarioReference = () => {
    const template = libScenarios.find((item) => item.id === selectedLibraryScenarioId);
    if (!template) return;
    const refId = template.id;
    const existing = new Set(
      scenarioEntries
        .filter(
          (entry): entry is Extract<ScenarioEntry, { kind: 'referenced' }> =>
            entry.kind === 'referenced'
        )
        .map((entry) => entry.ref)
    );
    if (!existing.has(refId)) {
      setScenarioEntries([...scenarioEntries, { kind: 'referenced', ref: refId }]);
    }
    setSelectedLibraryScenarioId('');
  };

  const removeScenarioEntryAt = (index: number) => {
    const entry = scenarioEntries[index];
    if (entry?.kind === 'inline') {
      setExpandedInlineScenarioIds((prev) => {
        const next = { ...prev };
        delete next[entry.scenario.id];
        return next;
      });
    }
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
    if (!entry || entry.kind !== 'referenced') return;
    const template = findLibraryScenarioByRef(entry.ref);
    if (!template) {
      toast({ title: 'Referenced scenario not found', variant: 'destructive' });
      return;
    }
    const usedNames = new Set(
      scenarioEntries
        .filter(
          (item): item is Extract<ScenarioEntry, { kind: 'inline' }> => item.kind === 'inline'
        )
        .map((item) => item.scenario.name?.trim().toLowerCase())
        .filter(Boolean) as string[]
    );
    const baseName = `${safeText(template.name, template.id)}-custom`;
    let nextName = baseName;
    let suffix = 2;
    while (usedNames.has(nextName.toLowerCase())) {
      nextName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    const createdAt = Date.now();
    const inlineCopy: Scenario = {
      ...structuredClone(template),
      id: `scn-${createdAt}`,
      name: nextName,
      serverIds:
        entry.mcpServers && entry.mcpServers.length > 0
          ? entry.mcpServers.map((serverEntry) =>
              serverEntry.kind === 'referenced' ? serverEntry.ref : serverEntry.server.id
            )
          : [...template.serverIds]
    };
    const nextEntries = [...scenarioEntries];
    nextEntries[index] = { kind: 'inline', scenario: inlineCopy };
    setScenarioEntries(nextEntries);
    setExpandedInlineScenarioIds((prev) => ({ ...prev, [inlineCopy.id]: true }));
    toast({ title: 'Referenced scenario converted to inline', description: nextName });
  };

  const findLibraryServerByRef = (ref: string) => libServers.find((item) => item.id === ref);
  const findLibraryAgentByRef = (ref: string) => libAgents.find((item) => item.id === ref);
  const findLibraryScenarioByRef = (ref: string) => libScenarios.find((item) => item.id === ref);
  const referencedServerRefs = serverEntries
    .filter(
      (entry): entry is Extract<ServerEntry, { kind: 'referenced' }> => entry.kind === 'referenced'
    )
    .map((entry) => entry.ref);
  const referencedServers = referencedServerRefs
    .map(findLibraryServerByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const referencedAgentRefs = agentEntries
    .filter(
      (entry): entry is Extract<AgentEntry, { kind: 'referenced' }> => entry.kind === 'referenced'
    )
    .map((entry) => entry.ref);
  const referencedAgents = referencedAgentRefs
    .map(findLibraryAgentByRef)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const inlineAgentEntries = agentEntries.filter(
    (entry): entry is Extract<AgentEntry, { kind: 'inline' }> => entry.kind === 'inline'
  );
  const agentViewRows = agentEntries.flatMap(
    (entry): { agent: AgentConfig; origin: 'inline' | 'referenced'; ref: string | undefined }[] => {
      if (entry.kind === 'referenced') {
        const agent = findLibraryAgentByRef(entry.ref);
        return agent ? [{ agent, origin: 'referenced', ref: entry.ref }] : [];
      }
      return [{ agent: entry.agent, origin: 'inline', ref: undefined }];
    }
  );
  const referencedScenarioIds = scenarioEntries
    .filter(
      (entry): entry is Extract<ScenarioEntry, { kind: 'referenced' }> =>
        entry.kind === 'referenced'
    )
    .map((entry) => entry.ref);
  const scenarioViewRows = scenarioEntries.flatMap(
    (
      entry
    ): { scenario: Scenario; origin: 'inline' | 'referenced'; hasMcpServerOverride: boolean }[] => {
      if (entry.kind === 'referenced') {
        const scenario = findLibraryScenarioByRef(entry.ref);
        if (!scenario) return [];
        if (entry.mcpServers === undefined) {
          return [{ scenario, origin: 'referenced', hasMcpServerOverride: false }];
        }
        const overrideServerIds = entry.mcpServers.flatMap((serverEntry) => {
          if (serverEntry.kind === 'referenced') return [serverEntry.ref];
          return [serverEntry.server.id];
        });
        return [
          {
            scenario: { ...scenario, serverIds: overrideServerIds },
            origin: 'referenced',
            hasMcpServerOverride: true
          }
        ];
      }
      return [{ scenario: entry.scenario, origin: 'inline', hasMcpServerOverride: false }];
    }
  );
  const scenarioViewAgents = Array.from(
    new Map(
      [...libAgents, ...config.agents, ...referencedAgents].map(
        (agent) => [agent.id, agent] as const
      )
    ).values()
  );
  const scenarioViewServers = Array.from(
    new Map(
      [...libServers, ...(config.servers ?? []), ...referencedServers].map(
        (server) => [server.id, server] as const
      )
    ).values()
  );
  const scenarioOverrideServerRefs = scenarioEntries
    .filter(
      (entry): entry is Extract<ScenarioEntry, { kind: 'referenced' }> =>
        entry.kind === 'referenced'
    )
    .flatMap((entry) =>
      (entry.mcpServers ?? [])
        .filter(
          (serverEntry): serverEntry is Extract<ServerEntry, { kind: 'referenced' }> =>
            serverEntry.kind === 'referenced'
        )
        .map((serverEntry) => serverEntry.ref)
    );
  const missingServerRefs = Array.from(
    new Set(
      [...referencedServerRefs, ...scenarioOverrideServerRefs].filter(
        (ref) => !findLibraryServerByRef(ref)
      )
    )
  );
  const missingAgentRefs = referencedAgentRefs.filter((ref) => !findLibraryAgentByRef(ref));
  const missingScenarioRefs = referencedScenarioIds.filter((ref) => !findLibraryScenarioByRef(ref));
  const missingServerRefSet = new Set(missingServerRefs);
  const missingScenarioRefSet = new Set(missingScenarioRefs);
  const totalAgentCount = agentEntries.length;
  const totalScenarioCount = scenarioEntries.length;

  const allServerOptions = [...libServers];

  const updateReferencedScenarioServers = (index: number, nextServerIds: string[]) => {
    const entry = scenarioEntries[index];
    if (!entry || entry.kind !== 'referenced') return;
    const nextEntries = [...scenarioEntries];
    nextEntries[index] = {
      kind: 'referenced',
      ref: entry.ref,
      mcpServers: nextServerIds.map((id) => ({ kind: 'referenced' as const, ref: id }))
    };
    setScenarioEntries(nextEntries);
  };

  const resetReferencedScenarioServersOverride = (index: number) => {
    const entry = scenarioEntries[index];
    if (!entry || entry.kind !== 'referenced') return;
    const nextEntries = [...scenarioEntries];
    nextEntries[index] = { kind: 'referenced', ref: entry.ref };
    setScenarioEntries(nextEntries);
  };

  useEffect(() => {
    if (!selectedLibraryAgentId) return;
    const exists = libAgents.some((item) => item.id === selectedLibraryAgentId);
    if (!exists) setSelectedLibraryAgentId('');
  }, [libAgents, selectedLibraryAgentId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link to="/mcp-evaluations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {isNew ? (
              'Create a new MCP evaluation'
            ) : loading ? (
              'Loading configuration...'
            ) : existing ? (
              existing.loadError ? (
                'MCP evaluation could not be fully loaded'
              ) : (
                <>
                  Last updated <span>{new Date(config.updatedAt).toLocaleDateString()}</span>
                </>
              )
            ) : (
              'MCP evaluation not found'
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isView && !editing && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(true);
                navigate(`${configBasePath}/edit`);
              }}
            >
              Edit
            </Button>
          )}
          {isView && !editing && existing && !isBrokenConfig && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/run?configId=${encodeURIComponent(existing.id)}`}>
                <Play className="h-3.5 w-3.5" />
                Run Evaluation
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfig(structuredClone(existing!));
                    setEditing(false);
                    navigate(configBasePath);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button size="sm" onClick={() => void handleSave()}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
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
                  The file is still present, but it could not be loaded because one or more
                  references or fields are invalid.
                </p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs font-medium mb-1">File</p>
              <p className="text-xs font-mono break-all">
                {existing?.sourcePath || existing?.relativePath}
              </p>
            </div>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-medium mb-1 text-destructive">Load Error</p>
              <p className="text-xs break-all text-destructive">{existing?.loadError}</p>
            </div>
            {(missingServerRefs.length > 0 ||
              missingAgentRefs.length > 0 ||
              missingScenarioRefs.length > 0) && (
              <div className="rounded-md border border-destructive/30 bg-background p-3 space-y-1.5">
                <p className="text-xs font-medium">Broken references</p>
                {missingServerRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Servers:{' '}
                    <span className="text-destructive">{missingServerRefs.join(', ')}</span>
                  </p>
                )}
                {missingAgentRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Agents: <span className="text-destructive">{missingAgentRefs.join(', ')}</span>
                  </p>
                )}
                {missingScenarioRefs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Scenarios:{' '}
                    <span className="text-destructive">{missingScenarioRefs.join(', ')}</span>
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
          variant={activeTab === 'scenarios' ? 'default' : 'outline'}
          className="py-1 px-3 text-xs"
        >
          <Link
            to={`${configBasePath}/scenarios`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileText className="h-3 w-3" />
            {totalScenarioCount} scenario{totalScenarioCount !== 1 ? 's' : ''}
          </Link>
        </Badge>
        <Badge
          variant={activeTab === 'agents' ? 'default' : 'outline'}
          className="py-1 px-3 text-xs"
        >
          <Link
            to={`${configBasePath}/agents`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Bot className="h-3 w-3" />
            {totalAgentCount} agent{totalAgentCount !== 1 ? 's' : ''}
          </Link>
        </Badge>
      </div>

      {/* Meta fields */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className={`grid gap-4 ${readOnly || !isNew ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            {!readOnly && isNew && (
              <div className="space-y-1.5">
                <Label className="text-xs">Config ID</Label>
                <Input
                  value={config.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  disabled={readOnly}
                  placeholder="e.g. check-weather"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Name (optional)</Label>
              <Input
                value={config.configName || ''}
                onChange={(e) => patch({ configName: e.target.value })}
                disabled={readOnly}
                placeholder="e.g. Weather checks baseline"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input
                value={config.description || ''}
                onChange={(e) => patch({ description: e.target.value })}
                disabled={readOnly}
                placeholder="Brief description..."
              />
            </div>
          </div>
          {!isNew && (config.sourcePath || config.relativePath) && (
            <div className="border-t pt-3">
              <Label className="text-xs">File location</Label>
              <p className="mt-1 text-xs font-mono text-muted-foreground break-all">
                {config.sourcePath || config.relativePath}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabbed sections */}
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          if (tab !== 'servers' && tab !== 'agents' && tab !== 'scenarios') return;
          const next = new URLSearchParams(searchParams);
          next.delete('tab');
          setSearchParams(next, { replace: true });
          if (id && id !== 'new') {
            navigate(`/mcp-evaluations/${encodeURIComponent(id)}/${tab}`, { replace: true });
            return;
          }
          navigate(`/mcp-evaluations/${id ?? 'new'}/${tab}`, { replace: true });
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="scenarios" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Scenarios
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5">
            <Bot className="h-3.5 w-3.5" />
            Agents
          </TabsTrigger>
        </TabsList>

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
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!selectedLibraryAgentId}
                      onClick={addAgentReference}
                    >
                      Add Ref
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!selectedLibraryAgentId}
                      onClick={importAgentFromLibraryInline}
                    >
                      Import Inline
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={
                        libAgents.length === 0 ||
                        libAgents.every((a) =>
                          agentEntries.some((e) => e.kind === 'referenced' && e.ref === a.id)
                        )
                      }
                      onClick={addAllAgentReferences}
                    >
                      Add All Refs
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={addInlineAgentEntry}
                    >
                      Add agent
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {agentEntries.map((entry, index) => {
                    const referenceAgent =
                      entry.kind === 'referenced' ? findLibraryAgentByRef(entry.ref) : null;
                    const rowName =
                      entry.kind === 'inline'
                        ? safeText(entry.agent.name, entry.agent.id)
                        : safeText(referenceAgent?.name, entry.ref);
                    const rowModel =
                      entry.kind === 'inline'
                        ? entry.agent.model
                        : referenceAgent?.model || 'unknown';
                    const rowKey = entry.kind === 'inline' ? entry.agent.id : entry.ref;
                    const isMissingRef = entry.kind === 'referenced' && !referenceAgent;
                    const defaultName = entry.kind === 'inline' ? entry.agent.id : entry.ref;
                    const defaultChecked = defaultRunAgentNames.includes(defaultName);
                    const inlineExpanded =
                      entry.kind === 'inline' && Boolean(expandedInlineAgentIds[entry.agent.id]);
                    return (
                      <div
                        key={`agent-entry-${index}-${rowKey}`}
                        className="rounded-md border text-sm"
                      >
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={() => moveAgentEntry(index, -1)}
                                disabled={index === 0}
                                aria-label="Move agent up"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={() => moveAgentEntry(index, 1)}
                                disabled={index === agentEntries.length - 1}
                                aria-label="Move agent down"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className="text-xs text-muted-foreground">{index + 1}.</span>
                            <span className="truncate font-medium">{rowName}</span>
                            <Badge variant={entry.kind === 'inline' ? 'secondary' : 'outline'}>
                              {entry.kind === 'inline' ? 'Inline' : 'Referenced'}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {rowModel}
                            </Badge>
                            {defaultChecked && (
                              <Badge
                                variant="outline"
                                className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50"
                              >
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
                            {entry.kind === 'inline' && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setExpandedInlineAgentIds((prev) => ({
                                    ...prev,
                                    // eslint-disable-next-line no-extra-boolean-cast
                                    [entry.agent.id]: !Boolean(prev[entry.agent.id])
                                  }))
                                }
                              >
                                {inlineExpanded ? 'Collapse' : 'Expand'}
                              </Button>
                            )}
                            {entry.kind === 'referenced' && (
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
                              </>
                            )}
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeAgentEntryAt(index)}
                              aria-label="Remove agent entry"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {entry.kind === 'inline' && inlineExpanded && (
                          <div className="border-t px-3 py-3 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Name</Label>
                                <Input
                                  value={entry.agent.name}
                                  onChange={(e) => {
                                    const nextEntries = [...agentEntries];
                                    nextEntries[index] = {
                                      kind: 'inline',
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
                                      kind: 'inline',
                                      agent: {
                                        ...entry.agent,
                                        provider: value as AgentConfig['provider']
                                      }
                                    };
                                    setAgentEntries(nextEntries);
                                  }}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
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
                                      kind: 'inline',
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
                                      kind: 'inline',
                                      agent: {
                                        ...entry.agent,
                                        maxTokens: parseInt(e.target.value) || 0
                                      }
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
                                value={resolveAgentTemperature(entry.agent.temperature)}
                                onChange={(e) => {
                                  const nextEntries = [...agentEntries];
                                  nextEntries[index] = {
                                    kind: 'inline',
                                    agent: {
                                      ...entry.agent,
                                      temperature:
                                        Number(e.target.value) || DEFAULT_AGENT_TEMPERATURE
                                    }
                                  };
                                  setAgentEntries(nextEntries);
                                }}
                                className="font-mono text-xs"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">System Prompt</Label>
                              <Textarea
                                value={entry.agent.systemPrompt || ''}
                                onChange={(e) => {
                                  const nextEntries = [...agentEntries];
                                  nextEntries[index] = {
                                    kind: 'inline',
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
                    Missing agent refs: {missingAgentRefs.join(', ')}
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
                    const name = safeText(row.agent.name, row.agent.id);
                    const isDefault = defaultRunAgentNames.includes(
                      row.origin === 'inline' ? row.agent.id : row.ref || row.agent.id
                    );
                    const viewAgentKey = row.ref ?? row.agent.id;
                    const expanded = Boolean(expandedViewAgentIds[viewAgentKey]);
                    return (
                      <div
                        key={`agent-view-${index}-${row.ref ?? row.agent.id}`}
                        className="rounded-md border p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground">{index + 1}.</span>
                            <div className="truncate font-medium text-sm">{name}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isDefault && (
                              <Badge
                                variant="outline"
                                className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50"
                              >
                                Default
                              </Badge>
                            )}
                            <Badge variant={row.origin === 'inline' ? 'secondary' : 'outline'}>
                              {row.origin === 'inline' ? 'Inline' : 'Referenced'}
                            </Badge>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              onClick={() =>
                                setExpandedViewAgentIds((prev) => ({
                                  ...prev,
                                  // eslint-disable-next-line no-extra-boolean-cast
                                  [viewAgentKey]: !Boolean(prev[viewAgentKey])
                                }))
                              }
                              aria-label={
                                expanded ? 'Collapse agent details' : 'Expand agent details'
                              }
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${
                                  expanded ? 'rotate-180' : ''
                                }`}
                              />
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
                              temperature: {resolveAgentTemperature(row.agent.temperature)}
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
                  <Select
                    value={selectedLibraryScenarioId}
                    onValueChange={setSelectedLibraryScenarioId}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select scenario from library" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...libScenarios]
                        .sort((a, b) =>
                          safeText(a.name, a.id).localeCompare(safeText(b.name, b.id))
                        )
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {safeText(item.name, item.id)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!selectedLibraryScenarioId}
                      onClick={addScenarioReference}
                    >
                      Add Ref
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!selectedLibraryScenarioId}
                      onClick={importScenarioFromLibrary}
                    >
                      Import Inline
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={addInlineScenarioEntry}
                    >
                      Add scenario
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {scenarioEntries.map((entry, index) => {
                    const referenceScenario =
                      entry.kind === 'referenced' ? findLibraryScenarioByRef(entry.ref) : null;
                    const rowTitle =
                      entry.kind === 'inline'
                        ? safeText(entry.scenario.name, entry.scenario.id)
                        : safeText(referenceScenario?.name, entry.ref);
                    const hasMissingInlineName =
                      entry.kind === 'inline' && safeText(entry.scenario.name).length === 0;
                    const isMissingRef =
                      entry.kind === 'referenced' && missingScenarioRefSet.has(entry.ref);
                    const hasOverrides =
                      entry.kind === 'referenced' && Array.isArray(entry.mcpServers);
                    const scenarioExpanded =
                      entry.kind === 'inline' &&
                      Boolean(expandedInlineScenarioIds[entry.scenario.id]);
                    return (
                      <div
                        key={`scenario-entry-${index}-${
                          entry.kind === 'inline' ? entry.scenario.id : entry.ref
                        }`}
                        className="rounded-md border text-sm"
                      >
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={() => moveScenarioEntry(index, -1)}
                                disabled={index === 0}
                                aria-label="Move scenario up"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={() => moveScenarioEntry(index, 1)}
                                disabled={index === scenarioEntries.length - 1}
                                aria-label="Move scenario down"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className="text-xs text-muted-foreground">{index + 1}.</span>
                            <span className="truncate font-medium">{rowTitle}</span>
                            <Badge variant={entry.kind === 'inline' ? 'secondary' : 'outline'}>
                              {entry.kind === 'inline' ? 'Inline' : 'Referenced'}
                            </Badge>
                            {hasOverrides && <Badge variant="secondary">Override</Badge>}
                            {hasMissingInlineName && (
                              <Badge variant="destructive">Name required</Badge>
                            )}
                            {isMissingRef && <Badge variant="destructive">Missing</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            {entry.kind === 'inline' && (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() =>
                                  setExpandedInlineScenarioIds((prev) => ({
                                    ...prev,
                                    // eslint-disable-next-line no-extra-boolean-cast
                                    [entry.scenario.id]: !Boolean(prev[entry.scenario.id])
                                  }))
                                }
                                aria-label={
                                  scenarioExpanded
                                    ? 'Collapse scenario details'
                                    : 'Expand scenario details'
                                }
                              >
                                <ChevronDown
                                  className={`h-3.5 w-3.5 transition-transform ${
                                    scenarioExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </Button>
                            )}
                            {entry.kind === 'referenced' && (
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
                              </>
                            )}
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeScenarioEntryAt(index)}
                              aria-label="Remove scenario entry"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {entry.kind === 'inline' && scenarioExpanded && (
                          <div className="border-t px-3 py-3">
                            <ScenarioForm
                              scenarios={[entry.scenario]}
                              scenarioOrigins={['inline']}
                              agents={[...config.agents, ...referencedAgents]}
                              servers={[...(config.servers ?? []), ...referencedServers]}
                              configId={config.id}
                              configPath={config.sourcePath}
                              defaultAssistantAgentName={
                                config.runDefaults?.selectedAgentNames?.[0]
                              }
                              onChange={(scenarios) => {
                                const nextScenario = scenarios[0];
                                if (!nextScenario) return;
                                const nextEntries = [...scenarioEntries];
                                nextEntries[index] = { kind: 'inline', scenario: nextScenario };
                                setScenarioEntries(nextEntries);
                              }}
                              readOnly={false}
                              allowAdd={false}
                              allowStructureEdits={false}
                            />
                          </div>
                        )}
                        {entry.kind === 'referenced' && !isMissingRef && (
                          <div className="border-t px-3 py-3 space-y-2">
                            <div className="text-xs text-muted-foreground">
                              Optional MCP server override for this referenced scenario.
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {allServerOptions.map((server) => {
                                const selected = (entry.mcpServers ?? []).some(
                                  (serverEntry) =>
                                    serverEntry.kind === 'referenced' &&
                                    serverEntry.ref === server.id
                                );
                                return (
                                  <Button
                                    key={`${entry.ref}-override-server-${server.id}`}
                                    type="button"
                                    size="sm"
                                    variant={selected ? 'default' : 'outline'}
                                    className={`h-7 text-xs ${selected ? '' : 'opacity-70'}`}
                                    onClick={() => {
                                      const current = (entry.mcpServers ?? [])
                                        .filter(
                                          (
                                            serverEntry
                                          ): serverEntry is Extract<
                                            ServerEntry,
                                            { kind: 'referenced' }
                                          > => serverEntry.kind === 'referenced'
                                        )
                                        .map((serverEntry) => serverEntry.ref);
                                      const next = current.includes(server.id)
                                        ? current.filter((id) => id !== server.id)
                                        : [...current, server.id];
                                      updateReferencedScenarioServers(index, next);
                                    }}
                                  >
                                    {safeText(server.name, server.id)}
                                  </Button>
                                );
                              })}
                            </div>
                            {hasOverrides && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => resetReferencedScenarioServersOverride(index)}
                              >
                                Reset override
                              </Button>
                            )}
                          </div>
                        )}
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
                    Missing scenario refs: {missingScenarioRefs.join(', ')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {readOnly ? (
            <Card>
              <CardContent className="pt-4">
                <ScenarioForm
                  scenarios={scenarioViewRows.map((row) => row.scenario)}
                  scenarioOrigins={scenarioViewRows.map((row) => row.origin)}
                  scenarioOverrides={scenarioViewRows.map((row) => row.hasMcpServerOverride)}
                  agents={scenarioViewAgents}
                  servers={scenarioViewServers}
                  configId={config.id}
                  configPath={config.sourcePath}
                  defaultAssistantAgentName={config.runDefaults?.selectedAgentNames?.[0]}
                  testCaseReturnToPath={testCaseReturnToPath}
                  onChange={() => {}}
                  readOnly
                />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConfigEditor;
