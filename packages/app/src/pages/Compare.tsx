import { useEffect, useMemo, useState } from "react";
import { GitCompare, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PassRateBadge } from "@/components/PassRateBadge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDataSource } from "@/contexts/DataSourceContext";
import type { EvalResult } from "@/types/eval";

const colors = ["hsl(38, 92%, 50%)", "hsl(200, 80%, 50%)", "hsl(152, 69%, 40%)", "hsl(280, 60%, 50%)", "hsl(0, 72%, 51%)"];

const Compare = () => {
  const { source } = useDataSource();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"id" | "timestamp" | "passRate" | "scenarios">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let active = true;
    source.listResults().then((next) => {
      if (active) setResults(next);
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
      next.has(id) ? next.delete(id) : next.add(id);
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

  // All scenario IDs across selected runs
  const allScenarioIds = [...new Set(selectedRuns.flatMap((r) => r.scenarios.map((s) => s.scenarioId)))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Compare Runs</h1>
        <p className="text-sm text-muted-foreground">Select 2–5 runs to compare</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Select Runs</CardTitle></CardHeader>
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
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.timestamp).toLocaleString()}</TableCell>
                  <TableCell><PassRateBadge rate={r.overallPassRate} /></TableCell>
                  <TableCell className="font-mono text-sm">{r.totalScenarios}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedRuns.length >= 2 && (
        <>
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
                    <TableCell className="font-medium">Avg Tool Calls</TableCell>
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
    </div>
  );
};

export default Compare;
