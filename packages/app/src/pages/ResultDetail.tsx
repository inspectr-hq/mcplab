import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Activity, BarChart3, Timer, Layers, CheckCircle2, XCircle, ChevronDown, Download, User, Bot, Wrench, GitCompare, RefreshCw, Sparkles, Loader2, PanelRightOpen, PanelRightClose } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { PassRateBadge } from "@/components/PassRateBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { generateHtmlReport } from "@/lib/generate-html-report";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useConfigs } from "@/contexts/ConfigContext";
import { useLibraries } from "@/contexts/LibraryContext";
import { toast } from "@/hooks/use-toast";
import { isUiFeatureEnabled } from "@/lib/feature-flags";
import type { ConversationItem, EvalResult, EvalConfig as UiEvalConfig, EvalRule } from "@/types/eval";
import type {
  ResultAssistantPendingToolCall,
  ResultAssistantSessionView,
  SnapshotComparison,
  SnapshotRecord
} from "@/lib/data-sources/types";

const RESULT_ASSISTANT_HANDOFF_STORAGE_KEY = "mcplab.resultAssistantScenarioHandoff";

function defaultResultAssistantReportPath(runId: string): string {
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+/, "");
  return `mcplab/reports/result-assistant/${runId}-${stamp}.md`;
}

const ResultDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { source } = useDataSource();
  const snapshotsUiEnabled = isUiFeatureEnabled("snapshots", false);
  const { configs } = useConfigs();
  const { scenarios: libraryScenarios } = useLibraries();
  const [result, setResult] = useState<EvalResult | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [openScenarios, setOpenScenarios] = useState<Set<string>>(new Set());
  const [openConversations, setOpenConversations] = useState<Set<string>>(new Set());
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [snapshotComparison, setSnapshotComparison] = useState<SnapshotComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [targetConfigId, setTargetConfigId] = useState("");
  const [acceptSnapshotName, setAcceptSnapshotName] = useState("");
  const [acceptingBaseline, setAcceptingBaseline] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<ResultAssistantSessionView["messages"]>([]);
  const [assistantPendingToolCalls, setAssistantPendingToolCalls] = useState<ResultAssistantPendingToolCall[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [assistantContextScenarioId, setAssistantContextScenarioId] = useState<string | null>(null);
  const [assistantMeta, setAssistantMeta] = useState<{
    assistantAgentName: string;
    provider: string;
    model: string;
  } | null>(null);
  const [applyReportOpen, setApplyReportOpen] = useState(false);
  const [applyReportMarkdown, setApplyReportMarkdown] = useState("");
  const [applyReportOutputPath, setApplyReportOutputPath] = useState("");
  const [applyReportOverwrite, setApplyReportOverwrite] = useState(false);
  const [applyReportPending, setApplyReportPending] = useState(false);
  const assistantChatEndRef = useRef<HTMLDivElement | null>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const previousSessionId = assistantSessionId;
    if (previousSessionId) {
      void source.closeResultAssistantSession(previousSessionId).catch(() => undefined);
      setAssistantSessionId(null);
      setAssistantMessages([]);
      setAssistantPendingToolCalls([]);
      setAssistantMeta(null);
    }
    setLoading(true);
    source.getResult(id).then((next) => {
      if (active) {
        setResult(next);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id, source]);

  useEffect(() => {
    let active = true;
    source
      .listSnapshots()
      .then((records) => {
        if (active) setSnapshots(records);
      })
      .catch(() => {
        if (active) setSnapshots([]);
      });
    return () => {
      active = false;
    };
  }, [source]);

  const requestedConfigId = searchParams.get("configId") ?? "";
  const activeConfig = useMemo(() => {
    const byRequested = requestedConfigId ? configs.find((c) => c.id === requestedConfigId) : undefined;
    if (byRequested) return byRequested;
    return result ? configs.find((c) => c.id === result.configId) : undefined;
  }, [configs, requestedConfigId, result]);
  const scenarioDefinitionByResultId = useMemo(() => {
    const map = new Map<string, UiEvalConfig["scenarios"][number]>();
    if (activeConfig) {
      for (const scenario of activeConfig.scenarios) {
        map.set(scenario.id, scenario);
        if (scenario.name && !map.has(scenario.name)) map.set(scenario.name, scenario);
      }
      if ((activeConfig.scenarioRefs?.length ?? 0) > 0) {
        for (const ref of activeConfig.scenarioRefs ?? []) {
          const libScenario =
            libraryScenarios.find((s) => s.name === ref) ??
            libraryScenarios.find((s) => s.id === ref);
          if (libScenario) {
            map.set(libScenario.id, libScenario);
            if (libScenario.name) map.set(libScenario.name, libScenario);
            if (!map.has(ref)) map.set(ref, libScenario);
          }
        }
      }
    }
    // Broader fallback for refs-only configs where we only know result scenario ids.
    for (const libScenario of libraryScenarios) {
      if (!map.has(libScenario.id)) map.set(libScenario.id, libScenario);
      if (libScenario.name && !map.has(libScenario.name)) map.set(libScenario.name, libScenario);
    }
    return map;
  }, [activeConfig, libraryScenarios]);
  const inferredConfigId = useMemo(() => {
    if (!result?.snapshotEval?.baselineSnapshotId) return "";
    const matches = configs.filter(
      (config) => config.snapshotEval?.baselineSnapshotId === result.snapshotEval?.baselineSnapshotId
    );
    return matches.length === 1 ? matches[0].id : "";
  }, [configs, result?.snapshotEval?.baselineSnapshotId]);

  useEffect(() => {
    if (!result?.snapshotEval?.baselineSnapshotId) return;
    setSelectedSnapshotId((prev) => prev || result.snapshotEval!.baselineSnapshotId);
  }, [result?.snapshotEval?.baselineSnapshotId]);

  useEffect(() => {
    if (requestedConfigId && configs.some((config) => config.id === requestedConfigId)) {
      setTargetConfigId(requestedConfigId);
      return;
    }
    if (inferredConfigId) {
      setTargetConfigId((prev) => prev || inferredConfigId);
    }
  }, [requestedConfigId, configs, inferredConfigId]);

  useEffect(() => {
    if (!assistantOpen) return;
    const t = window.setTimeout(() => {
      assistantChatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [assistantOpen, assistantMessages.length, assistantLoading]);

  useEffect(() => {
    return () => {
      if (!assistantSessionId) return;
      void source.closeResultAssistantSession(assistantSessionId).catch(() => undefined);
    };
  }, [assistantSessionId, source]);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(40, next)}px`;
  }, [assistantInput, assistantOpen]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading result...</div>;
  if (!result) return <div className="p-8 text-center text-muted-foreground">Result not found</div>;

  const passCount = result.scenarios.reduce((s, sc) => s + sc.runs.filter((r) => r.passed).length, 0);
  const failCount = result.totalRuns - passCount;
  const pieData = [
    { name: "Pass", value: passCount, color: "hsl(152, 69%, 40%)" },
    { name: "Fail", value: failCount, color: "hsl(0, 72%, 51%)" },
  ];

  // Tool frequency
  const toolFreq: Record<string, number> = {};
  result.scenarios.forEach((sc) => sc.runs.forEach((r) => r.toolCalls.forEach((tc) => {
    toolFreq[tc.name] = (toolFreq[tc.name] || 0) + 1;
  })));
  const toolData = Object.entries(toolFreq).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const toggle = (rowId: string) => {
    setOpenScenarios((prev) => {
      const next = new Set(prev);
      next.has(rowId) ? next.delete(rowId) : next.add(rowId);
      return next;
    });
  };

  const toggleConversation = (key: string) => {
    setOpenConversations((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const runKey = (scenarioId: string, runIndex: number) => `${scenarioId}:${runIndex}`;
  const scenarioRowKey = (scenarioId: string, agentName: string) => `${scenarioId}::${agentName}`;
  const comparisonByScenario = new Map(
    (snapshotComparison?.scenario_results ?? []).map((item) => [item.scenario_id, item])
  );

  const compareWithSnapshot = async () => {
    if (!result || !selectedSnapshotId) return;
    setComparing(true);
    try {
      const comparison = await source.compareSnapshot(selectedSnapshotId, result.id);
      setSnapshotComparison(comparison);
    } finally {
      setComparing(false);
    }
  };

  const reviewDrift = async (baselineIdOverride?: string) => {
    const baselineId = baselineIdOverride || result.snapshotEval?.baselineSnapshotId;
    if (!baselineId) return;
    setSelectedSnapshotId(baselineId);
    setComparing(true);
    try {
      const comparison = await source.compareSnapshot(baselineId, result.id);
      setSnapshotComparison(comparison);
    } catch (error: any) {
      toast({
        title: "Could not review drift",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setComparing(false);
    }
  };

  const acceptAsNewBaseline = async () => {
    if (!targetConfigId) {
      toast({
        title: "Select a configuration",
        description: "Choose which config should receive the new baseline.",
        variant: "destructive"
      });
      return;
    }
    setAcceptingBaseline(true);
    try {
      const response = await source.generateSnapshotEvalBaseline(
        result.id,
        targetConfigId,
        acceptSnapshotName.trim() || undefined
      );
      setSnapshots((prev) => [response.snapshot, ...prev.filter((item) => item.id !== response.snapshot.id)]);
      setSelectedSnapshotId(response.snapshot.id);
      toast({
        title: "Baseline updated",
        description: `${response.snapshot.name} is now linked to the selected config.`
      });
      if (!acceptSnapshotName.trim()) {
        setAcceptSnapshotName(response.snapshot.name);
      }
      if (result.snapshotEval?.applied) {
        void reviewDrift(response.snapshot.id);
      }
    } catch (error: any) {
      toast({
        title: "Could not accept new baseline",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setAcceptingBaseline(false);
    }
  };

  const askResultAssistant = async () => {
    const question = assistantInput.trim();
    if (!question || !result) return;
    setAssistantInput("");
    setAssistantLoading(true);
    try {
      let sessionId = assistantSessionId;
      if (!sessionId) {
        const created = await source.createResultAssistantSession(result.id);
        sessionId = created.sessionId;
        syncResultAssistantSession(created.session);
      }
      const response = await source.sendResultAssistantMessage(sessionId, question);
      syncResultAssistantSession(response.session);
    } catch (error: any) {
      toast({
        title: "MCP Labs Assistant error",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const syncResultAssistantSession = (session: ResultAssistantSessionView) => {
    setAssistantSessionId(session.id);
    setAssistantMessages(session.messages);
    setAssistantPendingToolCalls(session.pendingToolCalls);
    setAssistantMeta({
      assistantAgentName: session.selectedAssistantAgentName,
      provider: session.provider,
      model: session.model
    });
  };

  const approveResultAssistantToolCall = async (callId: string) => {
    if (!assistantSessionId) return;
    setAssistantLoading(true);
    try {
      const response = await source.approveResultAssistantToolCall(assistantSessionId, callId);
      syncResultAssistantSession(response.session);
    } catch (error: any) {
      toast({
        title: "Could not approve assistant action",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const denyResultAssistantToolCall = async (callId: string) => {
    if (!assistantSessionId) return;
    setAssistantLoading(true);
    try {
      const response = await source.denyResultAssistantToolCall(assistantSessionId, callId);
      syncResultAssistantSession(response.session);
    } catch (error: any) {
      toast({
        title: "Could not deny assistant action",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const openAssistantWithPrompt = (prompt?: string, options?: { scenarioId?: string }) => {
    setAssistantOpen(true);
    setAssistantContextScenarioId(options?.scenarioId ?? null);
    if (assistantMessages.length === 0) {
      setAssistantMessages([
        {
          id: `msg-${Date.now()}`,
          role: "assistant",
          text: "Ask me to explain failures, tool usage, snapshot drift, or suggest what to inspect next in this result.",
          createdAt: new Date().toISOString()
        }
      ]);
    }
    if (prompt) {
      setAssistantInput(prompt);
    }
  };

  const sendToScenarioAssistant = (assistantReply: string) => {
    if (!result) return;
    if (!assistantContextScenarioId) {
      toast({
        title: "No scenario context",
        description: "Ask about a specific scenario or run first, then send the suggestion.",
        variant: "destructive"
      });
      return;
    }
    const libScenario =
      libraryScenarios.find((s) => s.id === assistantContextScenarioId) ??
      libraryScenarios.find((s) => s.name === assistantContextScenarioId);
    if (!libScenario) {
      toast({
        title: "Scenario not found in library",
        description: `Could not find library scenario '${assistantContextScenarioId}' to open in Scenario Assistant.`,
        variant: "destructive"
      });
      return;
    }
    const prompt = [
      `I am sending a suggestion from the Result Assistant for scenario '${assistantContextScenarioId}' based on run '${result.id}'.`,
      "Please review the suggestion, check it against the current scenario configuration, and propose concrete updates to the Checks and/or Value Capture Rules if appropriate.",
      "",
      "Result Assistant suggestion:",
      assistantReply
    ].join("\n");
    try {
      window.sessionStorage.setItem(
        RESULT_ASSISTANT_HANDOFF_STORAGE_KEY,
        JSON.stringify({
          type: "result-assistant-handoff-v1",
          runId: result.id,
          configId: requestedConfigId || result.configId || "",
          scenarioId: libScenario.id,
          prompt,
          sourceReply: assistantReply
        })
      );
      navigate(`/libraries/scenarios/${encodeURIComponent(libScenario.id)}?assistantHandoff=1`);
    } catch (error: any) {
      toast({
        title: "Could not create handoff",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    }
  };

  const openApplyReportDialog = (assistantReply: string) => {
    if (!result) return;
    setApplyReportMarkdown(assistantReply);
    setApplyReportOutputPath(defaultResultAssistantReportPath(result.id));
    setApplyReportOverwrite(false);
    setApplyReportOpen(true);
  };

  const applyAssistantReport = async () => {
    if (!result) return;
    const markdown = applyReportMarkdown.trim();
    if (!markdown) {
      toast({
        title: "No markdown to write",
        description: "The selected assistant response is empty.",
        variant: "destructive"
      });
      return;
    }
    setApplyReportPending(true);
    try {
      const response = await source.applyResultAssistantReport({
        runId: result.id,
        markdown: applyReportMarkdown,
        outputPath: applyReportOutputPath.trim() || undefined,
        overwrite: applyReportOverwrite
      });
      toast({
        title: "Markdown report written",
        description:
          typeof response.path === "string" && response.path
            ? response.path
            : response.outputPath
      });
      setApplyReportOpen(false);
    } catch (error: any) {
      toast({
        title: "Could not write markdown report",
        description: String(error?.message ?? error),
        variant: "destructive"
      });
    } finally {
      setApplyReportPending(false);
    }
  };

  return (
    <div
      className={`${
        assistantOpen ? "xl:flex xl:h-[calc(100vh-2rem-48px)] xl:min-h-0 xl:flex-col xl:overflow-hidden" : ""
      }`}
    >
      <div className={`flex items-center gap-3 ${assistantOpen ? "xl:shrink-0 xl:pb-6" : "mb-6"}`}>
        <Button variant="ghost" size="icon" asChild><Link to="/results"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-mono">{result.id}</h1>
            <PassRateBadge rate={result.overallPassRate} />
            {snapshotsUiEnabled && result.snapshotEval?.applied && (
              <Badge variant="outline" className="text-xs">
                Snapshot policy · {result.snapshotEval.mode} · {result.snapshotEval.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(result.timestamp).toLocaleString()} · Config hash: <span className="font-mono">{result.configHash}</span>
          </p>
          {snapshotsUiEnabled && result.snapshotEval?.applied && (
            <p className="text-xs text-muted-foreground">
              Baseline: <span className="font-mono">{result.snapshotEval.baselineSnapshotId}</span> · score: {result.snapshotEval.overallScore}
            </p>
          )}
        </div>
        {snapshotsUiEnabled && result.snapshotEval?.applied && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => void reviewDrift()}
            disabled={comparing}
          >
            <GitCompare className="h-3.5 w-3.5" />
            {comparing ? "Reviewing drift..." : "Review Drift"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => {
          const html = generateHtmlReport(result);
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `mcplab-report-${result.id}.html`;
          a.click();
          URL.revokeObjectURL(url);
        }}>
          <Download className="h-3.5 w-3.5" />Download Report
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => openAssistantWithPrompt()}
        >
          <Sparkles className="h-3.5 w-3.5" />
          MCP Labs Assistant
        </Button>
      </div>

      <div
        className={`grid gap-6 items-start ${
          assistantOpen
            ? assistantExpanded
              ? "xl:grid-cols-[minmax(0,1fr)_52rem] xl:flex-1 xl:min-h-0 xl:overflow-hidden"
              : "xl:grid-cols-[minmax(0,1fr)_28rem] xl:flex-1 xl:min-h-0 xl:overflow-hidden"
            : "grid-cols-1"
        }`}
      >
      <div className={`min-w-0 space-y-6 ${assistantOpen ? "xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-2" : ""}`}>

      {snapshotsUiEnabled && result.snapshotEval?.applied && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Snapshot Drift Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">Mode: {result.snapshotEval.mode}</Badge>
              <Badge variant="outline">Status: {result.snapshotEval.status}</Badge>
              <Badge variant="outline">Overall score: {result.snapshotEval.overallScore}</Badge>
              <Badge variant="outline" className="font-mono">
                Baseline: {result.snapshotEval.baselineSnapshotId}
              </Badge>
            </div>
            {result.snapshotEval.impactedScenarios.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Impacted scenarios: {result.snapshotEval.impactedScenarios.join(", ")}
              </p>
            )}
            <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_auto] items-end">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Target config for baseline update</p>
                <Select value={targetConfigId} onValueChange={setTargetConfigId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select config to update" />
                  </SelectTrigger>
                  <SelectContent>
                    {configs.map((config) => (
                      <SelectItem key={config.id} value={config.id}>
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!targetConfigId && (
                  <p className="text-[11px] text-muted-foreground">
                    Tip: open results from the Run page to prefill the config automatically.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">New snapshot name (optional)</p>
                <div className="relative">
                  <input
                    value={acceptSnapshotName}
                    onChange={(e) => setAcceptSnapshotName(e.target.value)}
                    placeholder={`Snapshot ${result.id}`}
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => void reviewDrift()}
                  disabled={comparing}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${comparing ? "animate-spin" : ""}`} />
                  Review Drift
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={() => void acceptAsNewBaseline()}
                  disabled={acceptingBaseline || result.overallPassRate !== 1}
                >
                  {acceptingBaseline ? "Accepting..." : "Accept as New Baseline"}
                </Button>
              </div>
            </div>
            {result.overallPassRate !== 1 && (
              <p className="text-xs text-muted-foreground">
                Baseline updates require a fully passing run (same rule as snapshot creation).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Scenarios" value={result.totalScenarios} icon={Layers} />
        <StatCard title="Total Runs" value={result.totalRuns} icon={Activity} />
        <StatCard title="Pass Rate" value={`${Math.round(result.overallPassRate * 100)}%`} icon={BarChart3} />
        <StatCard title="Avg Tool Calls" value={result.avgToolCalls.toFixed(1)} icon={CheckCircle2} />
        <StatCard title="Avg Latency" value={`${result.avgLatency}ms`} icon={Timer} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Pass / Fail</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie data={pieData} dataKey="value" innerRadius={50} outerRadius={75} paddingAngle={3}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="ml-4 space-y-2">
              <div className="flex items-center gap-2 text-sm"><div className="h-3 w-3 rounded-full bg-success" />{passCount} passed</div>
              <div className="flex items-center gap-2 text-sm"><div className="h-3 w-3 rounded-full bg-destructive" />{failCount} failed</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Tool Usage</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={toolData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(38, 92%, 50%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Scenarios</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() =>
                openAssistantWithPrompt(
                  `Summarize the scenario results in this run. Highlight failed scenarios/checks first, then mention notable tool usage and extracted values.`
                )
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask Assistant
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {snapshotsUiEnabled && (
            <div className="flex flex-wrap items-end gap-2 border-b p-3">
              <div className="min-w-60 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Snapshot</p>
                <Select value={selectedSnapshotId} onValueChange={setSelectedSnapshotId}>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!selectedSnapshotId || comparing}
                onClick={() => void compareWithSnapshot()}
              >
                {comparing ? "Comparing..." : "Compare Snapshot"}
              </Button>
              {snapshotComparison && (
                <Badge variant="outline" className="h-8 px-2 py-0 text-xs">
                  Overall snapshot score: {snapshotComparison.overall_score}
                </Badge>
              )}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Scenario</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Pass Rate</TableHead>
                <TableHead>Avg Tool Calls</TableHead>
                <TableHead>Snapshot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.scenarios.map((sc) => {
                const rowKey = scenarioRowKey(sc.scenarioId, sc.agentName);
                return (
                <Collapsible key={rowKey} open={openScenarios.has(rowKey)} onOpenChange={() => toggle(rowKey)} asChild>
                  <>
                    <CollapsibleTrigger asChild>
                      <TableRow className="cursor-pointer hover:bg-muted/50">
                        <TableCell><ChevronDown className={`h-4 w-4 transition-transform ${openScenarios.has(rowKey) ? "rotate-180" : ""}`} /></TableCell>
                        <TableCell className="font-medium text-sm">{sc.scenarioName}</TableCell>
                        <TableCell className="text-sm">{sc.agentName}</TableCell>
                        <TableCell className="font-mono text-sm">{sc.runs.length}</TableCell>
                        <TableCell><PassRateBadge rate={sc.passRate} /></TableCell>
                        <TableCell className="font-mono text-sm">{sc.avgToolCalls.toFixed(1)}</TableCell>
                        <TableCell>
                          {(() => {
                            const row = comparisonByScenario.get(sc.scenarioId);
                            if (!row) return <span className="text-xs text-muted-foreground">—</span>;
                            const className =
                              row.status === "Match"
                                ? "bg-success/15 text-success"
                                : row.status === "Warn"
                                  ? "bg-amber-500/15 text-amber-600"
                                  : "bg-destructive/15 text-destructive";
                            return (
                              <Badge variant="outline" className={`text-xs ${className}`}>
                                {row.status} · {row.score}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                      </TableRow>
                    </CollapsibleTrigger>
                    <CollapsibleContent asChild>
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="bg-muted/30 p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold">Scenario details</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {sc.scenarioId} · {sc.agentName} · {Math.round(sc.passRate * 100)}% pass rate
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs shrink-0"
                                onClick={() =>
                                  openAssistantWithPrompt(
                                    `Explain why scenario '${sc.scenarioId}' failed (agent: ${sc.agentName}). Summarize the likely cause from the result details and suggest what to inspect next.`
                                  , { scenarioId: sc.scenarioId })
                                }
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                Ask Assistant
                              </Button>
                            </div>
                            {(() => {
                              const row = comparisonByScenario.get(sc.scenarioId);
                              if (!row || row.reasons.length === 0) return null;
                              return (
                                <div className="rounded-md border bg-card p-2">
                                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Snapshot reasons</p>
                                  <p className="mb-1 text-[11px] text-muted-foreground">
                                    Baseline agents: {row.baseline_agents.join(", ") || "—"} · observed agents: {row.observed_agents.join(", ") || "—"}
                                  </p>
                                  <ul className="space-y-1 text-xs text-muted-foreground">
                                    {row.reasons.map((reason, index) => (
                                      <li key={index}>• {reason}</li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })()}
                            {sc.runs.map((run) => (
                              <div key={run.runIndex} className="flex items-start gap-3 rounded-md border bg-card p-3 text-sm">
                                <div className="mt-0.5">
                                  {run.passed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                                </div>
                                <div className="flex-1 space-y-1">
                                  {(() => {
                                    const scenarioDef = scenarioDefinitionByResultId.get(sc.scenarioId);
                                    const checks = scenarioDef ? buildRunCheckItems(scenarioDef.evalRules, run.failureReasons) : [];
                                    const failedChecks = checks.filter((c) => c.status === "failed");
                                    const passedChecks = checks.filter((c) => c.status === "passed");
                                    return (
                                      <>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-xs text-muted-foreground">Run #{run.runIndex + 1}</span>
                                    <span className="text-xs text-muted-foreground">·</span>
                                    <span className="text-xs text-muted-foreground">{run.duration}ms</span>
                                    {!run.passed && (
                                      <Badge variant="outline" className="h-5 border-destructive/30 bg-destructive/10 text-destructive text-[10px]">
                                        Failed
                                      </Badge>
                                    )}
                                  </div>
                                  {run.failureReasons.length > 0 && (
                                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                                      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                                        <XCircle className="h-3.5 w-3.5" />
                                        Failure reasons
                                      </p>
                                      <ul className="space-y-1 text-xs text-destructive">
                                        {run.failureReasons.map((reason, index) => (
                                          <li key={index}>• {formatFailureReason(reason)}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {checks.length > 0 && (
                                    <div className="rounded-md border bg-muted/20 p-2">
                                      <div className="mb-2 flex flex-wrap items-center gap-2">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          Checks
                                        </p>
                                        <Badge
                                          variant="outline"
                                          className="h-5 border-success/30 bg-success/10 text-success text-[10px]"
                                        >
                                          {passedChecks.length} passed
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={`h-5 text-[10px] ${failedChecks.length > 0 ? "border-destructive/30 bg-destructive/10 text-destructive" : ""}`}
                                        >
                                          {failedChecks.length} failed
                                        </Badge>
                                      </div>
                                      <div className="space-y-1">
                                        {checks.map((check, idx) => (
                                          <div
                                            key={`${check.rule.type}-${check.rule.value}-${idx}`}
                                            className={`flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
                                              check.status === "failed"
                                                ? "border-destructive/20 bg-destructive/5"
                                                : "border-success/20 bg-success/5"
                                            }`}
                                          >
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2">
                                                {check.status === "failed" ? (
                                                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                                ) : (
                                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                                )}
                                                <span className="font-medium">{formatEvalRuleLabel(check.rule)}</span>
                                              </div>
                                              {check.failureReason && (
                                                <p className="mt-1 pl-5 text-[11px] text-destructive">
                                                  {formatFailureReason(check.failureReason)}
                                                </p>
                                              )}
                                            </div>
                                            <Badge
                                              variant="outline"
                                              className={`shrink-0 text-[10px] ${
                                                check.status === "failed"
                                                  ? "border-destructive/30 text-destructive"
                                                  : "border-success/30 text-success"
                                              }`}
                                            >
                                              {check.status}
                                            </Badge>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                      </>
                                    );
                                  })()}
                                  <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        <Layers className="h-3.5 w-3.5 text-violet-600" />
                                        Extracted values
                                      </p>
                                      <Badge variant="outline" className="h-5 text-[10px]">
                                        {Object.keys(run.extractedValues ?? {}).length} total
                                      </Badge>
                                    </div>
                                    {Object.keys(run.extractedValues ?? {}).length === 0 ? (
                                      <p className="text-xs text-muted-foreground">No extracted values captured for this run.</p>
                                    ) : (
                                      <div className="grid gap-1.5 sm:grid-cols-2">
                                        {Object.entries(run.extractedValues ?? {}).map(([key, value]) => (
                                          <div key={key} className="rounded-md border bg-background px-2 py-1.5 text-xs">
                                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                              {key}
                                            </div>
                                            <div className="font-mono break-all text-foreground">
                                              {value === null ? "null" : String(value)}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-2">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        <Wrench className="h-3.5 w-3.5 text-sky-600" />
                                        Tool call sequence
                                      </p>
                                      <Badge variant="outline" className="h-5 text-[10px]">
                                        {run.toolCalls.length} total
                                      </Badge>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {run.toolCalls.map((tc, i) => (
                                        <Badge key={i} variant="outline" className="font-mono text-xs bg-background">
                                          <span className="mr-1 text-muted-foreground">#{i + 1}</span>
                                          {tc.name}
                                          <span className="ml-1 text-muted-foreground">{tc.duration}ms</span>
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="rounded-md border border-muted-foreground/20 bg-card p-2">
                                    <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      <Bot className="h-3.5 w-3.5" />
                                      Final answer
                                    </p>
                                    <ExpandableText
                                      text={run.finalAnswer || "No final answer captured."}
                                      maxLength={1200}
                                      className="text-xs text-foreground"
                                    />
                                  </div>
                                  <div className="rounded-md border bg-muted/10 p-2">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Conversation trace
                                      </p>
                                      <div className="flex flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 px-2 text-xs"
                                          onClick={() => toggleConversation(runKey(sc.scenarioId, run.runIndex))}
                                        >
                                          {openConversations.has(runKey(sc.scenarioId, run.runIndex)) ? "Hide conversation" : "Show conversation"}
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 gap-1.5 px-2 text-xs"
                                          onClick={() =>
                                            openAssistantWithPrompt(
                                              `Explain Run #${run.runIndex + 1} for scenario '${sc.scenarioId}'. It ${run.passed ? "passed" : "failed"} in ${run.duration}ms. Focus on the tool sequence and ${run.passed ? "why it passed" : "what caused the failure"}.`
                                            , { scenarioId: sc.scenarioId })
                                          }
                                        >
                                          <Sparkles className="h-3.5 w-3.5" />
                                          Ask Assistant
                                        </Button>
                                      </div>
                                    </div>
                                    {openConversations.has(runKey(sc.scenarioId, run.runIndex)) ? (
                                      <div className="space-y-2 rounded-md border bg-muted/20 p-2">
                                        {run.conversation.length === 0 ? (
                                          <p className="text-xs text-muted-foreground">No conversation trace captured.</p>
                                        ) : (
                                          run.conversation.map((item) => (
                                            <ConversationRow
                                              key={item.id}
                                              item={item}
                                              fallbackUserPrompt={scenarioDefinitionByResultId.get(sc.scenarioId)?.prompt}
                                            />
                                          ))
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        Expand to inspect user/assistant/tool messages for this run.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              )})}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      </div>

      {assistantOpen && (
        <Card className="min-w-0 overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col">
          <CardHeader className="border-b px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  MCP Labs Assistant
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ask questions about this run result, failures, tool usage, and snapshot drift.
                </p>
                {assistantMeta && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Using {assistantMeta.assistantAgentName} ({assistantMeta.provider}/{assistantMeta.model})
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setAssistantExpanded((prev) => !prev)}
                >
                  {assistantExpanded ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                  {assistantExpanded ? "Compact" : "Expand"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setAssistantOpen(false)}
                >
                  Hide
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex h-[70vh] min-h-[520px] flex-col p-0 xl:h-auto xl:min-h-0 xl:flex-1">
            <ScrollArea className="min-h-0 flex-1 bg-muted/15 px-4 py-4">
              <div className="space-y-3 pr-2">
                {assistantMessages.map((message, index) => {
                  const isUser = message.role === "user";
                  const isAssistant = message.role === "assistant";
                  const isSystem = message.role === "system";
                  const isTool = message.role === "tool";
                  const canShowHandoff =
                    isAssistant &&
                    isScenarioAssistantHandoffRelevant(message.text, Boolean(assistantContextScenarioId));
                  return (
                    <div key={message.id ?? `${message.role}-${index}`} className={`flex items-start gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                      {!isUser && (
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                          <Bot className="h-3 w-3" />
                        </div>
                      )}
                      <div className={`max-w-[92%] rounded-md border p-3 text-sm ${
                        isUser
                          ? "border-primary/20 bg-primary/10"
                          : isSystem
                            ? "border-amber-400/30 bg-amber-50/70"
                            : isTool
                              ? "border-blue-300/30 bg-blue-50/50"
                              : "border-border/80 bg-background shadow-sm"
                      }`}>
                        <p className={`mb-2 text-[11px] font-semibold text-muted-foreground ${isUser ? "text-right" : ""}`}>
                          {isUser ? "You" : isSystem ? "System" : isTool ? "Tool" : "Assistant"}
                        </p>
                        <MarkdownText text={message.text} className="text-sm" />
                        {canShowHandoff && (
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() => sendToScenarioAssistant(message.text)}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Send to Scenario Assistant
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() => openApplyReportDialog(message.text)}
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              Apply: Write Markdown Report
                            </Button>
                          </div>
                        )}
                        {!canShowHandoff && isAssistant && (
                          <div className="mt-3 flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() => openApplyReportDialog(message.text)}
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              Apply: Write Markdown Report
                            </Button>
                          </div>
                        )}
                      </div>
                      {isUser && (
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
                          <User className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                  );
                })}
                {assistantPendingToolCalls.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Pending actions (approve/deny)
                    </div>
                    {assistantPendingToolCalls.map((call) => (
                      <div key={call.id} className="rounded-md border bg-background p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold">{call.publicToolName}</p>
                            <p className="text-xs text-muted-foreground">
                              {call.server}::{call.tool}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={assistantLoading}
                              onClick={() => void denyResultAssistantToolCall(call.id)}
                            >
                              Deny
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={assistantLoading}
                              onClick={() => void approveResultAssistantToolCall(call.id)}
                            >
                              Approve
                            </Button>
                          </div>
                        </div>
                        <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/50 p-2 text-xs">
                          <code>{JSON.stringify(call.arguments ?? {}, null, 2)}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
                {assistantLoading && (
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                      <Bot className="h-3 w-3" />
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={assistantChatEndRef} />
              </div>
            </ScrollArea>
            <div className="border-t bg-background px-4 py-3">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={assistantInputRef}
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  placeholder="Ask about this result..."
                  rows={1}
                  className="min-h-10 max-h-40 resize-none text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!assistantLoading) void askResultAssistant();
                    }
                  }}
                />
                <Button type="button" className="shrink-0" onClick={() => void askResultAssistant()} disabled={assistantLoading || !assistantInput.trim()}>
                  Ask
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <AlertDialog open={applyReportOpen} onOpenChange={(open) => !applyReportPending && setApplyReportOpen(open)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve MCP action: write markdown report</AlertDialogTitle>
            <AlertDialogDescription>
              This will call <code>mcplab_write_markdown_report</code> via the local MCPLab MCP server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Output path</p>
              <Input
                value={applyReportOutputPath}
                onChange={(e) => setApplyReportOutputPath(e.target.value)}
                placeholder="mcplab/reports/result-assistant/my-report.md"
                disabled={applyReportPending}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={applyReportOverwrite}
                onCheckedChange={(v) => setApplyReportOverwrite(v === true)}
                disabled={applyReportPending}
              />
              <span>Overwrite if file exists</span>
            </label>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Markdown preview (to be written)</p>
              <Textarea
                value={applyReportMarkdown}
                onChange={(e) => setApplyReportMarkdown(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                disabled={applyReportPending}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyReportPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void applyAssistantReport();
              }}
              disabled={applyReportPending}
            >
              {applyReportPending ? "Writing..." : "Approve & Write"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
};

function ConversationRow({ item, fallbackUserPrompt }: { item: ConversationItem; fallbackUserPrompt?: string }) {
  if (item.kind === "tool_call") {
    return (
      <ToolEventRow
        variant="call"
        title={`Tool call · ${item.toolName || "unknown"}`}
        text={item.text}
      />
    );
  }
  if (item.kind === "tool_result") {
    const statusIcon = item.ok ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-rose-700 dark:text-rose-300" />
    );
    return (
      <ToolEventRow
        variant={item.ok ? "result_ok" : "result_error"}
        title={`Tool result · ${item.toolName || "unknown"} · ${item.ok ? "ok" : "error"}${typeof item.durationMs === "number" ? ` · ${item.durationMs}ms` : ""}`}
        text={item.text}
        icon={statusIcon}
      />
    );
  }

  const isUser = item.kind === "user_prompt";
  const normalizedItemText = normalizeConversationText(item.text, item.kind);
  const normalizedFallbackUserPrompt = fallbackUserPrompt
    ? normalizeConversationText(fallbackUserPrompt, "user_prompt")
    : "";
  const displayText =
    isUser && normalizedFallbackUserPrompt.length > normalizedItemText.length
      ? normalizedFallbackUserPrompt
      : normalizedItemText;
  const label = isUser ? "User prompt" : item.kind === "assistant_final" ? "Agent final" : "Agent";
  const Icon = isUser ? User : Bot;
  return (
    <div className={`flex items-start gap-2 text-xs ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Icon className="h-3 w-3" />
        </div>
      )}
      <div className={`max-w-[90%] rounded-md p-2 ${isUser ? "bg-primary/10" : "bg-muted/50"}`}>
        <p className={`mb-1 text-[11px] font-semibold text-muted-foreground ${isUser ? "text-right" : ""}`}>{label}</p>
        {isUser ? (
          <ExpandableText text={displayText} maxLength={280} className="text-xs" />
        ) : (
          <ExpandableText text={displayText} maxLength={500} className="text-xs" />
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
          <Icon className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

function normalizeConversationText(text: string, kind: ConversationItem["kind"]): string {
  const raw = String(text ?? "");
  const trimmedStart = raw.replace(/^\s+/, "");
  if (kind === "user_prompt") {
    return trimmedStart.replace(/^user:\s*/i, "");
  }
  if (kind === "assistant_final" || kind === "assistant_thought") {
    return trimmedStart.replace(/^assistant:\s*/i, "");
  }
  return trimmedStart;
}

function isScenarioAssistantHandoffRelevant(reply: string, hasScenarioContext: boolean): boolean {
  if (!hasScenarioContext) return false;
  const text = String(reply ?? "").toLowerCase();
  if (!text.trim()) return false;

  const editSignals = [
    "check",
    "checks",
    "rule",
    "rules",
    "regex",
    "pattern",
    "value capture",
    "extract rule",
    "update",
    "change",
    "replace",
    "modify",
    "adjust",
    "use ",
    "set ",
  ];
  const concreteSuggestionSignals = [
    "change ",
    "replace ",
    "update ",
    "use ",
    "set the",
    "suggested",
    "you should",
    "try ",
    "text match failed",
    "text must match pattern",
  ];
  const explanationOnlySignals = [
    "i can only read",
    "i don't have write access",
    "i cannot directly edit",
    "what happened",
    "summary",
  ];

  if (explanationOnlySignals.some((s) => text.includes(s)) && !concreteSuggestionSignals.some((s) => text.includes(s))) {
    return false;
  }

  const hasEditSignal = editSignals.some((s) => text.includes(s));
  const hasConcreteSuggestion = concreteSuggestionSignals.some((s) => text.includes(s));
  const hasListStructure = /(^|\n)\s*[-*]\s+/.test(reply) || /(^|\n)\s*\d+\.\s+/.test(reply);
  const hasQuotedPattern = /["'`][^"'`\n]{2,}["'`]/.test(reply);

  return hasEditSignal && (hasConcreteSuggestion || hasListStructure || hasQuotedPattern);
}

function ToolEventRow({
  variant,
  title,
  text,
  icon
}: {
  variant: "call" | "result_ok" | "result_error";
  title: string;
  text: string;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const styleByVariant = {
    call: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    result_ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    result_error: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  } as const;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-md border p-2 text-xs ${styleByVariant[variant]}`}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left">
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              {icon ?? <Wrench className="h-3.5 w-3.5" />}
              <span>{title}</span>
            </div>
            <span className="text-[11px] font-semibold">{open ? "Hide content" : "Show content"}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 font-mono whitespace-pre-wrap text-foreground">{text}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ExpandableText({ text, maxLength, className }: { text: string; maxLength: number; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxLength;
  const display = expanded || !isLong ? text : `${text.slice(0, maxLength)}...`;

  return (
    <div>
      <MarkdownText text={display} className={className} />
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; lang?: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] };

function MarkdownText({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {blocks.map((block, index) => renderMarkdownBlock(block, index))}
    </div>
  );
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      continue;
    }

    const codeMatch = trimmed.match(/^```(\w+)?\s*$/);
    if (codeMatch) {
      const codeLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        if (lines[j].trim().startsWith("```")) break;
        codeLines.push(lines[j]);
      }
      blocks.push({ type: "code", lang: codeMatch[1], code: codeLines.join("\n") });
      i = j;
      continue;
    }

    if (looksLikeMarkdownTable(lines, i)) {
      const headers = splitTableRow(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) {
        rows.push(splitTableRow(lines[j]));
        j += 1;
      }
      blocks.push({ type: "table", headers, rows });
      i = j - 1;
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const items = [orderedMatch[2]];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].trim().match(/^\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        j += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      i = j - 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const items = [bulletMatch[1]];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].trim().match(/^[-*+]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        j += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      i = j - 1;
      continue;
    }

    const paragraphLines = [line];
    let j = i + 1;
    while (j < lines.length) {
      const nextTrimmed = lines[j].trim();
      if (
        !nextTrimmed ||
        /^---+$/.test(nextTrimmed) ||
        /^#{1,4}\s+/.test(nextTrimmed) ||
        looksLikeMarkdownTable(lines, j) ||
        /^\d+\.\s+/.test(nextTrimmed) ||
        /^[-*+]\s+/.test(nextTrimmed) ||
        /^```/.test(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(lines[j]);
      j += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
    i = j - 1;
  }

  return blocks.length > 0 ? blocks : [{ type: "paragraph", text }];
}

function looksLikeMarkdownTable(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = lines[index].trim();
  const separator = lines[index + 1].trim();
  if (!header.includes("|")) return false;
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(separator);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownBlock(block: MarkdownBlock, index: number) {
  if (block.type === "hr") {
    return <hr key={`hr-${index}`} className="border-border/60" />;
  }
  if (block.type === "heading") {
    const className =
      block.level === 1
        ? "text-sm font-semibold"
        : block.level === 2
          ? "text-xs font-semibold"
          : "text-xs font-medium";
    return (
      <h4 key={`h-${index}`} className={className}>
        {renderInlineMarkdown(block.text, `${index}-h`)}
      </h4>
    );
  }
  if (block.type === "paragraph") {
    return (
      <p key={`p-${index}`} className="whitespace-pre-wrap leading-relaxed">
        {renderInlineMarkdown(block.text, `${index}-p`)}
      </p>
    );
  }
  if (block.type === "code") {
    return (
      <div key={`code-${index}`} className="rounded-md border bg-muted/70">
        {block.lang && (
          <div className="border-b px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {block.lang}
          </div>
        )}
        <pre className="max-h-64 overflow-auto p-2 text-[11px]">
          <code>{block.code}</code>
        </pre>
      </div>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag
        key={`list-${index}`}
        className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-li-${itemIndex}`} className="leading-relaxed">
            {renderInlineMarkdown(item, `${index}-li-${itemIndex}`)}
          </li>
        ))}
      </Tag>
    );
  }
  if (block.type === "table") {
    return (
      <div key={`table-${index}`} className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[420px] border-collapse text-[11px]">
          <thead className="bg-muted/40">
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th
                  key={`${index}-th-${headerIndex}`}
                  className="border-b px-2 py-1 text-left font-semibold align-top"
                >
                  {renderInlineMarkdown(header, `${index}-thc-${headerIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-row-${rowIndex}`} className="border-t">
                {row.map((cell, cellIndex) => (
                  <td key={`${index}-td-${rowIndex}-${cellIndex}`} className="px-2 py-1 align-top">
                    {renderInlineMarkdown(cell, `${index}-tdc-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

function renderInlineMarkdown(text: string, keyBase: string): React.ReactNode[] {
  const parts = text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g)
    .filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyBase}-${index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyBase}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${keyBase}-${index}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <Fragment key={`${keyBase}-${index}`}>{part}</Fragment>;
  });
}

function buildRunCheckItems(evalRules: EvalRule[], failureReasons: string[]) {
  return evalRules.map((rule) => {
    const failureReason = matchFailureReasonForRule(rule, failureReasons);
    return {
      rule,
      status: failureReason ? ("failed" as const) : ("passed" as const),
      failureReason
    };
  });
}

function matchFailureReasonForRule(rule: EvalRule, failureReasons: string[]): string | undefined {
  const expectedPrefix =
    rule.type === "required_tool"
      ? `Required tool not used: ${rule.value}`
      : rule.type === "forbidden_tool"
        ? `Forbidden tool used: ${rule.value}`
        : `Regex assertion failed: ${rule.value}`;

  const exact = failureReasons.find((reason) => reason === expectedPrefix);
  if (exact) return exact;

  if (rule.type === "response_contains" || rule.type === "response_not_contains") {
    return failureReasons.find(
      (reason) =>
        reason.startsWith("Regex assertion failed:") &&
        reason.includes(rule.value)
    );
  }

  return undefined;
}

function formatEvalRuleLabel(rule: EvalRule): string {
  if (rule.type === "required_tool") return `Required tool · ${rule.value}`;
  if (rule.type === "forbidden_tool") return `Forbidden tool · ${rule.value}`;
  if (rule.type === "response_contains") return `Text must match pattern · ${rule.value}`;
  if (rule.type === "response_not_contains") return `Text must not match pattern · ${rule.value}`;
  return `${rule.type} · ${rule.value}`;
}

function formatFailureReason(reason: string): string {
  const trimmed = String(reason ?? "").trim();
  const regexMatch = trimmed.match(/^Regex assertion failed:\s*(.+)$/i);
  if (regexMatch) {
    return `Text match failed: ${regexMatch[1]}`;
  }
  return trimmed;
}

export default ResultDetail;
