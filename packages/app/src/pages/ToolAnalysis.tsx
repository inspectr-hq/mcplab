import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  defaultMcpCatalogView,
  McpCatalogPanel,
  type McpCatalogView
} from '@/components/tool-analysis/McpCatalogPanel';
import { McpCatalogToolbar } from '@/components/tool-analysis/McpCatalogToolbar';
import type { LoadMcpPreview } from '@/components/tool-analysis/McpPreview';
import { McpSkillsPanel } from '@/components/tool-analysis/McpSkillsPanel';
import { McpToolList } from '@/components/tool-analysis/McpToolList';
import { McpCatalogStatusBadges } from '@/components/tool-analysis/McpCatalogCheckResults';
import { ToolAnalysisReportView } from '@/components/tool-analysis/ToolAnalysisReportView';
import { mcpHealthCoverage } from '@/lib/tool-analysis-utils';
import { toolAnalysisReportToMarkdown } from '@/lib/tool-analysis-markdown';
import { useDataSource } from '@/contexts/useDataSource';
import { useLibraries } from '@/contexts/useLibraries';
import { toast } from '@/hooks/use-toast';
import { copyTextToClipboard } from '@/lib/copy-text-to-clipboard';
import { discoverMcpCatalogSkills } from '@/lib/data-sources/types';
import type {
  RunJobEvent,
  ToolAnalysisDiscoverResponse,
  ToolAnalysisReport
} from '@/lib/data-sources/types';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import { CircleHelp, Download, Loader2, RefreshCw, Microscope } from 'lucide-react';
import { buildToolInfoExport, buildToolInfoFilename } from '@/lib/tool-analysis-export';
import { selectedToolContextTokens } from '@/lib/tool-analysis-token-estimates';
import { cn } from '@/lib/utils';
import type { SchemaViewMode } from '@/components/tool-analysis/ToolSchemaPreview';

import { parseAnalysisProgressFromEvents } from '@/lib/tool-analysis-progress';

const TOOL_ANALYSIS_ACTIVE_JOB_KEY = 'mcplab.toolAnalysis.activeJobId';
const CATALOG_TABS = [
  { value: 'tools', label: 'Tools' },
  { value: 'skills', label: 'Skills' },
  { value: 'resources', label: 'Resources' },
  { value: 'prompts', label: 'Prompts' }
] as const;

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ModeInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          onClick={(e) => e.preventDefault()}
          aria-label={text}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function formatToolDiscoveryWarning(serverName: string, warning: string): string {
  const lower = warning.toLowerCase();
  if (lower.includes('failed to load tools') || lower.includes('failed to connect to mcp server')) {
    return `Could not load tools from '${serverName}'. Check that the MCP server is running and reachable, then try Discover again.`;
  }
  return warning;
}

const ToolAnalysisPage = () => {
  const buildExportFilename = (ext: 'json' | 'md') => `tool-analysis-${Date.now()}.${ext}`;
  const { source } = useDataSource();
  const { servers, agents, loading: librariesLoading, reload: reloadLibraries } = useLibraries();

  const [settingsAssistantAgentName, setSettingsAssistantAgentName] = useState('');
  const [selectedServerNames, setSelectedServerNames] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<ToolAnalysisDiscoverResponse['servers']>([]);
  const [selectedToolsByServer, setSelectedToolsByServer] = useState<Record<string, string[]>>({});
  const [catalogViews, setCatalogViews] = useState<
    Partial<Record<'resources' | 'prompts', McpCatalogView>>
  >({});
  const [catalogTab, setCatalogTab] = useState('tools');
  const [toolQuery, setToolQuery] = useState('');
  const [catalogChecks, setCatalogChecks] = useState(true);
  const [metadataReview, setMetadataReview] = useState(false);
  const [deeperAnalysis, setDeeperAnalysis] = useState(false);
  const [maxParallelTools, setMaxParallelTools] = useState(2);
  const [sampleCallsPerTool, setSampleCallsPerTool] = useState(1);
  const [toolCallTimeoutMs, setToolCallTimeoutMs] = useState(10000);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunJobEvent[]>([]);
  const [report, setReport] = useState<ToolAnalysisReport | null>(null);
  const [savedReportId, setSavedReportId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewStep, setViewStep] = useState<'configure' | 'run' | 'report'>('configure');
  const [schemaMode, setSchemaMode] = useState<SchemaViewMode>('explorer');
  const [runState, setRunState] = useState<'idle' | 'running' | 'stopped' | 'error'>('idle');
  const [authInProgress, setAuthInProgress] = useState(false);
  const cleanupRef = useRef<null | (() => void)>(null);
  const discoveryRequest = useRef<AbortController | null>(null);
  const eventsContainerRef = useRef<HTMLDivElement | null>(null);

  const effectiveAssistantAgentName = settingsAssistantAgentName || agents[0]?.name || '';
  const analysisProgress = useMemo(() => parseAnalysisProgressFromEvents(events), [events]);

  useEffect(() => {
    let active = true;
    source
      .getWorkspaceSettings()
      .then((settings) => {
        if (!active || !settings) return;
        setSettingsAssistantAgentName(settings.assistantAgentName ?? '');
      })
      .catch(() => {
        if (active) setSettingsAssistantAgentName('');
      });
    return () => {
      active = false;
    };
  }, [source]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const el = eventsContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [events.length]);

  const clearActiveToolAnalysisJob = useCallback(() => {
    try {
      sessionStorage.removeItem(TOOL_ANALYSIS_ACTIVE_JOB_KEY);
    } catch {
      // ignore sessionStorage access issues
    }
  }, []);

  const setActiveToolAnalysisJob = (jobId: string) => {
    try {
      sessionStorage.setItem(TOOL_ANALYSIS_ACTIVE_JOB_KEY, jobId);
    } catch {
      // ignore sessionStorage access issues
    }
  };

  const attachToJob = useCallback(
    (jobId: string) => {
      cleanupRef.current?.();
      cleanupRef.current = source.subscribeToolAnalysisJob(jobId, (event) => {
        setEvents((prev) => [...prev, event]);
        if (event.type === 'completed') {
          void source
            .getToolAnalysisResult(jobId)
            .then((result) => {
              setReport(result.report);
              setSavedReportId(result.savedReportId ?? null);
            })
            .catch((error: unknown) =>
              toast({
                title: 'Could not load analysis report',
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive'
              })
            )
            .finally(() => {
              clearActiveToolAnalysisJob();
              setActiveJobId(null);
              setSubmitting(false);
              setRunState('idle');
              setViewStep('run');
            });
        } else if (event.type === 'error') {
          const message = String(event.payload?.message ?? '');
          clearActiveToolAnalysisJob();
          setRunState(message.toLowerCase().includes('abort') ? 'stopped' : 'error');
          setActiveJobId(null);
          setSubmitting(false);
        }
      });
    },
    [source, clearActiveToolAnalysisJob]
  );

  useEffect(() => {
    if (activeJobId || report) return;
    let storedJobId = '';
    try {
      storedJobId = sessionStorage.getItem(TOOL_ANALYSIS_ACTIVE_JOB_KEY) ?? '';
    } catch {
      storedJobId = '';
    }
    if (!storedJobId) return;

    setViewStep('run');
    setRunState('running');
    setSubmitting(true);
    setActiveJobId(storedJobId);
    setEvents([]);
    attachToJob(storedJobId);
    return () => {
      // no-op; cleanup handled by standard subscription cleanup
    };
  }, [attachToJob, activeJobId, report]);

  const authorizeSelectedServer = async (serverName: string, signal: AbortSignal) => {
    const server = servers.find((entry) => entry.id === serverName);
    if (server?.authType !== 'oauth2') return;
    await ensureOAuthForServers({
      serverNames: [serverName],
      source,
      signal,
      onServerAuthStart: () => {
        toast({
          title: `OAuth login required for ${serverName}`,
          description: 'Complete login in the opened browser tab to continue.'
        });
      }
    });
  };

  const previewMcp: LoadMcpPreview = async (request, signal) => {
    await authorizeSelectedServer(request.serverName, signal);
    signal.throwIfAborted();
    return source.previewMcpForAnalysis(request, signal);
  };

  const discoverTools = async (includeToolResources = false) => {
    const [serverName] = selectedServerNames;
    if (!serverName) return;
    discoveryRequest.current?.abort();
    const controller = new AbortController();
    discoveryRequest.current = controller;
    const { signal } = controller;
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      await authorizeSelectedServer(serverName, signal);
      if (signal.aborted) return;
      const response = await source.discoverToolsForAnalysis(
        {
          serverNames: [serverName],
          includeCatalog: true,
          ...(includeToolResources ? { includeToolResources: true } : {})
        },
        signal
      );
      if (signal.aborted) return;
      setDiscovered(response.servers);
      setSelectedToolsByServer((prev) => {
        const next: Record<string, string[]> = {};
        for (const server of response.servers) {
          const prevSelected = prev[server.serverName] ?? [];
          const availableNames = server.tools.map((tool) => tool.name);
          const retained = prevSelected.filter((name) => availableNames.includes(name));
          const keepSelection =
            retained.length > 0 || (includeToolResources && Object.hasOwn(prev, server.serverName));
          next[server.serverName] = keepSelection ? retained : availableNames;
        }
        return next;
      });
    } catch (error: unknown) {
      if (!signal.aborted) {
        setDiscoveryError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (!signal.aborted) setDiscovering(false);
    }
  };

  useEffect(() => {
    void discoverTools();
    return () => discoveryRequest.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerNames.join('|')]);

  const totalSelectedTools = useMemo(
    () => Object.values(selectedToolsByServer).reduce((sum, list) => sum + list.length, 0),
    [selectedToolsByServer]
  );
  const selectedToolTokens = useMemo(
    () => selectedToolContextTokens(discovered, selectedToolsByServer),
    [discovered, selectedToolsByServer]
  );
  const selectedServerLabel = selectedServerNames[0] ?? '';
  const serverDiscovery = discovered.find((entry) => entry.serverName === selectedServerLabel);
  const serverDisplayName =
    servers.find((server) => server.id === selectedServerLabel)?.name || selectedServerLabel;
  const catalog = serverDiscovery?.catalog;
  const skills = useMemo(() => (catalog ? discoverMcpCatalogSkills(catalog) : []), [catalog]);
  const hasSkills = skills.length > 0;
  const activeCatalogTab = catalogTab === 'skills' && !hasSkills ? 'resources' : catalogTab;
  const toolDiscoveryWarnings = catalog ? (serverDiscovery?.warnings ?? []) : [];
  const toolQueryText = toolQuery.trim().toLowerCase();
  const visibleTools = useMemo(() => {
    const tools = serverDiscovery?.tools ?? [];
    if (!toolQueryText) return tools;
    return tools.filter((tool) =>
      [tool.name, tool.title, tool.description].some((value) =>
        value?.toLowerCase().includes(toolQueryText)
      )
    );
  }, [serverDiscovery, toolQueryText]);
  const selectedTools = new Set(selectedToolsByServer[selectedServerLabel]);
  const hasTools = Boolean(serverDiscovery?.tools.length);
  const allVisibleSelected = visibleTools.every((tool) => selectedTools.has(tool.name));
  const discoveryBusy = discovering || authInProgress;
  const needsTools = metadataReview || deeperAnalysis;
  const canStartAnalysis =
    Boolean(selectedServerLabel) &&
    (catalogChecks || needsTools) &&
    (!needsTools || (totalSelectedTools > 0 && Boolean(effectiveAssistantAgentName))) &&
    !discoveryBusy &&
    !submitting &&
    !activeJobId;
  let catalogMessage = 'Select a server to discover its capabilities.';
  if (selectedServerLabel) {
    catalogMessage = discovering ? 'Loading server capabilities…' : 'No catalog available.';
  }
  let toolsMessage = catalogMessage;
  if (serverDiscovery) toolsMessage = hasTools ? 'No tools match your search.' : 'No tools listed.';

  const startAnalysis = async () => {
    if (!catalogChecks && !needsTools) {
      toast({ title: 'Select at least one mode', variant: 'destructive' });
      return;
    }
    if (selectedServerNames.length !== 1) {
      toast({ title: 'Select exactly one server', variant: 'destructive' });
      return;
    }
    if (needsTools && totalSelectedTools === 0) {
      toast({ title: 'Select at least one tool', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    setEvents([]);
    setReport(null);
    setSavedReportId(null);
    setViewStep('run');
    setRunState('running');
    try {
      const selectedServerName = selectedServerNames[0];
      const selectedServer = servers.find((server) => server.id === selectedServerName);
      if (selectedServer?.authType === 'oauth2') {
        setAuthInProgress(true);
        await ensureOAuthForServers({
          serverNames: [selectedServerName],
          source,
          onServerAuthStart: (serverName) => {
            toast({
              title: `OAuth login required for ${serverName}`,
              description:
                'Complete login in the opened browser tab. Analysis will continue automatically.'
            });
          }
        });
      }
      const { jobId } = await source.startToolAnalysis({
        serverNames: selectedServerNames,
        selectedToolsByServer,
        maxParallelTools,
        modes: { catalogChecks, metadataReview, deeperAnalysis },
        deeperAnalysisOptions: {
          autoRunPolicy: 'read_only_allowlist',
          sampleCallsPerTool,
          toolCallTimeoutMs
        }
      });
      setActiveJobId(jobId);
      setActiveToolAnalysisJob(jobId);
      attachToJob(jobId);
    } catch (error: unknown) {
      setSubmitting(false);
      setRunState('error');
      setViewStep('run');
      toast({
        title: 'Could not start tool analysis',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setAuthInProgress(false);
    }
  };

  const downloadToolInfo = () => {
    const selectedServerName = selectedServerNames[0];
    const discoveredServer = discovered.find((server) => server.serverName === selectedServerName);
    if (!selectedServerName || !discoveredServer) {
      toast({
        title: 'No discovered tool info available',
        description: 'Select a server and discover tools before downloading tool info.',
        variant: 'destructive'
      });
      return;
    }

    const exportData = buildToolInfoExport({
      serverName: discoveredServer.serverName,
      tools: discoveredServer.tools,
      selectedToolNames: selectedToolsByServer[discoveredServer.serverName]
    });
    downloadTextFile(
      buildToolInfoFilename(discoveredServer.serverName, discoveredServer.mcpServerVersion),
      `${JSON.stringify(exportData, null, 2)}\n`,
      'application/json'
    );
  };

  const copyToolList = () => {
    const tools = visibleTools.map(({ name, title, description }) => ({
      name,
      title,
      description
    }));
    void copyTextToClipboard(
      'Tool list',
      `${JSON.stringify({ server: selectedServerLabel, tools }, null, 2)}\n`
    );
  };

  const stopAnalysis = async () => {
    if (!activeJobId) return;
    const jobId = activeJobId;
    try {
      const response = await source.stopToolAnalysis(jobId);
      if (response.status === 'completed') {
        cleanupRef.current?.();
        cleanupRef.current = null;
        const result = await source.getToolAnalysisResult(jobId);
        setReport(result.report);
        setSavedReportId(result.savedReportId ?? null);
        clearActiveToolAnalysisJob();
        setActiveJobId(null);
        setSubmitting(false);
        setRunState('idle');
        setViewStep('run');
        toast({ title: 'Analysis already finished', description: 'Showing the result overview.' });
        return;
      }
      if (response.status === 'stopped') {
        cleanupRef.current?.();
        cleanupRef.current = null;
        clearActiveToolAnalysisJob();
        setActiveJobId(null);
        setSubmitting(false);
        setRunState('stopped');
        toast({ title: 'Analysis stopped' });
        return;
      }
      if (response.status === 'error') {
        cleanupRef.current?.();
        cleanupRef.current = null;
        clearActiveToolAnalysisJob();
        setActiveJobId(null);
        setSubmitting(false);
        setRunState('error');
        toast({
          title: 'Analysis already ended with an error',
          description: 'Review the progress log and return to Configure Analysis.'
        });
        return;
      }
      toast({ title: 'Stopping analysis...' });
    } catch (error: unknown) {
      toast({
        title: 'Could not stop analysis',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    }
  };

  const backToConfigure = () => {
    setViewStep('configure');
    setRunState('idle');
    setActiveJobId(null);
  };

  const toggleServer = (serverName: string, checked: boolean) => {
    discoveryRequest.current?.abort();
    setDiscovered([]);
    setSelectedToolsByServer({});
    setCatalogViews({});
    setCatalogTab((current) => (current === 'skills' ? 'resources' : current));
    setDiscoveryError(null);
    setDiscovering(checked);
    setSelectedServerNames((prev) =>
      checked ? [serverName] : prev.filter((name) => name !== serverName)
    );
  };

  const toggleTool = (serverName: string, toolName: string, checked: boolean) => {
    setSelectedToolsByServer((prev) => {
      const current = new Set(prev[serverName] ?? []);
      if (checked) current.add(toolName);
      else current.delete(toolName);
      return { ...prev, [serverName]: Array.from(current) };
    });
  };

  const selectVisibleTools = () => {
    setSelectedToolsByServer((prev) => ({
      ...prev,
      [selectedServerLabel]: [
        ...new Set([...(prev[selectedServerLabel] ?? []), ...visibleTools.map((tool) => tool.name)])
      ]
    }));
  };

  const clearToolSelection = () => {
    setSelectedToolsByServer((prev) => ({ ...prev, [selectedServerLabel]: [] }));
  };

  const canOpenConfigureStep = true;
  const canOpenRunStep =
    activeJobId !== null || events.length > 0 || runState === 'stopped' || runState === 'error';
  const canOpenReportStep = Boolean(report);
  const serverHealth = report?.servers[0]?.health;

  const openStep = (step: 'configure' | 'run' | 'report') => {
    if (step === 'configure' && canOpenConfigureStep) {
      setViewStep('configure');
      return;
    }
    if (step === 'run' && canOpenRunStep) {
      setViewStep('run');
      return;
    }
    if (step === 'report' && canOpenReportStep) {
      setViewStep('report');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <Microscope className="h-6 w-6" />
            Analyze MCP
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse an MCP server’s tools, resources, prompts, and any detected skills. Analyze
            selected tools for schema quality and agent readiness.
          </p>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <button
            type="button"
            onClick={() => openStep('configure')}
            className="rounded-full"
            aria-label="Open Configure Analysis"
          >
            <Badge
              variant={viewStep === 'configure' ? 'default' : 'outline'}
              className="cursor-pointer"
            >
              Configure Analysis
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => openStep('run')}
            disabled={!canOpenRunStep}
            className="rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Open Run Analysis"
          >
            <Badge
              variant={viewStep === 'run' ? 'default' : 'outline'}
              className={canOpenRunStep ? 'cursor-pointer' : 'cursor-not-allowed'}
            >
              Run Analysis
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => openStep('report')}
            disabled={!canOpenReportStep}
            className="rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Open Report"
          >
            <Badge
              variant={viewStep === 'report' ? 'default' : 'outline'}
              className={canOpenReportStep ? 'cursor-pointer' : 'cursor-not-allowed'}
            >
              Report
            </Badge>
          </button>
        </div>
      </div>

      {viewStep === 'configure' && (
        <Card>
          <CardHeader className="p-3 sm:p-6">
            <CardTitle className="text-base">Configure analysis</CardTitle>
            <CardDescription>
              Select an MCP server. Catalog checks inspect its advertised definitions. Select tools
              to include in assistant review or sample calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-3 pt-0 sm:p-6 sm:pt-0">
            {needsTools && !effectiveAssistantAgentName && (
              <Alert>
                <AlertTitle>No assistant agent available</AlertTitle>
                <AlertDescription>
                  Add a library agent in{' '}
                  <Link to="/libraries/agents" className="underline">
                    Agents
                  </Link>{' '}
                  and optionally set the default Assistant Agent in{' '}
                  <Link to="/settings" className="underline">
                    Settings
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Servers</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void reloadLibraries()}
                  disabled={librariesLoading || authInProgress}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh Servers
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-2">
                {servers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No library servers configured.</p>
                ) : (
                  servers.map((server) => {
                    const checked = selectedServerNames.includes(server.id);
                    return (
                      <label
                        key={server.id}
                        className="flex items-start gap-2 rounded-md border p-2 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleServer(server.id, Boolean(value))}
                        />
                        <div className="min-w-0">
                          <div className="wrap-anywhere font-medium">
                            {server.name || server.id}
                          </div>
                          {server.url && (
                            <div className="truncate text-xs text-muted-foreground">
                              {server.url}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Select exactly one MCP server for analysis.
              </p>
            </div>

            <Tabs
              value={activeCatalogTab}
              onValueChange={setCatalogTab}
              className="min-w-0 rounded-lg border bg-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
                <h2 className="min-w-0 wrap-anywhere text-sm font-semibold">
                  {serverDisplayName || 'Server catalog'}
                </h2>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void discoverTools(catalog?.toolResources?.status === 'ready')}
                  disabled={discoveryBusy || !selectedServerLabel}
                  className="h-11 bg-transparent hover:bg-muted hover:text-foreground sm:h-8"
                >
                  {discovering ? (
                    <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  Refresh catalog
                </Button>
              </div>
              <TabsList
                aria-label="MCP server capabilities"
                className={cn(
                  'grid h-auto w-full gap-0 rounded-none border-b bg-transparent p-0 px-2 sm:flex sm:justify-start sm:px-4',
                  hasSkills ? 'grid-cols-2 min-[360px]:grid-cols-4' : 'grid-cols-3'
                )}
              >
                {CATALOG_TABS.filter(({ value }) => hasSkills || value !== 'skills').map(
                  ({ value, label }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="min-h-11 cursor-pointer rounded-none border-b-2 border-transparent bg-transparent px-1 py-2 transition-none hover:text-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4"
                    >
                      {label}
                    </TabsTrigger>
                  )
                )}
              </TabsList>
              {discoveryError && (
                <p
                  role="alert"
                  className="px-3 pt-3 wrap-anywhere text-sm text-destructive sm:px-4"
                >
                  {discoveryError}
                </p>
              )}
              {!catalog &&
                serverDiscovery?.warnings.map((warning) => (
                  <p
                    key={warning}
                    role="alert"
                    className="px-3 pt-3 wrap-anywhere text-sm text-muted-foreground sm:px-4"
                  >
                    {warning}
                  </p>
                ))}

              <TabsContent
                value="tools"
                className="mt-0 focus-visible:ring-inset focus-visible:ring-offset-0"
              >
                {hasTools && (
                  <McpCatalogToolbar
                    item="tool"
                    query={toolQuery}
                    onQueryChange={setToolQuery}
                    selectedCount={totalSelectedTools}
                    count={serverDiscovery?.tools.length ?? 0}
                    selectedTokens={selectedToolTokens}
                    totalTokens={serverDiscovery?.tokenEstimate?.total}
                    allVisibleSelected={allVisibleSelected}
                    hasVisibleItems={visibleTools.length > 0}
                    busy={discoveryBusy}
                    onSelectVisible={selectVisibleTools}
                    onClear={clearToolSelection}
                    onCopy={copyToolList}
                    onDownload={downloadToolInfo}
                  />
                )}
                {toolDiscoveryWarnings.map((warning) => (
                  <p
                    key={warning}
                    role="alert"
                    className="px-3 py-3 wrap-anywhere text-sm text-muted-foreground sm:px-4"
                  >
                    {formatToolDiscoveryWarning(selectedServerLabel, warning)}
                  </p>
                ))}
                {visibleTools.length > 0 && (
                  <McpToolList
                    tools={visibleTools}
                    selected={selectedTools}
                    tokenEstimate={serverDiscovery?.tokenEstimate}
                    schemaMode={schemaMode}
                    onSchemaModeChange={setSchemaMode}
                    onToggle={(name, checked) => toggleTool(selectedServerLabel, name, checked)}
                  />
                )}
                {visibleTools.length === 0 && toolDiscoveryWarnings.length === 0 && (
                  <p role="status" className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
                    {toolsMessage}
                  </p>
                )}
              </TabsContent>
              {hasSkills && catalog && (
                <TabsContent
                  value="skills"
                  className="mt-0 focus-visible:ring-inset focus-visible:ring-offset-0"
                >
                  <McpSkillsPanel
                    key={selectedServerLabel}
                    skills={skills}
                    catalog={catalog}
                    serverName={selectedServerLabel}
                    loadPreview={previewMcp}
                  />
                </TabsContent>
              )}
              {(['resources', 'prompts'] as const).map((kind) => (
                <TabsContent
                  key={kind}
                  value={kind}
                  className="mt-0 focus-visible:ring-inset focus-visible:ring-offset-0"
                >
                  {catalog ? (
                    <McpCatalogPanel
                      key={selectedServerLabel}
                      kind={kind}
                      catalog={catalog}
                      serverName={selectedServerLabel}
                      serverVersion={serverDiscovery?.mcpServerVersion}
                      loadPreview={previewMcp}
                      listViaTool={() => void discoverTools(true)}
                      discovering={discoveryBusy}
                      view={catalogViews[kind] ?? defaultMcpCatalogView}
                      updateView={(update) =>
                        setCatalogViews((previous) => ({
                          ...previous,
                          [kind]: update(previous[kind] ?? defaultMcpCatalogView)
                        }))
                      }
                      copyText={copyTextToClipboard}
                      downloadFile={downloadTextFile}
                    />
                  ) : (
                    <p role="status" className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
                      {catalogMessage}
                    </p>
                  )}
                </TabsContent>
              ))}
            </Tabs>

            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">Analysis modes</div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={catalogChecks}
                  onCheckedChange={(value) => setCatalogChecks(Boolean(value))}
                />
                <span className="inline-flex items-center gap-1.5">
                  Catalog checks
                  <ModeInfo text="Checks the entire advertised catalog without an assistant or tool calls." />
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={metadataReview}
                  onCheckedChange={(v) => setMetadataReview(Boolean(v))}
                />
                <span className="inline-flex items-center gap-1.5">
                  Metadata / schema review
                  <ModeInfo text="An assistant reviews the selected tool names, descriptions, and schemas." />
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={deeperAnalysis}
                  onCheckedChange={(v) => setDeeperAnalysis(Boolean(v))}
                />
                <span className="inline-flex items-center gap-1.5">
                  Deeper analysis
                  <ModeInfo text="Runs sample calls for tools explicitly marked read-only when their metadata supports that classification." />
                </span>
              </label>
              {needsTools && (
                <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Max parallel tools</Label>
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      value={maxParallelTools}
                      onChange={(e) =>
                        setMaxParallelTools(Math.max(1, Math.min(8, Number(e.target.value) || 2)))
                      }
                      className="h-8"
                    />
                  </div>
                  {deeperAnalysis ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Safety profile</Label>
                        <div className="text-sm">Explicitly read-only tools</div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Sample calls per tool</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={sampleCallsPerTool}
                          onChange={(e) =>
                            setSampleCallsPerTool(
                              Math.max(1, Math.min(5, Number(e.target.value) || 1))
                            )
                          }
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Tool call timeout (ms)</Label>
                        <Input
                          type="number"
                          min={1000}
                          max={60000}
                          step={500}
                          value={toolCallTimeoutMs}
                          onChange={(e) =>
                            setToolCallTimeoutMs(
                              Math.max(1000, Math.min(60000, Number(e.target.value) || 10000))
                            )
                          }
                          className="h-8"
                        />
                      </div>
                      <div className="md:col-span-3 text-xs text-amber-700">
                        Deeper analysis may execute read-only MCP tools automatically.
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void startAnalysis()}
                disabled={!canStartAnalysis}
              >
                {(submitting || !!activeJobId) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run analysis
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {viewStep === 'run' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>Progress</span>
                </CardTitle>
                <CardDescription>
                  {activeJobId
                    ? 'Live tool-analysis job events:'
                    : report
                      ? 'Analysis finished. Review the summary below or open the saved report details.'
                      : runState === 'stopped'
                        ? 'Analysis was stopped. You can return to Configure Analysis.'
                        : runState === 'error'
                          ? 'Analysis ended with an error. Review the log and go back to Configure Analysis.'
                          : 'Analysis finished.'}
                </CardDescription>
              </div>
              {activeJobId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void stopAnalysis()}
                >
                  Stop Analysis
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={backToConfigure}>
                  Back to Configure Analysis
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeJobId && (
              <div className="inline-flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analysis is still running...
              </div>
            )}
            {(analysisProgress.totalTools > 0 || activeJobId) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {analysisProgress.totalTools > 0
                      ? `${analysisProgress.finishedTools}/${analysisProgress.totalTools} tools finished`
                      : 'Preparing analysis...'}
                  </span>
                  <span>
                    {analysisProgress.totalTools > 0 ? `${analysisProgress.percent}%` : '0%'}
                  </span>
                </div>
                <Progress
                  value={analysisProgress.totalTools > 0 ? analysisProgress.percent : 0}
                  className="h-2"
                />
              </div>
            )}
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {activeJobId ? 'Starting analysis...' : 'No progress events captured.'}
              </p>
            ) : (
              <div
                ref={eventsContainerRef}
                className="max-h-64 space-y-1 overflow-auto rounded border bg-muted/20 p-2"
              >
                {events.map((event, index) => (
                  <div key={`${event.ts}-${index}`} className="text-xs">
                    <span className="mr-2 font-mono text-muted-foreground">
                      {new Date(event.ts).toLocaleTimeString()}
                    </span>
                    <Badge variant="outline" className="mr-2 text-[10px]">
                      {event.type}
                    </Badge>
                    <span className="break-all">
                      {typeof event.payload.message === 'string'
                        ? event.payload.message
                        : JSON.stringify(event.payload)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!activeJobId && report && (
              <Card className="mt-2 border-green-200 bg-green-50/40 dark:border-green-900/40 dark:bg-green-950/10">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Result overview</div>
                      {serverHealth && (
                        <p className="text-sm font-medium">
                          {serverHealth.score === null
                            ? 'Unscored'
                            : `Health score ${serverHealth.score}/100`}
                          {' · '}
                          {mcpHealthCoverage(serverHealth)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {report.summary.catalogChecks && (
                          <>{report.summary.catalogChecks.itemsChecked} catalog entries checked. </>
                        )}
                        {(report.modes.metadataReview || report.modes.deeperAnalysis) && (
                          <>
                            {report.summary.toolsAnalyzed} tools analyzed,{' '}
                            {report.summary.toolsSkipped} skipped.
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {savedReportId && (
                        <Button asChild size="sm">
                          <Link to={`/tool-analysis-results/${savedReportId}`}>
                            Open result details
                          </Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link to="/tool-analysis-results">View all results</Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openStep('report')}
                      >
                        View inline report
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {report.summary.issueCounts.critical > 0 && (
                      <Badge className="bg-red-600 text-white hover:bg-red-600">
                        Critical: {report.summary.issueCounts.critical}
                      </Badge>
                    )}
                    {report.summary.issueCounts.high > 0 && (
                      <Badge className="bg-orange-500 text-white hover:bg-orange-500">
                        High: {report.summary.issueCounts.high}
                      </Badge>
                    )}
                    {report.summary.issueCounts.medium > 0 && (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                        Medium: {report.summary.issueCounts.medium}
                      </Badge>
                    )}
                    {report.summary.issueCounts.low > 0 && (
                      <Badge className="bg-blue-500 text-white hover:bg-blue-500">
                        Low: {report.summary.issueCounts.low}
                      </Badge>
                    )}
                    {report.summary.issueCounts.info > 0 && (
                      <Badge variant="outline">Info: {report.summary.issueCounts.info}</Badge>
                    )}
                    {report.summary.catalogChecks && (
                      <McpCatalogStatusBadges summary={report.summary.catalogChecks} />
                    )}
                    {!report.summary.catalogChecks &&
                      Object.values(report.summary.issueCounts).every((n) => n === 0) && (
                        <Badge className="bg-green-600 text-white hover:bg-green-600">
                          No findings
                        </Badge>
                      )}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {viewStep === 'report' && report && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Report</h2>
              <p className="text-sm text-muted-foreground">
                {report.summary.catalogChecks && (
                  <>{report.summary.catalogChecks.itemsChecked} catalog entries checked. </>
                )}
                {(report.modes.metadataReview || report.modes.deeperAnalysis) && (
                  <>{report.summary.toolsAnalyzed} tools analyzed.</>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={backToConfigure}>
                Back to Configure Analysis
              </Button>
              {savedReportId && (
                <>
                  <Button asChild type="button" size="sm" variant="outline">
                    <Link to={`/tool-analysis-results/${savedReportId}`}>Open saved report</Link>
                  </Button>
                  <Button asChild type="button" size="sm" variant="outline">
                    <Link to="/tool-analysis-results">View all reports</Link>
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadTextFile(
                    buildExportFilename('json'),
                    `${JSON.stringify(report, null, 2)}\n`,
                    'application/json'
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Export JSON
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadTextFile(
                    buildExportFilename('md'),
                    toolAnalysisReportToMarkdown(report),
                    'text/markdown'
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Export Markdown
              </Button>
            </div>
          </div>
          <ToolAnalysisReportView
            report={report}
            schemaMode={schemaMode}
            onSchemaModeChange={setSchemaMode}
          />
        </div>
      )}
    </div>
  );
};

export default ToolAnalysisPage;
