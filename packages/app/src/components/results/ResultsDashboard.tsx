import { useMemo } from 'react';
import { Activity, BarChart3, CheckCircle2, Clock, Layers, Timer, Wrench } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { StatCard } from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationMs } from '@/lib/run-duration';
import type { EvalResult } from '@/types/eval';

type ResultsDashboardProps = {
  runs: EvalResult[];
  loading: boolean;
};

const PASS_COLOR = 'hsl(152, 69%, 40%)';
const FAIL_COLOR = 'hsl(0, 72%, 51%)';

function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits
  });
}

export default function ResultsDashboard({ runs, loading }: ResultsDashboardProps) {
  const summary = useMemo(() => {
    const totalRuns = runs.reduce((sum, run) => sum + Math.max(0, run.totalRuns), 0);
    const passedRuns = runs.reduce(
      (sum, run) => sum + Math.round(Math.max(0, run.totalRuns) * run.overallPassRate),
      0
    );
    const failedRuns = Math.max(0, totalRuns - passedRuns);
    const totalScenarios = runs.reduce((sum, run) => sum + Math.max(0, run.totalScenarios), 0);
    const weighted = (selector: (run: EvalResult) => number) =>
      totalRuns === 0
        ? 0
        : runs.reduce((sum, run) => sum + selector(run) * Math.max(0, run.totalRuns), 0) /
          totalRuns;
    const totalTokens = runs.reduce((sum, run) => sum + (run.toolTokenUsage?.totalTokens ?? 0), 0);
    const totalDurationMs = runs.reduce((sum, run) => sum + (run.totalDurationMs ?? 0), 0);
    const totalToolDurationMs = runs.reduce((sum, run) => sum + (run.totalToolDurationMs ?? 0), 0);
    return {
      totalRuns,
      passedRuns,
      failedRuns,
      totalScenarios,
      passRate: totalRuns === 0 ? 0 : passedRuns / totalRuns,
      avgToolCalls: weighted((run) => run.avgToolCalls),
      avgLatency: weighted((run) => run.avgLatency),
      totalTokens,
      totalDurationMs,
      totalToolDurationMs,
      outcomeData: [
        { name: 'Passed', value: passedRuns, color: PASS_COLOR },
        { name: 'Failed', value: failedRuns, color: FAIL_COLOR }
      ]
    };
  }, [runs]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Calculating dashboard…
        </CardContent>
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No results in the selected range.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="results-dashboard">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="p-2.5 pb-0">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pass / Fail
            </CardTitle>
          </CardHeader>
          <CardContent className="flex h-[108px] items-center justify-center gap-2 p-0">
            <div className="h-[108px] w-[108px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.outcomeData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="78%"
                    paddingAngle={3}
                  >
                    {summary.outcomeData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <div className="h-3 w-3 rounded-full bg-success" />
                {formatNumber(summary.passedRuns)} passed
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="h-3 w-3 rounded-full bg-destructive" />
                {formatNumber(summary.failedRuns)} failed
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid self-start content-start gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4">
          <StatCard
            compact
            title="Scenarios"
            value={formatNumber(summary.totalScenarios)}
            icon={Layers}
          />
          <StatCard
            compact
            title="Total Runs"
            value={formatNumber(summary.totalRuns)}
            icon={Activity}
          />
          <StatCard
            compact
            title="Pass Rate"
            value={`${formatNumber(summary.passRate * 100, 1)}%`}
            icon={BarChart3}
          />
          <StatCard
            compact
            title="Avg Tool Calls"
            value={formatNumber(summary.avgToolCalls, 1)}
            icon={CheckCircle2}
          />
          <StatCard
            compact
            title="Avg Latency"
            value={`${formatNumber(summary.avgLatency)}ms`}
            icon={Timer}
          />
          <StatCard
            compact
            title="Tool Tokens"
            value={formatNumber(summary.totalTokens)}
            icon={Wrench}
          />
          {summary.totalDurationMs > 0 ? (
            <StatCard
              compact
              title="Total Time"
              value={formatDurationMs(summary.totalDurationMs)}
              icon={Clock}
            />
          ) : null}
          {summary.totalToolDurationMs > 0 ? (
            <StatCard
              compact
              title="Tool Duration"
              value={formatDurationMs(summary.totalToolDurationMs)}
              icon={Clock}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
