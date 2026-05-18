import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Play,
  BarChart3,
  Clock,
  Activity,
  Layers,
  Timer,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { StatCard } from '@/components/StatCard';
import { PassRateBadge } from '@/components/PassRateBadge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useConfigs } from '@/contexts/ConfigContext';
import { useDataSource } from '@/contexts/DataSourceContext';
import type { EvalResult } from '@/types/eval';
import { buildRunScopeSummary } from '@/lib/run-scope-summary';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSigned(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

const Dashboard = () => {
  const { configs } = useConfigs();
  const { source } = useDataSource();
  const [loading, setLoading] = useState(true);
  const [last30DayResults, setLast30DayResults] = useState<EvalResult[]>([]);
  const [currentWeekResults, setCurrentWeekResults] = useState<EvalResult[]>([]);
  const [previousWeekResults, setPreviousWeekResults] = useState<EvalResult[]>([]);
  const [sortBy, setSortBy] = useState<'timestamp' | 'passRate' | 'latency' | 'scenarios'>(
    'timestamp'
  );
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const toggleSort = (next: typeof sortBy) => {
    if (sortBy === next) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(next);
    setSortDir('desc');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    const nowMs = Date.now();
    const last30SinceMs = nowMs - 30 * 24 * 60 * 60 * 1000;
    const currentSinceMs = nowMs - WEEK_MS;
    const previousSinceMs = currentSinceMs - WEEK_MS;
    const last30Since = new Date(last30SinceMs).toISOString();
    const currentSince = new Date(currentSinceMs).toISOString();
    const previousSince = new Date(previousSinceMs).toISOString();
    const previousUntil = new Date(currentSinceMs - 1).toISOString();
    const currentUntil = new Date(nowMs).toISOString();

    Promise.all([
      source.listResults({ since: last30Since, until: currentUntil }),
      source.listResults({ since: currentSince, until: currentUntil }),
      source.listResults({ since: previousSince, until: previousUntil })
    ])
      .then(([last30WindowResults, currentWindowResults, previousWindowResults]) => {
        if (!active) return;
        setLast30DayResults(last30WindowResults);
        setCurrentWeekResults(currentWindowResults);
        setPreviousWeekResults(previousWindowResults);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source]);

  const totalConfigs = configs.length;
  const totalRuns = last30DayResults.length;
  const overallPassRate =
    currentWeekResults.length === 0
      ? 0
      : currentWeekResults.reduce((s, r) => s + r.overallPassRate, 0) / currentWeekResults.length;
  const avgLatency =
    currentWeekResults.length === 0
      ? 0
      : Math.round(
          currentWeekResults.reduce((s, r) => s + r.avgLatency, 0) / currentWeekResults.length
        );
  const previousWeekPassRate = average(previousWeekResults.map((run) => run.overallPassRate));
  const previousWeekAvgLatency = average(previousWeekResults.map((run) => run.avgLatency));
  const passRateDeltaPp = (overallPassRate - previousWeekPassRate) * 100;
  const latencyDeltaMs = avgLatency - previousWeekAvgLatency;
  const hasPreviousWeekBaseline = previousWeekResults.length > 0;
  const passRateSubtitle = hasPreviousWeekBaseline
    ? `${formatSigned(passRateDeltaPp, 1)}% from last week`
    : 'No prior-week baseline';
  const latencySubtitle = hasPreviousWeekBaseline
    ? `${formatSigned(latencyDeltaMs, 0)}ms from last week`
    : 'No prior-week baseline';
  const passRateTrend = hasPreviousWeekBaseline
    ? passRateDeltaPp > 0
      ? ('up' as const)
      : passRateDeltaPp < 0
      ? ('down' as const)
      : ('neutral' as const)
    : ('neutral' as const);
  const latencyTrend = hasPreviousWeekBaseline
    ? latencyDeltaMs < 0
      ? ('up' as const)
      : latencyDeltaMs > 0
      ? ('down' as const)
      : ('neutral' as const)
    : ('neutral' as const);

  const recentRuns = useMemo(() => {
    const sorted = [...last30DayResults].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'timestamp')
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortBy === 'passRate') cmp = a.overallPassRate - b.overallPassRate;
      if (sortBy === 'latency') cmp = a.avgLatency - b.avgLatency;
      if (sortBy === 'scenarios') cmp = a.totalScenarios - b.totalScenarios;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [last30DayResults, sortBy, sortDir]);
  const recentRunsPreview = recentRuns.slice(0, 20);

  const formatToolTokenTotal = (result: EvalResult) => {
    const total = result.toolTokenUsage?.totalTokens;
    return typeof total === 'number' ? total.toLocaleString() : 'n/a';
  };

  const chartData = [...recentRuns].reverse().map((r) => ({
    date: new Date(r.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    passRate: Math.round(r.overallPassRate * 100),
    latency: r.avgLatency
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
            <LayoutDashboard className="h-6 w-6" />
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">Overview of your MCP evaluation runs</p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/mcp-evaluations/new">
              <Settings className="mr-2 h-4 w-4" />
              New MCP Evaluation
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/run">
              <Play className="mr-2 h-4 w-4" />
              Run Evaluation
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/results">
              <BarChart3 className="mr-2 h-4 w-4" />
              Browse Results
            </Link>
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="MCP Evaluations"
          value={totalConfigs}
          icon={Layers}
          subtitle={`${totalConfigs} active`}
        />
        <StatCard title="Total Runs" value={totalRuns} icon={Activity} subtitle="Last 30 days" />
        <StatCard
          title="Pass Rate"
          value={loading ? '—' : `${Math.round(overallPassRate * 100)}%`}
          icon={BarChart3}
          subtitle={loading ? 'Loading...' : passRateSubtitle}
          trend={loading ? 'neutral' : passRateTrend}
        />
        <StatCard
          title="Avg Latency"
          value={loading ? '—' : `${avgLatency}ms`}
          icon={Timer}
          subtitle={loading ? 'Loading...' : latencySubtitle}
          trend={loading ? 'neutral' : latencyTrend}
        />
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
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Pass Rate']} />
                <Line
                  type="monotone"
                  dataKey="passRate"
                  stroke="hsl(38, 92%, 50%)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'hsl(38, 92%, 50%)' }}
                />
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
                <Tooltip formatter={(v: number) => [`${v}ms`, 'Latency']} />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke="hsl(200, 80%, 50%)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'hsl(200, 80%, 50%)' }}
                />
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
                  <TableHead>Evaluated</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('timestamp')}
                    >
                      Timestamp
                      {sortBy === 'timestamp' ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-end gap-1 hover:text-foreground"
                      onClick={() => toggleSort('passRate')}
                    >
                      Pass Rate
                      {sortBy === 'passRate' ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort('scenarios')}
                    >
                      Scenarios
                      {sortBy === 'scenarios' ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Avg Tool Calls</TableHead>
                  <TableHead className="text-right">Tool Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRunsPreview.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No runs in the past 30 days.
                    </TableCell>
                  </TableRow>
                )}
                {recentRunsPreview.map((run) => (
                  <TableRow key={run.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to={`/results/${run.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {run.id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {(() => {
                        const scope = buildRunScopeSummary(run);
                        return (
                          <div className="space-y-0.5">
                            <div>
                              Evaluated: {scope.scenarioCount} scenario
                              {scope.scenarioCount === 1 ? '' : 's'} · {scope.agentCount} agent
                              {scope.agentCount === 1 ? '' : 's'}
                              {scope.modelSummary ? ` · ${scope.modelSummary}` : ''}
                            </div>
                            <div className="font-mono text-xs text-foreground/80">
                              {scope.scopePreview}
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(run.timestamp).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <PassRateBadge rate={run.overallPassRate} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {run.totalScenarios}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {run.avgToolCalls.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatToolTokenTotal(run)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {recentRuns.length > 20 && (
              <div className="border-t p-4 text-center">
                <Button variant="outline" asChild>
                  <Link to="/results">Show more</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
