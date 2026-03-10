import { useEffect, useMemo, useState } from "react";
import { GitCompare, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PassRateBadge } from "@/components/PassRateBadge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDataSource } from "@/contexts/DataSourceContext";
import type { EvalResult, ScenarioResult, ScenarioRun } from "@/types/eval";
import { toast } from "@/hooks/use-toast";

const colors = ["hsl(38, 92%, 50%)", "hsl(200, 80%, 50%)", "hsl(152, 69%, 40%)", "hsl(280, 60%, 50%)", "hsl(0, 72%, 51%)"];

type CompareMode = "runs" | "within-run";

type AgentSummary = {
  agentId: string;
  agentName: string;
  passRate: number;
  totalRuns: number;
  avgToolCalls: number;
  avgLatency: number;
};

type WithinRunScenarioRow = {
  scenarioId: string;
  scenarioName: string;
  displayLabel: string;
  byAgent: Record<string, ScenarioResult | undefined>;
};

const Compare = () => {
  const { source } = useDataSource();
  const [searchParams, setSearchParams] = useSearchParams();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"id" | "timestamp" | "passRate" | "scenarios">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [scenarioFilter, setScenarioFilter] = useState("all");

  const initialModeParam = searchParams.get("mode");
  const initialMode: CompareMode = initialModeParam === "within-run" ? "within-run" : "runs";
  const initialWithinRunId = searchParams.get("runId") ?? "";
  const initialWithinRunAgents = (searchParams.get("agents") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const initialWithinRunScenario = searchParams.get("scenario") ?? "all";

  const [mode, setMode] = useState<CompareMode>(initialMode);
  const [withinRunId, setWithinRunId] = useState(initialWithinRunId);
  const [withinRunAgentIds, setWithinRunAgentIds] = useState<string[]>(initialWithinRunAgents);
  const [withinRunScenarioFilter, setWithinRunScenarioFilter] = useState(initialWithinRunScenario);

  const loadResults = async () => {
    setRefreshing(true);
    try {
      setResults(await source.listResults());
    } catch (error: unknown) {
      toast({
        title: "Could not load results",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive"
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    source
      .listResults()
      .then((next) => {
        if (active) setResults(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast({
          title: "Could not load results",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive"
        });
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [source]);

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir(next === "timestamp" ? "desc" : "asc");
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scenarioFilterOptions = useMemo(() => {
    const labels = new Set<string>();
    results.forEach((run) => {
      run.scenarios.forEach((scenario) => {
        const scenarioName = String(scenario.scenarioName ?? "").trim();
        const scenarioId = String(scenario.scenarioId ?? "").trim();
        const label = scenarioName || scenarioId;
        if (label) labels.add(label);
      });
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filteredResults = useMemo(() => {
    if (scenarioFilter === "all") return results;
    return results.filter((run) =>
      run.scenarios.some((scenario) => {
        const scenarioName = String(scenario.scenarioName ?? "").trim();
        const scenarioId = String(scenario.scenarioId ?? "").trim();
        const label = scenarioName || scenarioId;
        return label === scenarioFilter;
      })
    );
  }, [results, scenarioFilter]);

  const sortedResults = useMemo(() => {
    const next = [...filteredResults].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "id") cmp = a.id.localeCompare(b.id);
      if (sortBy === "timestamp") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === "passRate") cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === "scenarios") cmp = a.totalScenarios - b.totalScenarios;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [filteredResults, sortBy, sortDir]);

  const selectedRuns = sortedResults.filter((r) => selected.has(r.id));
  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const runScopeSummary = (r: EvalResult) => {
    const scenarioIds = Array.from(new Set(r.scenarios.map((s) => s.scenarioId).filter(Boolean)));
    const agentNames = Array.from(new Set(r.scenarios.map((s) => s.agentName).filter(Boolean)));
    const scenarioPreview = scenarioIds.slice(0, 2).join(", ");
    const scenarioRemainder = scenarioIds.length > 2 ? ` +${scenarioIds.length - 2}` : "";
    return {
      scenarioCount: scenarioIds.length,
      agentCount: agentNames.length,
      scenarioPreview: scenarioPreview ? `${scenarioPreview}${scenarioRemainder}` : "n/a"
    };
  };

  const defaultAgentsForRun = (run: EvalResult): string[] => {
    const agentIds = Array.from(new Set(run.scenarios.map((scenario) => scenario.agentId).filter(Boolean)));
    return agentIds.slice(0, Math.min(2, agentIds.length));
  };

  const startWithinRunFromRun = (run: EvalResult) => {
    setMode("within-run");
    setWithinRunId(run.id);
    setWithinRunAgentIds(defaultAgentsForRun(run));
    setWithinRunScenarioFilter("all");
  };

  const allScenarioIds = [...new Set(selectedRuns.flatMap((r) => r.scenarios.map((s) => s.scenarioId)))];

  const withinRun = useMemo(
    () => results.find((result) => result.id === withinRunId),
    [results, withinRunId]
  );

  const withinRunAgentOptions = useMemo(() => {
    if (!withinRun) return [];
    const map = new Map<string, string>();
    for (const scenario of withinRun.scenarios) {
      map.set(scenario.agentId, scenario.agentName || scenario.agentId);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [withinRun]);

  const withinRunScenarioOptions = useMemo(() => {
    if (!withinRun) return [];
    const labels = new Set<string>();
    for (const scenario of withinRun.scenarios) {
      const name = String(scenario.scenarioName ?? "").trim();
      const id = String(scenario.scenarioId ?? "").trim();
      const label = name || id;
      if (label) labels.add(label);
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [withinRun]);

  useEffect(() => {
    if (mode !== "within-run") return;
    if (results.length === 0) return;

    let nextRunId = withinRunId;
    if (!nextRunId || !results.some((run) => run.id === nextRunId)) {
      nextRunId = results[0]!.id;
    }
    const nextRun = results.find((run) => run.id === nextRunId);
    const nextAgentOptions = (() => {
      if (!nextRun) return [];
      const map = new Map<string, string>();
      for (const scenario of nextRun.scenarios) {
        map.set(scenario.agentId, scenario.agentName || scenario.agentId);
      }
      return Array.from(map.keys());
    })();
    const validAgentSet = new Set(nextAgentOptions);
    let nextAgents = withinRunAgentIds.filter((id) => validAgentSet.has(id));
    if (nextAgents.length === 0 && nextAgentOptions.length > 0) {
      nextAgents = nextAgentOptions.slice(0, Math.min(2, nextAgentOptions.length));
    }
    const nextScenarioOptions = (() => {
      if (!nextRun) return [];
      const labels = new Set<string>();
      for (const scenario of nextRun.scenarios) {
        const name = String(scenario.scenarioName ?? "").trim();
        const id = String(scenario.scenarioId ?? "").trim();
        const label = name || id;
        if (label) labels.add(label);
      }
      return new Set(labels);
    })();
    const nextScenarioFilter =
      withinRunScenarioFilter !== "all" && !nextScenarioOptions.has(withinRunScenarioFilter)
        ? "all"
        : withinRunScenarioFilter;

    if (nextRunId !== withinRunId) setWithinRunId(nextRunId);
    if (nextAgents.join(",") !== withinRunAgentIds.join(",")) setWithinRunAgentIds(nextAgents);
    if (nextScenarioFilter !== withinRunScenarioFilter) setWithinRunScenarioFilter(nextScenarioFilter);
  }, [mode, results, withinRunId, withinRunAgentIds, withinRunScenarioFilter]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (mode === "within-run") {
      next.set("mode", "within-run");
      if (withinRunId) next.set("runId", withinRunId);
      else next.delete("runId");
      if (withinRunAgentIds.length > 0) next.set("agents", withinRunAgentIds.join(","));
      else next.delete("agents");
      if (withinRunScenarioFilter !== "all") next.set("scenario", withinRunScenarioFilter);
      else next.delete("scenario");
    } else {
      next.delete("mode");
      next.delete("runId");
      next.delete("agents");
      next.delete("scenario");
    }
    const currentString = searchParams.toString();
    const nextString = next.toString();
    if (currentString !== nextString) {
      setSearchParams(next, { replace: true });
    }
  }, [mode, withinRunId, withinRunAgentIds, withinRunScenarioFilter, searchParams, setSearchParams]);

  const withinRunScenarioRows = useMemo<WithinRunScenarioRow[]>(() => {
    if (!withinRun) return [];
    const scenarioMap = new Map<string, WithinRunScenarioRow>();
    for (const scenario of withinRun.scenarios) {
      const scenarioId = String(scenario.scenarioId ?? "").trim();
      const scenarioName = String(scenario.scenarioName ?? "").trim();
      const displayLabel = scenarioName || scenarioId;
      if (!scenarioId && !displayLabel) continue;
      const key = scenarioId || displayLabel;
      const existing = scenarioMap.get(key);
      if (existing) {
        existing.byAgent[scenario.agentId] = scenario;
        continue;
      }
      scenarioMap.set(key, {
        scenarioId: scenarioId || displayLabel,
        scenarioName,
        displayLabel: displayLabel || scenarioId,
        byAgent: { [scenario.agentId]: scenario }
      });
    }
    const rows = Array.from(scenarioMap.values()).sort((a, b) => {
      const left = (a.displayLabel || a.scenarioId).toLowerCase();
      const right = (b.displayLabel || b.scenarioId).toLowerCase();
      return left.localeCompare(right);
    });
    if (withinRunScenarioFilter === "all") return rows;
    return rows.filter((row) => row.displayLabel === withinRunScenarioFilter);
  }, [withinRun, withinRunScenarioFilter]);

  const selectedWithinRunAgentOptions = useMemo(() => {
    const optionMap = new Map(withinRunAgentOptions.map((option) => [option.id, option]));
    return withinRunAgentIds
      .map((id) => optionMap.get(id))
      .filter((option): option is { id: string; name: string } => Boolean(option));
  }, [withinRunAgentIds, withinRunAgentOptions]);

  const withinRunComparePair = useMemo(() => {
    if (!withinRun || selectedWithinRunAgentOptions.length !== 2) return null;
    const [left, right] = selectedWithinRunAgentOptions;
    return {
      left,
      right,
      link: `/compare/results?left=${encodeURIComponent(withinRun.id)}&right=${encodeURIComponent(withinRun.id)}&leftConfig=${encodeURIComponent(withinRun.configId)}&rightConfig=${encodeURIComponent(withinRun.configId)}&leftAgent=${encodeURIComponent(left.id)}&rightAgent=${encodeURIComponent(right.id)}`
    };
  }, [withinRun, selectedWithinRunAgentOptions]);

  const withinRunAgentSummary = useMemo<AgentSummary[]>(() => {
    if (!withinRun || selectedWithinRunAgentOptions.length === 0) return [];
    return selectedWithinRunAgentOptions.map((agent) => {
      const relatedScenarios = withinRunScenarioRows
        .map((row) => row.byAgent[agent.id])
        .filter((value): value is ScenarioResult => Boolean(value));
      const runs = relatedScenarios.flatMap((scenario) => scenario.runs);
      const totalRuns = runs.length;
      const passCount = runs.filter((run) => run.passed).length;
      const totalToolCalls = runs.reduce((sum, run) => sum + run.toolCalls.length, 0);
      const totalDuration = runs.reduce((sum, run) => sum + run.duration, 0);
      return {
        agentId: agent.id,
        agentName: agent.name,
        passRate: totalRuns === 0 ? 0 : passCount / totalRuns,
        totalRuns,
        avgToolCalls: totalRuns === 0 ? 0 : totalToolCalls / totalRuns,
        avgLatency: totalRuns === 0 ? 0 : totalDuration / totalRuns
      };
    });
  }, [withinRun, selectedWithinRunAgentOptions, withinRunScenarioRows]);

  const toggleWithinRunAgent = (agentId: string) => {
    setWithinRunAgentIds((prev) => {
      if (prev.includes(agentId)) {
        return prev.filter((id) => id !== agentId);
      }
      return [...prev, agentId];
    });
  };

  const renderRunDetail = (run: ScenarioRun) => (
    <div key={run.runIndex} className="rounded border bg-muted/20 px-2 py-1.5">
      <div className="text-xs">
        <span className="font-mono">#{run.runIndex + 1}</span>{" "}
        <span className={run.passed ? "text-emerald-700" : "text-destructive"}>
          {run.passed ? "PASS" : "FAIL"}
        </span>{" "}
        · tools: {run.toolCalls.length} · {run.duration}ms
      </div>
      {!run.passed && run.failureReasons.length > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {run.failureReasons.join("; ")}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <GitCompare className="h-6 w-6" />
            Compare Runs
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "runs" ? "Select 2–5 runs to compare" : "Compare agents side-by-side within one run"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "runs" && (
            <Select value={scenarioFilter} onValueChange={setScenarioFilter}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Filter by scenario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scenarios</SelectItem>
                {scenarioFilterOptions.map((label) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => void loadResults()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === "runs" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("runs")}
            >
              Run vs Run
            </Button>
          </div>
        </CardContent>
      </Card>

      {mode === "within-run" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Within One Run Controls</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => setMode("runs")}>
                Back to run list
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Run</p>
                <Select value={withinRunId} onValueChange={setWithinRunId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select run" />
                  </SelectTrigger>
                  <SelectContent>
                    {results.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {run.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Scenario filter</p>
                <Select value={withinRunScenarioFilter} onValueChange={setWithinRunScenarioFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All scenarios" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All scenarios</SelectItem>
                    {withinRunScenarioOptions.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Agents (select 2+)</p>
              <div className="flex flex-wrap gap-3 rounded-md border p-3">
                {withinRunAgentOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">No agents available for selected run.</p>
                )}
                {withinRunAgentOptions.map((agent) => (
                  <label key={agent.id} className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={withinRunAgentIds.includes(agent.id)}
                      onCheckedChange={() => toggleWithinRunAgent(agent.id)}
                    />
                    <span>{agent.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "runs" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("id")}>
                      Run ID
                      {sortIcon("id")}
                    </button>
                  </TableHead>
                  <TableHead>Evaluated</TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("timestamp")}>
                      Timestamp
                      {sortIcon("timestamp")}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("passRate")}>
                      Pass Rate
                      {sortIcon("passRate")}
                    </button>
                  </TableHead>
                <TableHead>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("scenarios")}>
                    Scenarios
                    {sortIcon("scenarios")}
                  </button>
                </TableHead>
                <TableHead>Agents</TableHead>
                <TableHead className="w-[140px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
                {sortedResults.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggle(r.id)}
                        disabled={!selected.has(r.id) && selected.size >= 5}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.id}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {(() => {
                        const scope = runScopeSummary(r);
                        return (
                          <div className="space-y-0.5">
                            <div>
                              Evaluated: {scope.scenarioCount} scenario{scope.scenarioCount === 1 ? "" : "s"} · {scope.agentCount} agent{scope.agentCount === 1 ? "" : "s"}
                            </div>
                            <div className="font-mono text-xs text-foreground/80">{scope.scenarioPreview}</div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.timestamp).toLocaleString()}</TableCell>
                    <TableCell><PassRateBadge rate={r.overallPassRate} /></TableCell>
                    <TableCell className="font-mono text-sm">{r.totalScenarios}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {runScopeSummary(r).agentCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {runScopeSummary(r).agentCount > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startWithinRunFromRun(r)}
                        >
                          Compare agents
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {mode === "runs" && selectedRuns.length >= 2 && (
        <>
          {selectedRuns.length === 2 && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Need a deeper comparison?</p>
                    <p className="text-xs text-muted-foreground">
                      Open the two selected runs in a dedicated side-by-side full result compare view.
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link
                      to={`/compare/results?left=${encodeURIComponent(selectedRuns[0].id)}&right=${encodeURIComponent(selectedRuns[1].id)}&leftConfig=${encodeURIComponent(selectedRuns[0].configId)}&rightConfig=${encodeURIComponent(selectedRuns[1].configId)}`}
                    >
                      Compare full results
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Summary Comparison</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    {selectedRuns.map((r, i) => (
                      <TableHead key={r.id} style={{ color: colors[i] }} className="font-mono text-xs">{r.id}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Pass Rate</TableCell>
                    {selectedRuns.map((r) => <TableCell key={r.id}><PassRateBadge rate={r.overallPassRate} /></TableCell>)}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Total Runs</TableCell>
                    {selectedRuns.map((r) => <TableCell key={r.id} className="font-mono">{r.totalRuns}</TableCell>)}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Tool Calls</TableCell>
                    {selectedRuns.map((r) => <TableCell key={r.id} className="font-mono">{r.avgToolCalls.toFixed(1)}</TableCell>)}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Avg Latency</TableCell>
                    {selectedRuns.map((r) => <TableCell key={r.id} className="font-mono">{r.avgLatency}ms</TableCell>)}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Scenario Breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scenario</TableHead>
                    {selectedRuns.map((r, i) => (
                      <TableHead key={r.id} style={{ color: colors[i] }} className="font-mono text-xs">{r.id}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allScenarioIds.map((sid) => (
                    <TableRow key={sid}>
                      <TableCell className="font-medium text-sm">{sid}</TableCell>
                      {selectedRuns.map((r) => {
                        const sc = r.scenarios.find((s) => s.scenarioId === sid);
                        return <TableCell key={r.id}>{sc ? <PassRateBadge rate={sc.passRate} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {mode === "runs" && selectedRuns.length >= 2 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pass Rate Trend</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={selectedRuns.map((r, i) => ({ idx: i + 1, runId: r.id, passRate: Number((r.overallPassRate * 100).toFixed(1)) }))}>
                <XAxis dataKey="idx" tickFormatter={(v) => String(v)} />
                <YAxis unit="%" domain={[0, 100]} />
                <Tooltip formatter={(value) => [`${value}%`, "Pass Rate"]} labelFormatter={(label) => `Run ${label}`} />
                <Legend />
                <Line type="monotone" dataKey="passRate" stroke={colors[0]} strokeWidth={2.5} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {mode === "within-run" && withinRun && selectedWithinRunAgentOptions.length < 2 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Select at least 2 agents to compare side-by-side within this run.
          </CardContent>
        </Card>
      )}

      {mode === "within-run" && withinRun && selectedWithinRunAgentOptions.length >= 2 && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Need full result details?</p>
                  <p className="text-xs text-muted-foreground">
                    {withinRunComparePair
                      ? "Open a side-by-side full result view filtered by the selected agents."
                      : "Open the complete run result page for all details and trace navigation."}
                  </p>
                </div>
                <Button asChild size="sm">
                  {withinRunComparePair ? (
                    <Link to={withinRunComparePair.link}>Compare full results</Link>
                  ) : (
                    <Link
                      to={`/results/${encodeURIComponent(withinRun.id)}${withinRun.configId ? `?configId=${encodeURIComponent(withinRun.configId)}` : ""}`}
                    >
                      Open full result
                    </Link>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agent Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    {withinRunAgentSummary.map((summary) => (
                      <TableHead key={summary.agentId} className="font-mono text-xs">
                        {summary.agentName}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Pass Rate</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId}>
                        <PassRateBadge rate={summary.passRate} />
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Total Runs</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId} className="font-mono">
                        {summary.totalRuns}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Avg Tool Calls</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId} className="font-mono">
                        {summary.avgToolCalls.toFixed(1)}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Avg Latency</TableCell>
                    {withinRunAgentSummary.map((summary) => (
                      <TableCell key={summary.agentId} className="font-mono">
                        {Math.round(summary.avgLatency)}ms
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scenario × Agent Matrix</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[260px]">Scenario</TableHead>
                    {selectedWithinRunAgentOptions.map((agent) => (
                      <TableHead key={agent.id} className="font-mono text-xs">
                        {agent.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withinRunScenarioRows.map((row) => (
                    <TableRow key={row.scenarioId}>
                      <TableCell className="font-medium text-sm">{row.displayLabel}</TableCell>
                      {selectedWithinRunAgentOptions.map((agent) => {
                        const scenario = row.byAgent[agent.id];
                        if (!scenario) {
                          return (
                            <TableCell key={agent.id}>
                              <span className="text-xs text-muted-foreground">—</span>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={agent.id} className="align-top">
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground">
                                <PassRateBadge rate={scenario.passRate} />{" "}
                                <span className="ml-2">runs: {scenario.runs.length}</span>{" "}
                                · calls: {scenario.avgToolCalls.toFixed(1)} · latency: {Math.round(scenario.avgDuration)}ms
                              </div>
                              {scenario.runs.length > 0 ? (
                                <div className="space-y-1.5">
                                  {scenario.runs.map((run) => renderRunDetail(run))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">No runs captured.</div>
                              )}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Compare;
