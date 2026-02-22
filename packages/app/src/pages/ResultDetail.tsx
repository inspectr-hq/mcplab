import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Activity, BarChart3, Timer, Layers, CheckCircle2, XCircle, ChevronDown, Download, User, Bot, Wrench, GitCompare, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { PassRateBadge } from "@/components/PassRateBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { generateHtmlReport } from "@/lib/generate-html-report";
import { useDataSource } from "@/contexts/DataSourceContext";
import { useConfigs } from "@/contexts/ConfigContext";
import { toast } from "@/hooks/use-toast";
import type { ConversationItem, EvalResult } from "@/types/eval";
import type { SnapshotComparison, SnapshotRecord } from "@/lib/data-sources/types";

const ResultDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { source } = useDataSource();
  const { configs } = useConfigs();
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

  useEffect(() => {
    if (!id) return;
    let active = true;
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

  const toggle = (sid: string) => {
    setOpenScenarios((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
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
  const scenarioKey = (scenarioId: string, agent: string) => `${scenarioId}::${agent}`;
  const comparisonByScenario = new Map(
    (snapshotComparison?.scenario_results ?? []).map((item) => [scenarioKey(item.scenario_id, item.agent), item])
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

  const reviewDrift = async () => {
    const baselineId = result.snapshotEval?.baselineSnapshotId;
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
        void reviewDrift();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link to="/results"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-mono">{result.id}</h1>
            <PassRateBadge rate={result.overallPassRate} />
            {result.snapshotEval?.applied && (
              <Badge variant="outline" className="text-xs">
                Snapshot policy · {result.snapshotEval.mode} · {result.snapshotEval.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(result.timestamp).toLocaleString()} · Config hash: <span className="font-mono">{result.configHash}</span>
          </p>
          {result.snapshotEval?.applied && (
            <p className="text-xs text-muted-foreground">
              Baseline: <span className="font-mono">{result.snapshotEval.baselineSnapshotId}</span> · score: {result.snapshotEval.overallScore}
            </p>
          )}
        </div>
        {result.snapshotEval?.applied && (
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
      </div>

      {result.snapshotEval?.applied && (
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
        <CardHeader className="pb-3"><CardTitle className="text-base">Scenarios</CardTitle></CardHeader>
        <CardContent className="p-0">
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
              {result.scenarios.map((sc) => (
                <Collapsible key={sc.scenarioId} open={openScenarios.has(sc.scenarioId)} onOpenChange={() => toggle(sc.scenarioId)} asChild>
                  <>
                    <CollapsibleTrigger asChild>
                      <TableRow className="cursor-pointer hover:bg-muted/50">
                        <TableCell><ChevronDown className={`h-4 w-4 transition-transform ${openScenarios.has(sc.scenarioId) ? "rotate-180" : ""}`} /></TableCell>
                        <TableCell className="font-medium text-sm">{sc.scenarioName}</TableCell>
                        <TableCell className="text-sm">{sc.agentName}</TableCell>
                        <TableCell className="font-mono text-sm">{sc.runs.length}</TableCell>
                        <TableCell><PassRateBadge rate={sc.passRate} /></TableCell>
                        <TableCell className="font-mono text-sm">{sc.avgToolCalls.toFixed(1)}</TableCell>
                        <TableCell>
                          {(() => {
                            const row = comparisonByScenario.get(scenarioKey(sc.scenarioId, sc.agentName));
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
                            {(() => {
                              const row = comparisonByScenario.get(scenarioKey(sc.scenarioId, sc.agentName));
                              if (!row || row.reasons.length === 0) return null;
                              return (
                                <div className="rounded-md border bg-card p-2">
                                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Snapshot reasons</p>
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
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-muted-foreground">Run #{run.runIndex + 1}</span>
                                    <span className="text-xs text-muted-foreground">·</span>
                                    <span className="text-xs text-muted-foreground">{run.duration}ms</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {run.toolCalls.map((tc, i) => (
                                      <Badge key={i} variant="outline" className="font-mono text-xs">
                                        <span className="mr-1 text-muted-foreground">#{i + 1}</span>
                                        {tc.name}
                                        <span className="ml-1 text-muted-foreground">{tc.duration}ms</span>
                                      </Badge>
                                    ))}
                                  </div>
                                  <div className="rounded-md border bg-muted/20 p-2">
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Final answer
                                    </p>
                                    <p className="text-xs text-foreground whitespace-pre-wrap">
                                      {run.finalAnswer || "No final answer captured."}
                                    </p>
                                  </div>
                                  <div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => toggleConversation(runKey(sc.scenarioId, run.runIndex))}
                                    >
                                      {openConversations.has(runKey(sc.scenarioId, run.runIndex)) ? "Hide conversation" : "Show conversation"}
                                    </Button>
                                  </div>
                                  {openConversations.has(runKey(sc.scenarioId, run.runIndex)) && (
                                    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
                                      {run.conversation.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No conversation trace captured.</p>
                                      ) : (
                                        run.conversation.map((item) => (
                                          <ConversationRow key={item.id} item={item} />
                                        ))
                                      )}
                                    </div>
                                  )}
                                  {run.failureReasons.length > 0 && (
                                    <p className="text-xs text-destructive">{run.failureReasons.join(", ")}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

function ConversationRow({ item }: { item: ConversationItem }) {
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
  const label = isUser ? "User prompt" : item.kind === "assistant_final" ? "Assistant final" : "Assistant";
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
          <p className="whitespace-pre-wrap">{item.text}</p>
        ) : (
          <ExpandableText text={item.text} maxLength={500} className="whitespace-pre-wrap" />
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
      <p className={className}>{display}</p>
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

export default ResultDetail;
