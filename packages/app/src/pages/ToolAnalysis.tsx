import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { toast } from "@/hooks/use-toast";
import type { RunJobEvent, ToolAnalysisReport } from "@/lib/data-sources/types";
import { Download, Loader2, RefreshCw, Search } from "lucide-react";

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
          lines.push(`- Metadata issues:`);
          for (const issue of tool.metadataReview.issues) {
            lines.push(`  - [${issue.severity}] ${issue.title}: ${issue.detail}`);
          }
        }
        if (tool.metadataReview.evalReadinessNotes.length > 0) {
          lines.push(`- Eval readiness notes:`);
          for (const note of tool.metadataReview.evalReadinessNotes) lines.push(`  - ${note}`);
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
        lines.push(`- Recommendations:`);
        for (const rec of tool.overallRecommendations) lines.push(`  - ${rec}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

const ToolAnalysisPage = () => {
  const { mode, source } = useDataSource();
  const { servers, agents, loading: librariesLoading, reload: reloadLibraries } = useLibraries();

  const [assistantAgentName, setAssistantAgentName] = useState("");
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
  const cleanupRef = useRef<null | (() => void)>(null);

  const effectiveAssistantAgentName = assistantAgentName || agents[0]?.name || "";

  useEffect(() => {
    let active = true;
    if (mode !== "workspace") return;
    source
      .getWorkspaceSettings()
      .then((settings) => {
        if (!active || !settings) return;
        setAssistantAgentName(settings.scenarioAssistantAgentName ?? "");
      })
      .catch(() => {
        if (active) setAssistantAgentName("");
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
    if (selectedServerNames.length === 0) {
      toast({ title: "Select at least one server", variant: "destructive" });
      return;
    }
    if (totalSelectedTools === 0) {
      toast({ title: "Select at least one tool", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    setEvents([]);
    setReport(null);
    try {
      const { jobId } = await source.startToolAnalysis({
        assistantAgentName: effectiveAssistantAgentName || undefined,
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
            });
        } else if (event.type === "error") {
          setActiveJobId(null);
          setSubmitting(false);
        }
      });
    } catch (error: any) {
      setSubmitting(false);
      toast({
        title: "Could not start tool analysis",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    }
  };

  const stopAnalysis = async () => {
    if (!activeJobId) return;
    try {
      await source.stopToolAnalysis(activeJobId);
      toast({ title: "Stopping analysis..." });
    } catch (error: any) {
      toast({
        title: "Could not stop analysis",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    }
  };

  const toggleServer = (serverName: string, checked: boolean) => {
    setSelectedServerNames((prev) =>
      checked ? Array.from(new Set([...prev, serverName])) : prev.filter((name) => name !== serverName)
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

  const setAllToolsForServer = (serverName: string, toolNames: string[]) => {
    setSelectedToolsByServer((prev) => ({ ...prev, [serverName]: toolNames }));
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
        <Button type="button" size="sm" variant="outline" onClick={() => void reloadLibraries()} disabled={librariesLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Libraries
        </Button>
      </div>

      {mode !== "workspace" && (
        <Alert>
          <AlertTitle>Workspace mode required</AlertTitle>
          <AlertDescription>
            Analyze MCP Tools uses the local app server, configured agents, and MCP connections. Switch Data Source to Workspace.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Configuration</CardTitle>
          <CardDescription>
            Select servers and tools, choose metadata review and/or deeper sample-call analysis, then run the report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Assistant Agent</Label>
              <Select value={effectiveAssistantAgentName || "__none__"} onValueChange={(v) => setAssistantAgentName(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select assistant agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Use first available agent</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.name || agent.id}>
                      {(agent.name || agent.id)} · {agent.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Tool Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-8"
                  placeholder="Filter tools by name or description..."
                  value={toolQuery}
                  onChange={(e) => setToolQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Servers</Label>
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
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Tools (per selected server)</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => void discoverTools()} disabled={discovering || selectedServerNames.length === 0}>
                {discovering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Discover Tools
              </Button>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              {selectedServerNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">Select one or more servers to discover tools.</p>
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
                              {warning}
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
              <span>Metadata / schema review (no tool execution)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={deeperAnalysis} onCheckedChange={(v) => setDeeperAnalysis(Boolean(v))} />
              <span>Deeper analysis (sample tool calls)</span>
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
            {activeJobId && (
              <Button type="button" variant="outline" onClick={() => void stopAnalysis()}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Progress</CardTitle>
          <CardDescription>Live tool-analysis job events (SSE).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No analysis started yet.</p>
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

      {report && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">Report</h2>
              <p className="text-sm text-muted-foreground">
                {report.summary.toolsAnalyzed} tools analyzed across {report.summary.serversAnalyzed} server{report.summary.serversAnalyzed !== 1 ? "s" : ""}.
              </p>
            </div>
            <div className="flex items-center gap-2">
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

          <div className="space-y-4">
            {report.servers.map((server) => (
              <Card key={server.serverName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{server.serverName}</CardTitle>
                  <CardDescription>
                    Discovered {server.toolCountDiscovered} · Analyzed {server.toolCountAnalyzed} · Skipped {server.toolCountSkipped}
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
                  {server.tools.map((tool) => (
                    <div key={tool.publicToolName} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono text-sm">{tool.publicToolName}</div>
                          {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
                        </div>
                        <Badge variant={tool.safetyClassification === "read_like" ? "secondary" : "outline"}>
                          {tool.safetyClassification}
                        </Badge>
                      </div>

                      {tool.metadataReview && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Metadata review</div>
                          {tool.metadataReview.issues.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No metadata issues reported.</p>
                          ) : (
                            <div className="space-y-1">
                              {tool.metadataReview.issues.map((issue) => (
                                <div key={issue.id} className="rounded border p-2 text-xs">
                                  <div className="mb-1 flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px]">{issue.severity}</Badge>
                                    <span className="font-medium">{issue.title}</span>
                                  </div>
                                  <p>{issue.detail}</p>
                                  {issue.suggestion && <p className="mt-1 text-muted-foreground">Suggestion: {issue.suggestion}</p>}
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
                                    <ul className="ml-4 list-disc space-y-1">
                                      {sample.observations.map((obs, idx) => <li key={`${tool.publicToolName}-obs-${sample.callIndex}-${idx}`}>{obs}</li>)}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolAnalysisPage;
