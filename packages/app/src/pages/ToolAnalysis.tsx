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
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { toast } from "@/hooks/use-toast";
import type { RunJobEvent, ToolAnalysisReport } from "@/lib/data-sources/types";
import { ChevronDown, CircleHelp, Download, Lightbulb, Loader2, RefreshCw, Search } from "lucide-react";

const ALL_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
type FindingSeverity = (typeof ALL_SEVERITIES)[number];

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toMarkdownReport(report: ToolAnalysisReport): string {
  const lines: string[] = [];
  lines.push(`# MCP Tool Analysis Report`);
  lines.push("");
  lines.push(`- Created: ${report.createdAt}`);
  lines.push(`- Assistant Agent: ${report.assistantAgentName}`);
  lines.push(`- Assistant Model: ${report.assistantAgentModel}`);
  lines.push(
    `- Modes: ${[
      report.modes.metadataReview ? "metadata review" : null,
      report.modes.deeperAnalysis ? "deeper analysis" : null
    ]
      .filter(Boolean)
      .join(" + ")}`
  );
  lines.push("");
  lines.push(`## Summary`);
  lines.push(`- Servers analyzed: ${report.summary.serversAnalyzed}`);
  lines.push(`- Tools analyzed: ${report.summary.toolsAnalyzed}`);
  lines.push(`- Tools skipped: ${report.summary.toolsSkipped}`);
  lines.push("");
  for (const server of report.servers) {
    lines.push(`## Server: ${server.serverName}`);
    if (server.warnings.length > 0) {
      lines.push(...server.warnings.map((warning) => `- Warning: ${warning}`));
      lines.push("");
    }
    for (const tool of server.tools) {
      lines.push(`### ${tool.publicToolName}`);
      lines.push(`- Safety: ${tool.safetyClassification} (${tool.classificationReason})`);
      if (tool.metadataReview) {
        if (tool.metadataReview.issues.length > 0) {
          lines.push(`#### Metadata issues`);
          for (const issue of tool.metadataReview.issues) {
            lines.push(`  - [${issue.severity}] ${issue.title}: ${issue.detail}`);
          }
        }
      }
      if (tool.deeperAnalysis) {
        if (!tool.deeperAnalysis.attempted) {
          lines.push(`- Deeper analysis: skipped (${tool.deeperAnalysis.skippedReason ?? "unknown"})`);
        } else {
          lines.push(`- Deeper analysis sample calls: ${tool.deeperAnalysis.sampleCalls.length}`);
          for (const sample of tool.deeperAnalysis.sampleCalls) {
            lines.push(
              `  - Call ${sample.callIndex}: ${sample.ok ? "ok" : "error"}${sample.durationMs ? ` (${sample.durationMs}ms)` : ""}`
            );
            if (sample.error) lines.push(`    - Error: ${sample.error}`);
            for (const obs of sample.observations) lines.push(`    - ${obs}`);
          }
        }
      }
      if (tool.overallRecommendations.length > 0) {
        lines.push(`#### Recommendations`);
        for (const rec of tool.overallRecommendations) lines.push(`  - ${rec}`);
      }
      if (tool.metadataReview && tool.metadataReview.evalReadinessNotes.length > 0) {
        lines.push(`#### Agent/Eval readiness notes`);
        for (const note of tool.metadataReview.evalReadinessNotes) lines.push(`  - ${note}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
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

function SuggestionCallout({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded-md border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-[11px] text-slate-800">
      <div className="mb-1 inline-flex items-center gap-1 text-sky-800 font-medium">
        <Lightbulb className="h-3.5 w-3.5" />
        Suggested improvement
      </div>
      <p>{text}</p>
    </div>
  );
}

function severityBadgeClass(severity: "critical" | "high" | "medium" | "low" | "info"): string {
  switch (severity) {
    case "critical":
      return "border-red-300 bg-red-100 text-red-900";
    case "high":
      return "border-orange-300 bg-orange-100 text-orange-900";
    case "medium":
      return "border-amber-300 bg-amber-100 text-amber-900";
    case "low":
      return "border-sky-300 bg-sky-100 text-sky-900";
    case "info":
    default:
      return "border-slate-300 bg-slate-100 text-slate-800";
  }
}

function severityBadgeInactiveClass(severity: "critical" | "high" | "medium" | "low" | "info"): string {
  switch (severity) {
    case "critical":
      return "border-red-300 bg-background text-red-900";
    case "high":
      return "border-orange-300 bg-background text-orange-900";
    case "medium":
      return "border-amber-300 bg-background text-amber-900";
    case "low":
      return "border-sky-300 bg-background text-sky-900";
    case "info":
    default:
      return "border-slate-300 bg-background text-slate-800";
  }
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
  const [submitting, setSubmitting] = useState(false);
  const [viewStep, setViewStep] = useState<"configure" | "run" | "report">("configure");
  const [runState, setRunState] = useState<"idle" | "running" | "stopped" | "error">("idle");
  const [activeSeverityFilters, setActiveSeverityFilters] = useState<FindingSeverity[]>([
    ...ALL_SEVERITIES
  ]);
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
      cleanupRef.current?.();
      cleanupRef.current = source.subscribeToolAnalysisJob(jobId, (event) => {
        setEvents((prev) => [...prev, event]);
        if (event.type === "completed") {
          void source
            .getToolAnalysisResult(jobId)
            .then((result) => setReport(result.report))
            .catch((error: any) =>
              toast({
                title: "Could not load analysis report",
                description: String(error?.message ?? error),
                variant: "destructive"
              })
            )
            .finally(() => {
              setActiveJobId(null);
              setSubmitting(false);
              setRunState("idle");
              setViewStep("report");
            });
        } else if (event.type === "error") {
          const message = String(event.payload?.message ?? "");
          setRunState(message.toLowerCase().includes("abort") ? "stopped" : "error");
          setActiveJobId(null);
          setSubmitting(false);
        }
      });
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
        setActiveJobId(null);
        setSubmitting(false);
        setRunState("idle");
        setViewStep("report");
        toast({ title: "Analysis already finished", description: "Showing the completed report." });
        return;
      }
      if (response.status === "stopped") {
        cleanupRef.current?.();
        cleanupRef.current = null;
        setActiveJobId(null);
        setSubmitting(false);
        setRunState("stopped");
        toast({ title: "Analysis stopped" });
        return;
      }
      if (response.status === "error") {
        cleanupRef.current?.();
        cleanupRef.current = null;
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

  const toggleSeverityFilter = (severity: FindingSeverity) => {
    setActiveSeverityFilters((prev) =>
      prev.includes(severity) ? prev.filter((s) => s !== severity) : [...prev, severity]
    );
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

  const reportSeveritySet = new Set(activeSeverityFilters);

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
                    toMarkdownReport(report),
                    "text/markdown"
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Export Markdown
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Tools analyzed</div><div className="text-2xl font-semibold">{report.summary.toolsAnalyzed}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Tools skipped</div><div className="text-2xl font-semibold">{report.summary.toolsSkipped}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Findings</div><div className="text-2xl font-semibold">{report.findings.length}</div></CardContent></Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analysis Overview</CardTitle>
              <CardDescription>
                Visual breakdown of findings by severity. Click badges to filter the report.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {ALL_SEVERITIES.filter((severity) => report.summary.issueCounts[severity] > 0).map((severity) => {
                  const active = reportSeveritySet.has(severity);
                  return (
                    <button
                      key={`sev-${severity}`}
                      type="button"
                      onClick={() => toggleSeverityFilter(severity)}
                      className="rounded-full"
                      aria-pressed={active}
                    >
                      <Badge
                        variant="outline"
                        className={`capitalize font-normal ${active ? severityBadgeClass(severity) : severityBadgeInactiveClass(severity)} ${
                          active ? "ring-1 ring-current" : "opacity-70"
                        }`}
                      >
                        {severity}: {report.summary.issueCounts[severity]}
                      </Badge>
                    </button>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveSeverityFilters([...ALL_SEVERITIES])}
                  className="h-7 px-2 text-xs"
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {report.servers.map((server) => {
              const filteredTools = server.tools.filter((tool) => {
                const findings = [
                  ...(tool.metadataReview?.issues ?? []),
                  ...(tool.deeperAnalysis?.sampleCalls.flatMap((call) => call.issues) ?? [])
                ];
                if (findings.length === 0) return activeSeverityFilters.length === ALL_SEVERITIES.length;
                return findings.some((finding) => reportSeveritySet.has(finding.severity as FindingSeverity));
              });
              if (filteredTools.length === 0) return null;
              return (
              <Card key={server.serverName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{server.serverName}</CardTitle>
                  <CardDescription>
                    Discovered {server.toolCountDiscovered} · Showing {filteredTools.length} of {server.toolCountAnalyzed} analyzed · Skipped {server.toolCountSkipped}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {server.warnings.length > 0 && (
                    <Alert>
                      <AlertTitle>Warnings</AlertTitle>
                      <AlertDescription>
                        <ul className="ml-4 list-disc space-y-1">
                          {server.warnings.map((warning) => <li key={`${server.serverName}-${warning}`}>{warning}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  {filteredTools.map((tool) => (
                    <details key={tool.publicToolName} className="group rounded-md border p-3">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-mono text-sm">{tool.publicToolName}</div>
                            {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={tool.safetyClassification === "read_like" ? "secondary" : "outline"}>
                              {tool.safetyClassification}
                            </Badge>
                            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                          </div>
                        </div>
                      </summary>
                      <div className="mt-3 space-y-2">
                      {tool.metadataReview && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Metadata review</div>
                          {tool.metadataReview.issues.filter((issue) =>
                            reportSeveritySet.has(issue.severity as FindingSeverity)
                          ).length === 0 ? (
                            <p className="text-xs text-muted-foreground">No metadata issues reported.</p>
                          ) : (
                            <div className="space-y-1">
                              {tool.metadataReview.issues
                                .filter((issue) =>
                                  reportSeveritySet.has(issue.severity as FindingSeverity)
                                )
                                .map((issue, index) => (
                                <div key={issue.id} className="rounded border p-2 text-xs">
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                                        {index + 1}
                                      </span>
                                      <span className="min-w-0 font-bold leading-tight">{issue.title}</span>
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={`shrink-0 text-[10px] ${severityBadgeClass(issue.severity)}`}
                                    >
                                      {issue.severity}
                                    </Badge>
                                  </div>
                                  <p><span className="font-bold">Finding:</span> {issue.detail}</p>
                                  {issue.suggestion && <SuggestionCallout text={issue.suggestion} />}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {tool.deeperAnalysis && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Deeper analysis</div>
                          {!tool.deeperAnalysis.attempted ? (
                            <p className="text-xs text-muted-foreground">{tool.deeperAnalysis.skippedReason ?? "Skipped"}</p>
                          ) : (
                            <div className="space-y-2">
                              {tool.deeperAnalysis.sampleCalls.map((sample) => (
                                <div key={`${tool.publicToolName}-call-${sample.callIndex}`} className="rounded border p-2 text-xs">
                                  <div className="mb-1 flex items-center gap-2">
                                    <Badge variant={sample.ok ? "secondary" : "destructive"} className="text-[10px]">
                                      {sample.ok ? "ok" : "error"}
                                    </Badge>
                                    <span>Call {sample.callIndex}</span>
                                    {sample.durationMs !== undefined && (
                                      <span className="text-muted-foreground">{sample.durationMs}ms</span>
                                    )}
                                  </div>
                                  {sample.error && <p className="text-destructive">{sample.error}</p>}
                                  {sample.observations.length > 0 && (
                                    <div className="mt-2">
                                      <div className="mb-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                        Observations
                                      </div>
                                      <ul className="ml-4 list-disc space-y-1">
                                      {sample.observations.map((obs, idx) => <li key={`${tool.publicToolName}-obs-${sample.callIndex}-${idx}`}>{obs}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {sample.issues.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {sample.issues
                                        .filter((issue) =>
                                          reportSeveritySet.has(issue.severity as FindingSeverity)
                                        )
                                        .map((issue, index) => (
                                        <div key={`${sample.callIndex}-${issue.id}`} className="rounded border p-2">
                                          <div className="mb-1 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                                                {index + 1}
                                              </span>
                                              <span className="min-w-0 font-bold leading-tight">{issue.title}</span>
                                            </div>
                                            <Badge
                                              variant="outline"
                                              className={`shrink-0 text-[10px] ${severityBadgeClass(issue.severity)}`}
                                            >
                                              {issue.severity}
                                            </Badge>
                                          </div>
                                          <p><span className="font-bold">Finding:</span> {issue.detail}</p>
                                          {issue.suggestion && <SuggestionCallout text={issue.suggestion} />}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      </div>
                    </details>
                  ))}
                </CardContent>
              </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolAnalysisPage;
