import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Settings, Play, BarChart3, Clock, Activity, Layers, Timer, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { PassRateBadge } from "@/components/PassRateBadge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useConfigs } from "@/contexts/ConfigContext";
import { useDataSource } from "@/contexts/DataSourceContext";
import type { EvalResult } from "@/types/eval";

const Dashboard = () => {
  const { configs } = useConfigs();
  const { source } = useDataSource();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [sortBy, setSortBy] = useState<"timestamp" | "passRate" | "latency" | "scenarios">("timestamp");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir("desc");
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

  const totalConfigs = configs.length;
  const totalRuns = results.length;
  const overallPassRate = totalRuns === 0 ? 0 : results.reduce((s, r) => s + r.overallPassRate, 0) / totalRuns;
  const avgLatency = totalRuns === 0 ? 0 : Math.round(results.reduce((s, r) => s + r.avgLatency, 0) / totalRuns);

  const recentRuns = useMemo(() => {
    const sorted = [...results].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "timestamp") cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === "passRate") cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === "latency") cmp = a.avgLatency - b.avgLatency;
      if (sortBy === "scenarios") cmp = a.totalScenarios - b.totalScenarios;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [results, sortBy, sortDir]);

  const chartData = [...recentRuns].reverse().map((r) => ({
    date: new Date(r.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    passRate: Math.round(r.overallPassRate * 100),
    latency: r.avgLatency,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your MCP evaluation runs</p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/configs/new"><Settings className="mr-2 h-4 w-4" />New Config</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/run"><Play className="mr-2 h-4 w-4" />Run Evaluation</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/results"><BarChart3 className="mr-2 h-4 w-4" />Browse Results</Link>
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Configurations" value={totalConfigs} icon={Layers} subtitle={`${totalConfigs} active`} />
        <StatCard title="Total Runs" value={totalRuns} icon={Activity} subtitle="Last 30 days" />
        <StatCard title="Pass Rate" value={`${Math.round(overallPassRate * 100)}%`} icon={BarChart3} subtitle="+5% from last week" trend="up" />
        <StatCard title="Avg Latency" value={`${avgLatency}ms`} icon={Timer} subtitle="-120ms from last week" trend="up" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pass Rate Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Pass Rate"]} />
                <Line type="monotone" dataKey="passRate" stroke="hsl(38, 92%, 50%)" strokeWidth={2} dot={{ r: 3, fill: "hsl(38, 92%, 50%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Tool Latency (ms)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [`${v}ms`, "Latency"]} />
                <Line type="monotone" dataKey="latency" stroke="hsl(200, 80%, 50%)" strokeWidth={2} dot={{ r: 3, fill: "hsl(200, 80%, 50%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Runs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("timestamp")}>
                      Timestamp
                      {sortBy === "timestamp" ? (
                        sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("passRate")}>
                      Pass Rate
                      {sortBy === "passRate" ? (
                        sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("scenarios")}>
                      Scenarios
                      {sortBy === "scenarios" ? (
                        sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((run) => (
                  <TableRow key={run.id} className="cursor-pointer">
                    <TableCell>
                      <Link to={`/results/${run.id}`} className="font-mono text-xs text-primary hover:underline">
                        {run.id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(run.timestamp).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell><PassRateBadge rate={run.overallPassRate} /></TableCell>
                    <TableCell className="text-right font-mono text-sm">{run.totalScenarios}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
