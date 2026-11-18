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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { McpCatalogPanel } from '@/components/tool-analysis/McpCatalogPanel';
import type { LoadMcpPreview } from '@/components/tool-analysis/McpPreviewDialog';
import { McpToolList } from '@/components/tool-analysis/McpToolList';
import { ToolAnalysisReportView } from '@/components/tool-analysis/ToolAnalysisReportView';
import { toolAnalysisReportToMarkdown } from '@/lib/tool-analysis-markdown';
import { useDataSource } from '@/contexts/useDataSource';
import { useLibraries } from '@/contexts/useLibraries';
import { toast } from '@/hooks/use-toast';
import type {
  RunJobEvent,
  ToolAnalysisDiscoverResponse,
  ToolAnalysisReport
} from '@/lib/data-sources/types';
import { ensureOAuthForServers } from '@/lib/oauth-session-utils';
import {
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Microscope
} from 'lucide-react';
import { buildToolInfoExport, buildToolInfoFilename } from '@/lib/tool-analysis-export';
import {
  formatToolAnalysisTokenCount,
  selectedToolContextTokens
} from '@/lib/tool-analysis-token-estimates';
import { ToolTokenEstimateBadge } from '@/components/tool-analysis/ToolTokenEstimateBadge';
import type { SchemaViewMode } from '@/components/tool-analysis/ToolSchemaPreview';

import { parseAnalysisProgressFromEvents } from '@/lib/tool-analysis-progress';

const TOOL_ANALYSIS_ACTIVE_JOB_KEY = 'mcplab.toolAnalysis.activeJobId';
const CATALOG_TABS = [
  { value: 'tools', label: 'Tools' },
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

async function copyTextToClipboard(label: string, content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content);
    toast({ title: `${label} copied` });
  } catch (error: unknown) {
    toast({
      title: `Could not copy ${label.toLowerCase()}`,
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    });
  }
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
  const [toolQuery, setToolQuery] = useState('');
  const [metadataReview, setMetadataReview] = useState(true);
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
  let catalogMessage = 'Select a server to discover its capabilities.';
  if (selectedServerLabel) {
    catalogMessage = discovering ? 'Loading server capabilities…' : 'No catalog available.';
  }
  let toolsMessage = catalogMessage;
  if (serverDiscovery) toolsMessage = hasTools ? 'No tools match your search.' : 'No tools listed.';

  const startAnalysis = async () => {
    if (!metadataReview && !deeperAnalysis) {
      toast({ title: 'Select at least one mode', variant: 'destructive' });
      return;
    }
    if (selectedServerNames.length !== 1) {
      toast({ title: 'Select exactly one server', variant: 'destructive' });
      return;
    }
    if (totalSelectedTools === 0) {
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
        modes: { metadataReview, deeperAnalysis },
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
            Browse server capabilities and review tools for schema quality and agent readiness.
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
            <CardTitle className="text-base">Run MCP analysis</CardTitle>
            <CardDescription>
              Select servers and tools, choose metadata review and/or deeper sample-call analysis,
              then run the report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-3 pt-0 sm:p-6 sm:pt-0">
            {!effectiveAssistantAgentName && (
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

            <Tabs defaultValue="tools" className="min-w-0 rounded-lg border bg-background">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Server catalog</h2>
                  {serverDisplayName && (
                    <p className="wrap-anywhere text-sm text-muted-foreground">
                      {serverDisplayName}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void discoverTools()}
                  disabled={discoveryBusy || !selectedServerLabel}
                  className="h-11 hover:bg-muted hover:text-foreground sm:h-8"
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
                className="grid h-auto w-full grid-cols-3 gap-0 rounded-none border-b bg-transparent p-0 px-2 sm:flex sm:justify-start sm:px-4"
              >
                {CATALOG_TABS.map(({ value, label }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="min-h-11 rounded-none border-b-2 border-transparent bg-transparent px-2 py-2 transition-none hover:text-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4"
                  >
                    {label}
                  </TabsTrigger>
                ))}
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
                  <div className="space-y-2 px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="relative w-full sm:w-72">
                        <Label htmlFor="mcp-tool-filter" className="sr-only">
                          Filter tools
                        </Label>
                        <Search
                          aria-hidden="true"
                          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          id="mcp-tool-filter"
                          type="search"
                          className="h-11 ps-9 sm:h-9"
                          placeholder="Filter tools…"
                          value={toolQuery}
                          onChange={(e) => setToolQuery(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-11 sm:h-8"
                          onClick={selectVisibleTools}
                          disabled={allVisibleSelected}
                        >
                          {toolQueryText ? 'Select visible' : 'Select all'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-11 sm:h-8"
                          aria-label="Clear selection"
                          onClick={clearToolSelection}
                          disabled={totalSelectedTools === 0}
                        >
                          Clear
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-11 sm:h-8"
                              disabled={discoveryBusy}
                            >
                              Export
                              <ChevronDown aria-hidden="true" className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={copyToolList}
                              disabled={visibleTools.length === 0}
                            >
                              <Copy aria-hidden="true" className="size-4" />
                              {toolQueryText ? 'Copy visible tool list' : 'Copy tool list'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={downloadToolInfo}>
                              <Download aria-hidden="true" className="size-4" />
                              Download Tool Info
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span role="status">
                        {totalSelectedTools} of {serverDiscovery?.tools.length} selected
                      </span>
                      {selectedToolTokens !== undefined && (
                        <span>
                          ~{formatToolAnalysisTokenCount(selectedToolTokens)} tokens selected
                        </span>
                      )}
                      {serverDiscovery?.tokenEstimate?.total !== selectedToolTokens && (
                        <ToolTokenEstimateBadge
                          total={serverDiscovery?.tokenEstimate?.total}
                          title="Estimated tokens for all discovered tool definitions and their schemas"
                        />
                      )}
                    </div>
                  </div>
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
              {(['resources', 'prompts'] as const).map((kind) => (
                <TabsContent
                  key={kind}
                  value={kind}
                  className="mt-0 px-3 py-4 focus-visible:ring-inset focus-visible:ring-offset-0 sm:px-4"
                >
                  {catalog ? (
                    <McpCatalogPanel
                      key={selectedServerLabel}
                      kind={kind}
                      catalog={catalog}
                      serverName={selectedServerLabel}
                      loadPreview={previewMcp}
                      listViaTool={() => void discoverTools(true)}
                      discovering={discoveryBusy}
                    />
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {catalogMessage}
                    </p>
                  )}
                </TabsContent>
              ))}
            </Tabs>

            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">Analysis Modes</div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={metadataReview}
                  onCheckedChange={(v) => setMetadataReview(Boolean(v))}
                />
                <span className="inline-flex items-center gap-1.5">
                  Metadata / schema review
                  <ModeInfo text="No tool execution. Reviews tool names, descriptions, and schemas only." />
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={deeperAnalysis}
                  onCheckedChange={(v) => setDeeperAnalysis(Boolean(v))}
                />
                <span className="inline-flex items-center gap-1.5">
                  Deeper analysis
                  <ModeInfo text="Runs sample MCP tool calls automatically for read-only tools only (based on the safety allowlist)." />
                </span>
              </label>
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
                      <div className="text-sm">Read-only allowlist only</div>
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
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void startAnalysis()}
                disabled={submitting || authInProgress || !!activeJobId || totalSelectedTools === 0}
              >
                {(submitting || !!activeJobId) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Analyze Tools
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
                      <p className="text-xs text-muted-foreground">
                        {report.summary.toolsAnalyzed} tools analyzed, {report.summary.toolsSkipped}{' '}
                        skipped, across {report.summary.serversAnalyzed} server
                        {report.summary.serversAnalyzed !== 1 ? 's' : ''}.
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
                    {Object.values(report.summary.issueCounts).every((n) => n === 0) && (
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
                {report.summary.toolsAnalyzed} tools analyzed across{' '}
                {report.summary.serversAnalyzed} server
                {report.summary.serversAnalyzed !== 1 ? 's' : ''}.
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
