import { Link } from "react-router-dom";
import { Settings, Play, BarChart3, Clock, Activity, Layers, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { PassRateBadge } from "@/components/PassRateBadge";
import { mockConfigs, mockResults } from "@/data/mock-data";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const Dashboard = () => {
  const totalConfigs = mockConfigs.length;
  const totalRuns = mockResults.length;
  const overallPassRate = mockResults.reduce((s, r) => s + r.overallPassRate, 0) / mockResults.length;
  const avgLatency = Math.round(mockResults.reduce((s, r) => s + r.avgLatency, 0) / mockResults.length);

  const recentRuns = [...mockResults].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const chartData = [...recentRuns].reverse().map((r) => ({
    date: new Date(r.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    passRate: Math.round(r.overallPassRate * 100),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your MCP evaluation runs</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Configurations" value={totalConfigs} icon={Layers} subtitle={`${totalConfigs} active`} />
        <StatCard title="Total Runs" value={totalRuns} icon={Activity} subtitle="Last 30 days" />
        <StatCard title="Pass Rate" value={`${Math.round(overallPassRate * 100)}%`} icon={BarChart3} subtitle="+5% from last week" trend="up" />
        <StatCard title="Avg Latency" value={`${avgLatency}ms`} icon={Timer} subtitle="-120ms from last week" trend="up" />
      </div>

      {/* Quick actions */}
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Runs table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Runs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Pass Rate</TableHead>
                  <TableHead className="text-right">Scenarios</TableHead>
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

        {/* Pass Rate chart */}
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
      </div>
    </div>
  );
};

export default Dashboard;
