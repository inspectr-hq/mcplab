import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, MoreHorizontal, Eye, Download, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PassRateBadge } from "@/components/PassRateBadge";
import { useDataSource } from "@/contexts/DataSourceContext";
import { toast } from "@/hooks/use-toast";
import type { EvalResult } from "@/types/eval";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Results = () => {
  const { source } = useDataSource();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [sortBy, setSortBy] = useState<"id" | "timestamp" | "passRate" | "scenarios" | "avgToolCalls">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [scenarioFilter, setScenarioFilter] = useState("all");

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir(next === "timestamp" ? "desc" : "asc");
  };

  const loadResults = async () => {
    setRefreshing(true);
    try {
      setResults(await source.listResults());
    } catch (error: unknown) {
      toast({
        title: "Could not load results",
        description: (error instanceof Error ? error.message : String(error)),
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
          description: (error instanceof Error ? error.message : String(error)),
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

  const sorted = useMemo(() => {
    const next = [...filteredResults].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "id") cmp = a.id.localeCompare(b.id);
      if (sortBy === "timestamp") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === "passRate") cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === "scenarios") cmp = a.totalScenarios - b.totalScenarios;
      if (sortBy === "avgToolCalls") cmp = a.avgToolCalls - b.avgToolCalls;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [filteredResults, sortBy, sortDir]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const runScopeSummary = (r: EvalResult) => {
    const scenarioLabels = Array.from(
      new Map(
        r.scenarios
          .map((s) => {
            const id = String(s.scenarioId ?? "").trim();
            const name = String(s.scenarioName ?? "").trim();
            if (!id && !name) return null;
            return [id || name, name || id] as const;
          })
          .filter((entry): entry is readonly [string, string] => Boolean(entry))
      ).values()
    );
    const agentNames = Array.from(new Set(r.scenarios.map((s) => s.agentName).filter(Boolean)));
    const scenarioPreview = scenarioLabels.slice(0, 2).join(", ");
    const scenarioRemainder = scenarioLabels.length > 2 ? ` +${scenarioLabels.length - 2}` : "";
    return {
      scenarioCount: scenarioLabels.length,
      agentCount: agentNames.length,
      scenarioPreview: scenarioPreview ? `${scenarioPreview}${scenarioRemainder}` : "n/a"
    };
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRun(true);
    try {
      await source.deleteResult(runId);
      setResults((prev) => prev.filter((r) => r.id !== runId));
      toast({ title: "Run deleted", description: runId });
      setPendingDeleteRunId(null);
    } catch (error: unknown) {
      toast({
        title: "Could not delete run",
        description: (error instanceof Error ? error.message : String(error)),
        variant: "destructive"
      });
    } finally {
      setDeletingRun(false);
    }
  };

  return (
    <div className="space-y-6">
      <AlertDialog open={pendingDeleteRunId !== null} onOpenChange={(open) => {
        if (!open && !deletingRun) setPendingDeleteRunId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the run artifacts from disk for{" "}
              <span className="font-mono">{pendingDeleteRunId ?? ""}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRun}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingRun || !pendingDeleteRunId}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDeleteRunId) return;
                void handleDeleteRun(pendingDeleteRunId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingRun ? "Deleting..." : "Delete run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <BarChart3 className="h-6 w-6" />
            Results
          </h1>
          <p className="text-sm text-muted-foreground">Browse evaluation runs and open detailed results</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" onClick={() => void loadResults()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableHead>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("avgToolCalls")}>
                    Avg Tool Calls
                    {sortIcon("avgToolCalls")}
                  </button>
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <Link to={`/results/${r.id}`} className="font-mono text-xs text-primary hover:underline">{r.id}</Link>
                      {r.configId ? <div className="text-[11px] text-muted-foreground">{r.configId}</div> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {(() => {
                      const scope = runScopeSummary(r);
                      return (
                        <div className="space-y-0.5">
                          <div>
                            Evaluated: {scope.scenarioCount} scenario{scope.scenarioCount === 1 ? "" : "s"} · {scope.agentCount} agent{scope.agentCount === 1 ? "" : "s"}
                          </div>
                          <div className="font-mono text-xs text-foreground/80">
                            {scope.scenarioPreview}
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(r.timestamp).toLocaleString()}</div>
                  </TableCell>
                  <TableCell><PassRateBadge rate={r.overallPassRate} /></TableCell>
                  <TableCell className="font-mono text-sm">{r.totalScenarios}</TableCell>
                  <TableCell className="font-mono text-sm">{r.avgToolCalls.toFixed(0)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild><Link to={`/results/${r.id}`}><Eye className="mr-2 h-3.5 w-3.5" />View</Link></DropdownMenuItem>
                        <DropdownMenuItem><Download className="mr-2 h-3.5 w-3.5" />Export JSON</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={(e) => {
                            e.preventDefault();
                            setPendingDeleteRunId(r.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Results;
