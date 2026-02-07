import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Activity, BarChart3, Timer, Layers, CheckCircle2, XCircle, ChevronDown, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { PassRateBadge } from "@/components/PassRateBadge";
import { mockResults } from "@/data/mock-data";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useState } from "react";
import { generateHtmlReport } from "@/lib/generate-html-report";

const ResultDetail = () => {
  const { id } = useParams<{ id: string }>();
  const result = mockResults.find((r) => r.id === id);
  const [openScenarios, setOpenScenarios] = useState<Set<string>>(new Set());

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link to="/results"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-mono">{result.id}</h1>
            <PassRateBadge rate={result.overallPassRate} />
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(result.timestamp).toLocaleString()} · Config hash: <span className="font-mono">{result.configHash}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => {
          const html = generateHtmlReport(result);
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `mcp-eval-report-${result.id}.html`;
          a.click();
          URL.revokeObjectURL(url);
        }}>
          <Download className="h-3.5 w-3.5" />Download Report
        </Button>
      </div>

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Scenario</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Pass Rate</TableHead>
                <TableHead>Avg Tool Calls</TableHead>
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
                      </TableRow>
                    </CollapsibleTrigger>
                    <CollapsibleContent asChild>
                      <tr>
                        <td colSpan={6} className="p-0">
                          <div className="bg-muted/30 p-4 space-y-2">
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
                                      <Badge key={i} variant="outline" className="font-mono text-xs">{tc.name} <span className="ml-1 text-muted-foreground">{tc.duration}ms</span></Badge>
                                    ))}
                                  </div>
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

export default ResultDetail;
