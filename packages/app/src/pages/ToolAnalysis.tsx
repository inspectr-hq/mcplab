import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolAnalysisReportView, toolAnalysisReportToMarkdown } from "@/components/tool-analysis/ToolAnalysisReportView";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { toast } from "@/hooks/use-toast";
import type { RunJobEvent, ToolAnalysisReport } from "@/lib/data-sources/types";
import { CircleHelp, Download, Loader2, RefreshCw, Search } from "lucide-react";

const TOOL_ANALYSIS_ACTIVE_JOB_KEY = "mcplab.toolAnalysis.activeJobId";

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


function ModeInfo({
  text
}: {
  text: string;
}) {
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
  if (lower.includes("failed to load tools") || lower.includes("failed to connect to mcp server")) {
    return `Could not load tools from '${serverName}'. Check that the MCP server is running and reachable, then try Refresh Servers / Discover Tools again.`;
  }
  return warning;
}


const ToolAnalysisPage = () => {
  const { mode, source } = useDataSource();
  const { servers, agents, loading: librariesLoading, reload: reloadLibraries } = useLibraries();

  const [settingsAssistantAgentName, setSettingsAssistantAgentName] = useState("");
  const [selectedServerNames, setSelectedServerNames] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<
    { serverName: string; warnings: string[]; tools: Array<{ name: string; description?: string; inputSchema?: unknown; safetyClassification: "read_like" | "unsafe_or_unknown"; classificationReason: string }> }[]
  >([]);
  const [selectedToolsByServer, setSelectedToolsByServer] = useState<Record<string, string[]>>({});
  const [toolQuery, setToolQuery] = useState("");
  const [metadataReview, setMetadataReview] = useState(true);
  const [deeperAnalysis, setDeeperAnalysis] = useState(false);
  const [sampleCallsPerTool, setSampleCallsPerTool] = useState(1);
  const [toolCallTimeoutMs, setToolCallTimeoutMs] = useState(10000);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunJobEvent[]>([]);
  const [report, setReport] = useState<ToolAnalysisReport | null>(null);
  const [savedReportId, setSavedReportId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewStep, setViewStep] = useState<"configure" | "run" | "report">("configure");
  const [runState, setRunState] = useState<"idle" | "running" | "stopped" | "error">("idle");
  const cleanupRef = useRef<null | (() => void)>(null);

  const effectiveAssistantAgentName = settingsAssistantAgentName || agents[0]?.name || "";
  const analysisProgress = useMemo(() => {
    let totalTools = 0;
    const started = new Set<string>();
    const finished = new Set<string>();
    for (const event of events) {
      const message =
        typeof event.payload?.message === "string" ? event.payload.message : "";
      if (!message) continue;
      const totalMatch = message.match(/\((\d+)\s+tools?\)/i);
      if (totalMatch) {
        totalTools = Math.max(totalTools, Number(totalMatch[1]) || 0);
      }
      const startedMatch = message.match(/^Started\s+(.+)$/);
      if (startedMatch) started.add(startedMatch[1]);
      const finishedMatch = message.match(/^Finished\s+(.+)$/);
      if (finishedMatch) finished.add(finishedMatch[1]);
    }
    const percent =
      totalTools > 0 ? Math.max(0, Math.min(100, Math.round((finished.size / totalTools) * 100))) : 0;
    return {
      totalTools,
      startedTools: started.size,
      finishedTools: finished.size,
      percent
    };
  }, [events]);

  useEffect(() => {
    let active = true;
    if (mode !== "workspace") return;
    source
      .getWorkspaceSettings()
      .then((settings) => {
        if (!active || !settings) return;
        setSettingsAssistantAgentName(settings.scenarioAssistantAgentName ?? "");
      })
      .catch(() => {
        if (active) setSettingsAssistantAgentName("");
      });
    return () => {
      active = false;
    };
  }, [mode, source]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const clearActiveToolAnalysisJob = () => {
    try {
      sessionStorage.removeItem(TOOL_ANALYSIS_ACTIVE_JOB_KEY);
    } catch {
      // ignore sessionStorage access issues
    }
  };

  const setActiveToolAnalysisJob = (jobId: string) => {
    try {
      sessionStorage.setItem(TOOL_ANALYSIS_ACTIVE_JOB_KEY, jobId);
    } catch {
      // ignore sessionStorage access issues
    }
  };

  const attachToJob = (jobId: string) => {
    cleanupRef.current?.();
    cleanupRef.current = source.subscribeToolAnalysisJob(jobId, (event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "completed") {
        void source
          .getToolAnalysisResult(jobId)
          .then((result) => {
            setReport(result.report);
            setSavedReportId(result.savedReportId ?? null);
          })
          .catch((error: any) =>
            toast({
              title: "Could not load analysis report",
              description: String(error?.message ?? error),
              variant: "destructive"
            })
          )
          .finally(() => {
            clearActiveToolAnalysisJob();
            setActiveJobId(null);
            setSubmitting(false);
            setRunState("idle");
            setViewStep("run");
          });
      } else if (event.type === "error") {
        const message = String(event.payload?.message ?? "");
        clearActiveToolAnalysisJob();
        setRunState(message.toLowerCase().includes("abort") ? "stopped" : "error");
        setActiveJobId(null);
        setSubmitting(false);
      }
    });
  };

  useEffect(() => {
    if (mode !== "workspace" || activeJobId || report) return;
    let storedJobId = "";
    try {
      storedJobId = sessionStorage.getItem(TOOL_ANALYSIS_ACTIVE_JOB_KEY) ?? "";
    } catch {
      storedJobId = "";
    }
    if (!storedJobId) return;

    setViewStep("run");
    setRunState("running");
    setSubmitting(true);
    setActiveJobId(storedJobId);
    setEvents([]);
    attachToJob(storedJobId);
    return () => {
      // no-op; cleanup handled by standard subscription cleanup
    };
  }, [mode, source, activeJobId, report]);

  const discoverTools = async () => {
    if (mode !== "workspace") return;
    if (selectedServerNames.length === 0) {
      setDiscovered([]);
      setSelectedToolsByServer({});
      return;
    }
    setDiscovering(true);
    try {
      const response = await source.discoverToolsForAnalysis({ serverNames: selectedServerNames });
      setDiscovered(response.servers);
      setSelectedToolsByServer((prev) => {
        const next: Record<string, string[]> = {};
        for (const server of response.servers) {
          const prevSelected = prev[server.serverName] ?? [];
          const availableNames = server.tools.map((tool) => tool.name);
          const retained = prevSelected.filter((name) => availableNames.includes(name));
          next[server.serverName] = retained.length > 0 ? retained : availableNames;
        }
        return next;
      });
    } catch (error: any) {
      toast({
        title: "Could not discover MCP tools",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    void discoverTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedServerNames.join("|")]);

  const filteredDiscovered = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return discovered;
    return discovered
      .map((server) => ({
        ...server,
        tools: server.tools.filter(
          (tool) =>
            tool.name.toLowerCase().includes(q) ||
            (tool.description || "").toLowerCase().includes(q)
        )
      }))
      .filter((server) => server.tools.length > 0);
  }, [discovered, toolQuery]);

  const totalSelectedTools = useMemo(
    () => Object.values(selectedToolsByServer).reduce((sum, list) => sum + list.length, 0),
    [selectedToolsByServer]
  );
  const selectedServerLabel = selectedServerNames[0] ?? "";

  const startAnalysis = async () => {
    if (mode !== "workspace") {
      toast({
        title: "Workspace mode required",
        description: "Analyze MCP Tools is only available in workspace mode.",
        variant: "destructive"
      });
      return;
    }
    if (!metadataReview && !deeperAnalysis) {
      toast({ title: "Select at least one mode", variant: "destructive" });
      return;
    }
    if (selectedServerNames.length !== 1) {
      toast({ title: "Select exactly one server", variant: "destructive" });
      return;
    }
    if (totalSelectedTools === 0) {
      toast({ title: "Select at least one tool", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    setEvents([]);
    setReport(null);
    setSavedReportId(null);
    setViewStep("run");
    setRunState("running");
    try {
      const { jobId } = await source.startToolAnalysis({
        serverNames: selectedServerNames,
        selectedToolsByServer,
        modes: { metadataReview, deeperAnalysis },
        deeperAnalysisOptions: {
          autoRunPolicy: "read_only_allowlist",
          sampleCallsPerTool,
          toolCallTimeoutMs
        }
      });
      setActiveJobId(jobId);
      setActiveToolAnalysisJob(jobId);
      attachToJob(jobId);
    } catch (error: any) {
      setSubmitting(false);
      setRunState("error");
      setViewStep("run");
      toast({
        title: "Could not start tool analysis",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    }
  };

  const stopAnalysis = async () => {
    if (!activeJobId) return;
    const jobId = activeJobId;
    try {
      const response = await source.stopToolAnalysis(jobId);
      if (response.status === "completed") {
        cleanupRef.current?.();
        cleanupRef.current = null;
        const result = await source.getToolAnalysisResult(jobId);
        setReport(result.report);
        setSavedReportId(result.savedReportId ?? null);
        clearActiveToolAnalysisJob();
        setActiveJobId(null);
        setSubmitting(false);
        setRunState("idle");
        setViewStep("run");
        toast({ title: "Analysis already finished", description: "Showing the result overview." });
        return;
      }
      if (response.status === "stopped") {
        cleanupRef.current?.();
        cleanupRef.current = null;
        clearActiveToolAnalysisJob();
        setActiveJobId(null);
        setSubmitting(false);
        setRunState("stopped");
        toast({ title: "Analysis stopped" });
        return;
      }
      if (response.status === "error") {
        cleanupRef.current?.();
        cleanupRef.current = null;
        clearActiveToolAnalysisJob();
        setActiveJobId(null);
        setSubmitting(false);
        setRunState("error");
        toast({
          title: "Analysis already ended with an error",
          description: "Review the progress log and return to Configure Analysis."
        });
        return;
      }
      toast({ title: "Stopping analysis..." });
    } catch (error: any) {
      toast({
        title: "Could not stop analysis",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    }
  };

  const backToConfigure = () => {
    setViewStep("configure");
    setRunState("idle");
    setActiveJobId(null);
  };

  const toggleServer = (serverName: string, checked: boolean) => {
    setSelectedServerNames((prev) => (checked ? [serverName] : prev.filter((name) => name !== serverName)));
  };

  const toggleTool = (serverName: string, toolName: string, checked: boolean) => {
    setSelectedToolsByServer((prev) => {
      const current = new Set(prev[serverName] ?? []);
      if (checked) current.add(toolName);
      else current.delete(toolName);
      return { ...prev, [serverName]: Array.from(current) };
    });
  };

  const setAllToolsForServer = (serverName: string, toolNames: string[]) => {
    setSelectedToolsByServer((prev) => ({ ...prev, [serverName]: toolNames }));
  };

  const canOpenConfigureStep = true;
  const canOpenRunStep =
    activeJobId !== null || events.length > 0 || runState === "stopped" || runState === "error";
  const canOpenReportStep = Boolean(report);

  const openStep = (step: "configure" | "run" | "report") => {
    if (step === "configure" && canOpenConfigureStep) {
      setViewStep("configure");
      return;
    }
    if (step === "run" && canOpenRunStep) {
      setViewStep("run");
      return;
    }
    if (step === "report" && canOpenReportStep) {
      setViewStep("report");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Analyze MCP Tools</h1>
          <p className="text-sm text-muted-foreground">
            Review MCP tools for schema quality, ergonomics, and agent/eval readiness.
          </p>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <button
            type="button"
            onClick={() => openStep("configure")}
            className="rounded-full"
            aria-label="Open Configure Analysis"
          >
            <Badge
              variant={viewStep === "configure" ? "default" : "outline"}
              className="cursor-pointer"
            >
              Configure Analysis
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => openStep("run")}
            disabled={!canOpenRunStep}
            className="rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Open Run Analysis"
          >
            <Badge
              variant={viewStep === "run" ? "default" : "outline"}
              className={canOpenRunStep ? "cursor-pointer" : "cursor-not-allowed"}
            >
              Run Analysis
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => openStep("report")}
            disabled={!canOpenReportStep}
            className="rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Open Report"
          >
            <Badge
              variant={viewStep === "report" ? "default" : "outline"}
              className={canOpenReportStep ? "cursor-pointer" : "cursor-not-allowed"}
            >
              Report
            </Badge>
          </button>
        </div>
      </div>

      {mode !== "workspace" && (
        <Alert>
          <AlertTitle>Workspace mode required</AlertTitle>
          <AlertDescription>
            Analyze MCP Tools uses the local app server, configured agents, and MCP connections. Switch Data Source to Workspace.
          </AlertDescription>
        </Alert>
      )}

      {viewStep === "configure" && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run MCP analysis</CardTitle>
          <CardDescription>
            Select servers and tools, choose metadata review and/or deeper sample-call analysis, then run the report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!effectiveAssistantAgentName && (
            <Alert>
              <AlertTitle>No assistant agent available</AlertTitle>
              <AlertDescription>
                Add a library agent in{" "}
                <Link to="/libraries/agents" className="underline">
                  Agents
                </Link>{" "}
                and optionally set the default Scenario Assistant Agent in{" "}
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
                disabled={librariesLoading}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Servers
              </Button>
            </div>
            <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              {servers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No library servers configured.</p>
              ) : (
                servers.map((server) => {
                  const name = server.name || server.id;
                  const checked = selectedServerNames.includes(name);
                  return (
                    <label key={server.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                      <Checkbox checked={checked} onCheckedChange={(value) => toggleServer(name, Boolean(value))} />
                      <div className="min-w-0">
                        <div className="font-medium">{name}</div>
                        {server.url && <div className="truncate text-xs text-muted-foreground">{server.url}</div>}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">Select exactly one MCP server for analysis.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Filter visible tools</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                placeholder="Filter tools by name or description..."
                value={toolQuery}
                onChange={(e) => setToolQuery(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Filtering only changes what is shown; selected tools remain selected.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">
                {selectedServerLabel ? `Tools for ${selectedServerLabel}` : "Tools"}
              </Label>
              <Button type="button" size="sm" variant="outline" onClick={() => void discoverTools()} disabled={discovering || selectedServerNames.length === 0}>
                {discovering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Discover Tools
              </Button>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              {selectedServerNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">Select a server to discover tools.</p>
              ) : discovering && discovered.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading tools...</p>
              ) : filteredDiscovered.length === 0 && !discovering ? (
                <p className="text-sm text-muted-foreground">No discovered tools match the current filters.</p>
              ) : (
                filteredDiscovered.map((server) => {
                  const selected = new Set(selectedToolsByServer[server.serverName] ?? []);
                  return (
                    <div key={server.serverName} className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="font-medium">{server.serverName}</div>
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setAllToolsForServer(server.serverName, server.tools.map((t) => t.name))}>
                            Select all
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setAllToolsForServer(server.serverName, [])}>
                            Clear
                          </Button>
                        </div>
                      </div>
                      {server.warnings.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {server.warnings.map((warning) => (
                            <div key={`${server.serverName}-${warning}`} className="text-xs text-amber-700">
                              {formatToolDiscoveryWarning(server.serverName, warning)}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid gap-2">
                        {server.tools.map((tool) => (
                          <label key={`${server.serverName}-${tool.name}`} className="flex items-start gap-2 rounded border p-2">
                            <Checkbox
                              checked={selected.has(tool.name)}
                              onCheckedChange={(value) =>
                                toggleTool(server.serverName, tool.name, Boolean(value))
                              }
                            />
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs">{tool.name}</span>
                                <Badge variant={tool.safetyClassification === "read_like" ? "secondary" : "outline"} className="text-[10px]">
                                  {tool.safetyClassification === "read_like" ? "read-like" : "unsafe/unknown"}
                                </Badge>
                              </div>
                              {tool.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
                              )}
                              <p className="text-[11px] text-muted-foreground">{tool.classificationReason}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Selected tools: {totalSelectedTools}
            </p>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="text-sm font-medium">Analysis Modes</div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={metadataReview} onCheckedChange={(v) => setMetadataReview(Boolean(v))} />
              <span className="inline-flex items-center gap-1.5">
                Metadata / schema review
                <ModeInfo text="No tool execution. Reviews tool names, descriptions, and schemas only." />
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={deeperAnalysis} onCheckedChange={(v) => setDeeperAnalysis(Boolean(v))} />
              <span className="inline-flex items-center gap-1.5">
                Deeper analysis
                <ModeInfo text="Runs sample MCP tool calls automatically for read-like tools only (based on the safety allowlist)." />
              </span>
            </label>
            {deeperAnalysis && (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
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
                    onChange={(e) => setSampleCallsPerTool(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
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
                    onChange={(e) => setToolCallTimeoutMs(Math.max(1000, Math.min(60000, Number(e.target.value) || 10000)))}
                    className="h-8"
                  />
                </div>
                <div className="md:col-span-3 text-xs text-amber-700">
                  Deeper analysis may execute read-only MCP tools automatically.
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void startAnalysis()} disabled={submitting || !!activeJobId || mode !== "workspace"}>
              {(submitting || !!activeJobId) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Analyze Tools
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {viewStep === "run" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>Progress</span>
                </CardTitle>
                <CardDescription>
                {activeJobId
                    ? "Live tool-analysis job events:"
                    : report
                      ? "Analysis finished. Review the summary below or open the saved report details."
                    : runState === "stopped"
                      ? "Analysis was stopped. You can return to Configure Analysis."
                      : runState === "error"
                        ? "Analysis ended with an error. Review the log and go back to Configure Analysis."
                        : "Analysis finished."}
                </CardDescription>
              </div>
              {activeJobId ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void stopAnalysis()}>
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
                      : "Preparing analysis..."}
                  </span>
                  <span>{analysisProgress.totalTools > 0 ? `${analysisProgress.percent}%` : "0%"}</span>
                </div>
                <Progress value={analysisProgress.totalTools > 0 ? analysisProgress.percent : 0} className="h-2" />
              </div>
            )}
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {activeJobId ? "Starting analysis..." : "No progress events captured."}
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-auto rounded border bg-muted/20 p-2">
                {events.map((event, index) => (
                  <div key={`${event.ts}-${index}`} className="text-xs">
                    <span className="mr-2 font-mono text-muted-foreground">{new Date(event.ts).toLocaleTimeString()}</span>
                    <Badge variant="outline" className="mr-2 text-[10px]">{event.type}</Badge>
                    <span className="break-all">
                      {typeof event.payload.message === "string"
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
                        {report.summary.toolsAnalyzed} tools analyzed, {report.summary.toolsSkipped} skipped, across{" "}
                        {report.summary.serversAnalyzed} server{report.summary.serversAnalyzed !== 1 ? "s" : ""}.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {savedReportId && (
                        <Button asChild size="sm">
                          <Link to={`/tool-analysis-results/${savedReportId}`}>Open result details</Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant="outline">
                        <Link to="/tool-analysis-results">View all results</Link>
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => openStep("report")}>
                        View inline report
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {report.summary.issueCounts.critical > 0 && (
                      <Badge className="bg-red-600 text-white hover:bg-red-600">Critical: {report.summary.issueCounts.critical}</Badge>
                    )}
                    {report.summary.issueCounts.high > 0 && (
                      <Badge className="bg-orange-500 text-white hover:bg-orange-500">High: {report.summary.issueCounts.high}</Badge>
                    )}
                    {report.summary.issueCounts.medium > 0 && (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">Medium: {report.summary.issueCounts.medium}</Badge>
                    )}
                    {report.summary.issueCounts.low > 0 && (
                      <Badge className="bg-blue-500 text-white hover:bg-blue-500">Low: {report.summary.issueCounts.low}</Badge>
                    )}
                    {report.summary.issueCounts.info > 0 && (
                      <Badge variant="outline">Info: {report.summary.issueCounts.info}</Badge>
                    )}
                    {Object.values(report.summary.issueCounts).every((n) => n === 0) && (
                      <Badge className="bg-green-600 text-white hover:bg-green-600">No findings</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {viewStep === "report" && report && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Report</h2>
              <p className="text-sm text-muted-foreground">
                {report.summary.toolsAnalyzed} tools analyzed across {report.summary.serversAnalyzed} server{report.summary.serversAnalyzed !== 1 ? "s" : ""}.
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
                    `tool-analysis-${Date.now()}.json`,
                    `${JSON.stringify(report, null, 2)}\n`,
                    "application/json"
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
                    `tool-analysis-${Date.now()}.md`,
                    toolAnalysisReportToMarkdown(report),
                    "text/markdown"
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Export Markdown
              </Button>
            </div>
          </div>
          <ToolAnalysisReportView report={report} />
        </div>
      )}
    </div>
  );
};

export default ToolAnalysisPage;
