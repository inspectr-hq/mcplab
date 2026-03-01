import { useEffect, useMemo, useState } from "react";
import { GitCompare, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PassRateBadge } from "@/components/PassRateBadge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDataSource } from "@/contexts/DataSourceContext";
import { isUiFeatureEnabled } from "@/lib/feature-flags";
import type { EvalResult } from "@/types/eval";
import type { SnapshotComparison, SnapshotRecord } from "@/lib/data-sources/types";

const colors = ["hsl(38, 92%, 50%)", "hsl(200, 80%, 50%)", "hsl(152, 69%, 40%)", "hsl(280, 60%, 50%)", "hsl(0, 72%, 51%)"];

const Compare = () => {
  const { source } = useDataSource();
  const snapshotsUiEnabled = isUiFeatureEnabled("snapshots", false);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"id" | "timestamp" | "passRate" | "scenarios">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [mode, setMode] = useState<"runs" | "snapshot">("runs");
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [runId, setRunId] = useState("");
  const [snapshotComparison, setSnapshotComparison] = useState<SnapshotComparison | null>(null);

  useEffect(() => {
    let active = true;
    source.listResults().then((next) => {
      if (active) setResults(next);
    });
    return () => {
      active = false;
    };
  }, [source]);

  useEffect(() => {
    let active = true;
    source
      .listSnapshots()
      .then((next) => {
        if (active) setSnapshots(next);
      })
      .catch(() => {
        if (active) setSnapshots([]);
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

  const sortedResults = useMemo(() => {
    const next = [...results].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "id") cmp = a.id.localeCompare(b.id);
      if (sortBy === "timestamp") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === "passRate") cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === "scenarios") cmp = a.totalScenarios - b.totalScenarios;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [results, sortBy, sortDir]);

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

  // All scenario IDs across selected runs
  const allScenarioIds = [...new Set(selectedRuns.flatMap((r) => r.scenarios.map((s) => s.scenarioId)))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <GitCompare className="h-6 w-6" />
          Compare Runs
        </h1>
        <p className="text-sm text-muted-foreground">Select 2–5 runs to compare</p>
      </div>

      {/*<Card>*/}
      {/*  <CardContent className="pt-6">*/}
      {/*    <div className="flex flex-wrap gap-2">*/}
      {/*      <Button*/}
      {/*        type="button"*/}
      {/*        variant={mode === "runs" ? "default" : "outline"}*/}
      {/*        size="sm"*/}
      {/*        onClick={() => setMode("runs")}*/}
      {/*      >*/}
      {/*        Run vs Run*/}
      {/*      </Button>*/}
      {/*      {snapshotsUiEnabled && (*/}
      {/*        <Button*/}
      {/*          type="button"*/}
      {/*          variant={mode === "snapshot" ? "default" : "outline"}*/}
      {/*          size="sm"*/}
      {/*          onClick={() => setMode("snapshot")}*/}
      {/*        >*/}
      {/*          Run vs Snapshot*/}
      {/*        </Button>*/}
      {/*      )}*/}
      {/*    </div>*/}
      {/*  </CardContent>*/}
      {/*</Card>*/}

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

      {snapshotsUiEnabled && mode === "snapshot" && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Run vs Snapshot</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Run</p>
                <Select value={runId} onValueChange={setRunId}>
                  <SelectTrigger><SelectValue placeholder="Select run" /></SelectTrigger>
                  <SelectContent>
                    {results.map((run) => (
                      <SelectItem key={run.id} value={run.id}>{run.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Snapshot</p>
                <Select value={snapshotId} onValueChange={setSnapshotId}>
                  <SelectTrigger><SelectValue placeholder="Select snapshot" /></SelectTrigger>
                  <SelectContent>
                    {snapshots.map((snapshot) => (
                      <SelectItem key={snapshot.id} value={snapshot.id}>{snapshot.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!runId || !snapshotId}
              onClick={() => {
                source.compareSnapshot(snapshotId, runId).then(setSnapshotComparison);
              }}
            >
              Compare
            </Button>
            {snapshotComparison && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Overall score: {snapshotComparison.overall_score}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scenario</TableHead>
                      <TableHead>Agents</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reasons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshotComparison.scenario_results.map((row) => (
                      <TableRow key={row.scenario_id}>
                        <TableCell>{row.scenario_id}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          baseline: {row.baseline_agents.join(", ") || "—"} · observed: {row.observed_agents.join(", ") || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.score}</TableCell>
                        <TableCell>{row.status}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.reasons.slice(0, 2).join("; ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Compare;
