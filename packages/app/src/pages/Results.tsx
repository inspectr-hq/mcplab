import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, MoreHorizontal, Eye, Download, Trash2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PassRateBadge } from "@/components/PassRateBadge";
import { useDataSource } from "@/contexts/DataSourceContext";
import type { EvalResult } from "@/types/eval";

const Results = () => {
  const { source } = useDataSource();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [sortBy, setSortBy] = useState<"id" | "timestamp" | "passRate" | "scenarios" | "avgToolCalls">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir(next === "timestamp" ? "desc" : "asc");
  };

  useEffect(() => {
    let active = true;
    source.listResults().then((next) => {
      if (active) setResults(next);
    });
    return () => {
      active = false;
    };
  }, [source]);

  const sorted = useMemo(() => {
    const next = [...results].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "id") cmp = a.id.localeCompare(b.id);
      if (sortBy === "timestamp") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === "passRate") cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === "scenarios") cmp = a.totalScenarios - b.totalScenarios;
      if (sortBy === "avgToolCalls") cmp = a.avgToolCalls - b.avgToolCalls;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [results, sortBy, sortDir]);

  const sortIcon = (key: typeof sortBy) => {
    if (sortBy !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Results</h1>
        <p className="text-sm text-muted-foreground">Browse and compare evaluation results</p>
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
                <TableHead>Config Hash</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/results/${r.id}`} className="font-mono text-xs text-primary hover:underline">{r.id}</Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(r.timestamp).toLocaleString()}</div>
                  </TableCell>
                  <TableCell><PassRateBadge rate={r.overallPassRate} /></TableCell>
                  <TableCell className="font-mono text-sm">{r.totalScenarios}</TableCell>
                  <TableCell className="font-mono text-sm">{r.avgToolCalls.toFixed(1)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.configHash.slice(0, 8)}…</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild><Link to={`/results/${r.id}`}><Eye className="mr-2 h-3.5 w-3.5" />View</Link></DropdownMenuItem>
                        <DropdownMenuItem><Download className="mr-2 h-3.5 w-3.5" />Export JSON</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive"><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</DropdownMenuItem>
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
