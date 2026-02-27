import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, Lightbulb } from "lucide-react";
import type { ToolAnalysisReport } from "@/lib/data-sources/types";

const ALL_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
type FindingSeverity = (typeof ALL_SEVERITIES)[number];

function severityBadgeClass(severity: FindingSeverity): string {
  switch (severity) {
    case "critical":
      return "border-red-300 bg-red-100 text-red-900";
    case "high":
      return "border-orange-300 bg-orange-100 text-orange-900";
    case "medium":
      return "border-amber-300 bg-amber-100 text-amber-900";
    case "low":
      return "border-sky-300 bg-sky-100 text-sky-900";
    default:
      return "border-slate-300 bg-slate-100 text-slate-800";
  }
}

function severityBadgeInactiveClass(severity: FindingSeverity): string {
  switch (severity) {
    case "critical":
      return "border-red-300 bg-background text-red-900";
    case "high":
      return "border-orange-300 bg-background text-orange-900";
    case "medium":
      return "border-amber-300 bg-background text-amber-900";
    case "low":
      return "border-sky-300 bg-background text-sky-900";
    default:
      return "border-slate-300 bg-background text-slate-800";
  }
}

function SuggestionCallout({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded-md border px-2.5 py-2 text-[11px] text-slate-800">
      <div className="mb-1 inline-flex items-center gap-1 font-medium text-slate-700">
        <Lightbulb className="h-3.5 w-3.5" />
        Suggested improvement
      </div>
      <p>{text}</p>
    </div>
  );
}

export function toolAnalysisReportToMarkdown(report: ToolAnalysisReport): string {
  const lines: string[] = [];
  lines.push(`# MCP Tool Analysis Report`, "");
  lines.push(`- Created: ${report.createdAt}`);
  lines.push(`- Assistant Agent: ${report.assistantAgentName}`);
  lines.push(`- Assistant Model: ${report.assistantAgentModel}`);
  lines.push(
    `- Modes: ${[
      report.modes.metadataReview ? "metadata review" : null,
      report.modes.deeperAnalysis ? "deeper analysis" : null
    ].filter(Boolean).join(" + ")}`
  );
  lines.push("", `## Summary`);
  lines.push(`- Servers analyzed: ${report.summary.serversAnalyzed}`);
  lines.push(`- Tools analyzed: ${report.summary.toolsAnalyzed}`);
  lines.push(`- Tools skipped: ${report.summary.toolsSkipped}`, "");
  for (const server of report.servers) {
    lines.push(`## Server: ${server.serverName}`);
    if (server.warnings.length > 0) {
      lines.push(...server.warnings.map((w) => `- Warning: ${w}`), "");
    }
    for (const tool of server.tools) {
      lines.push(`### ${tool.publicToolName}`);
      lines.push(`- Safety: ${tool.safetyClassification} (${tool.classificationReason})`);
      if (tool.metadataReview?.issues.length) {
        lines.push(`#### Metadata issues`);
        for (const issue of tool.metadataReview.issues) {
          lines.push(`  - [${issue.severity}] ${issue.title}: ${issue.detail}`);
        }
      }
      if (tool.deeperAnalysis) {
        if (!tool.deeperAnalysis.attempted) {
          lines.push(`- Deeper analysis: skipped (${tool.deeperAnalysis.skippedReason ?? "unknown"})`);
        } else {
          lines.push(`- Deeper analysis sample calls: ${tool.deeperAnalysis.sampleCalls.length}`);
          for (const sample of tool.deeperAnalysis.sampleCalls) {
            lines.push(
              `  - Call ${sample.callIndex}: ${sample.ok ? "ok" : "error"}${sample.durationMs ? ` (${sample.durationMs}ms)` : ""}`
            );
            if (sample.error) lines.push(`    - Error: ${sample.error}`);
            for (const obs of sample.observations) lines.push(`    - ${obs}`);
          }
        }
      }
      if (tool.overallRecommendations.length > 0) {
        lines.push(`#### Recommendations`);
        for (const rec of tool.overallRecommendations) lines.push(`  - ${rec}`);
      }
      if (tool.metadataReview?.evalReadinessNotes.length) {
        lines.push(`#### Agent/Eval readiness notes`);
        for (const note of tool.metadataReview.evalReadinessNotes) lines.push(`  - ${note}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function ToolAnalysisReportView({ report }: { report: ToolAnalysisReport }) {
  const [activeSeverityFilters, setActiveSeverityFilters] = useState<FindingSeverity[]>([
    ...ALL_SEVERITIES
  ]);
  const reportSeveritySet = useMemo(() => new Set(activeSeverityFilters), [activeSeverityFilters]);
  const toggleSeverityFilter = (severity: FindingSeverity) => {
    setActiveSeverityFilters((prev) => {
      const next = prev.includes(severity) ? prev.filter((s) => s !== severity) : [...prev, severity];
      return next.length === 0 ? [...ALL_SEVERITIES] : next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Tools analyzed</div><div className="text-2xl font-semibold">{report.summary.toolsAnalyzed}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Tools skipped</div><div className="text-2xl font-semibold">{report.summary.toolsSkipped}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Findings</div><div className="text-2xl font-semibold">{report.findings.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Analysis Overview</CardTitle>
          <CardDescription>Visual breakdown of findings by severity. Click badges to filter the report.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {ALL_SEVERITIES.filter((s) => report.summary.issueCounts[s] > 0).map((severity) => {
              const active = reportSeveritySet.has(severity);
              return (
                <button key={severity} type="button" onClick={() => toggleSeverityFilter(severity)} className="rounded-full" aria-pressed={active}>
                  <Badge variant="outline" className={`capitalize font-normal ${active ? severityBadgeClass(severity) : severityBadgeInactiveClass(severity)} ${active ? "ring-1 ring-current" : "opacity-70"}`}>
                    {severity}: {report.summary.issueCounts[severity]}
                  </Badge>
                </button>
              );
            })}
            <Button type="button" size="sm" variant="ghost" onClick={() => setActiveSeverityFilters([...ALL_SEVERITIES])} className="h-7 px-2 text-xs">Reset</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {report.servers.map((server) => {
          const filteredTools = server.tools.filter((tool) => {
            const findings = [
              ...(tool.metadataReview?.issues ?? []),
              ...(tool.deeperAnalysis?.sampleCalls.flatMap((call) => call.issues) ?? [])
            ];
            if (findings.length === 0) return activeSeverityFilters.length === ALL_SEVERITIES.length;
            return findings.some((f) => reportSeveritySet.has(f.severity as FindingSeverity));
          });
          if (filteredTools.length === 0) return null;
          return (
            <Card key={server.serverName}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{server.serverName}</CardTitle>
                <CardDescription>
                  Discovered {server.toolCountDiscovered} · Showing {filteredTools.length} of {server.toolCountAnalyzed} analyzed · Skipped {server.toolCountSkipped}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {server.warnings.length > 0 && (
                  <Alert>
                    <AlertTitle>Warnings</AlertTitle>
                    <AlertDescription>
                      <ul className="ml-4 list-disc space-y-1">
                        {server.warnings.map((warning) => <li key={`${server.serverName}-${warning}`}>{warning}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                {filteredTools.map((tool) => (
                  <details key={tool.publicToolName} className="group rounded-md border p-3">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono text-sm">{tool.publicToolName}</div>
                          {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={tool.safetyClassification === "read_like" ? "secondary" : "outline"}>
                            {tool.safetyClassification}
                          </Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                        </div>
                      </div>
                    </summary>
                    <div className="mt-3 space-y-2">
                      {tool.metadataReview && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Metadata review</div>
                          {tool.metadataReview.issues.filter((i) => reportSeveritySet.has(i.severity as FindingSeverity)).length === 0 ? (
                            <p className="text-xs text-muted-foreground">No metadata issues reported.</p>
                          ) : (
                            <div className="space-y-1">
                              {tool.metadataReview.issues.filter((i) => reportSeveritySet.has(i.severity as FindingSeverity)).map((issue, index) => (
                                <div key={issue.id} className="rounded border p-2 text-xs">
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
                                      <span className="min-w-0 font-bold leading-tight">{issue.title}</span>
                                    </div>
                                    <Badge variant="outline" className={`shrink-0 text-[10px] ${severityBadgeClass(issue.severity as FindingSeverity)}`}>{issue.severity}</Badge>
                                  </div>
                                  <p><span className="font-bold">Finding:</span> {issue.detail}</p>
                                  {issue.suggestion && <SuggestionCallout text={issue.suggestion} />}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {tool.deeperAnalysis && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Deeper analysis</div>
                          {!tool.deeperAnalysis.attempted ? (
                            <p className="text-xs text-muted-foreground">{tool.deeperAnalysis.skippedReason ?? "Skipped"}</p>
                          ) : (
                            <div className="space-y-2">
                              {tool.deeperAnalysis.sampleCalls.map((sample) => (
                                <div key={`${tool.publicToolName}-call-${sample.callIndex}`} className="rounded border p-2 text-xs">
                                  <div className="mb-1 flex items-center gap-2">
                                    <Badge variant={sample.ok ? "secondary" : "destructive"} className="text-[10px]">{sample.ok ? "ok" : "error"}</Badge>
                                    <span>Call {sample.callIndex}</span>
                                    {sample.durationMs !== undefined && <span className="text-muted-foreground">{sample.durationMs}ms</span>}
                                  </div>
                                  {sample.error && <p className="text-destructive">{sample.error}</p>}
                                  {sample.observations.length > 0 && (
                                    <div className="mt-2">
                                      <div className="mb-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Observations</div>
                                      <ul className="ml-4 list-disc space-y-1">
                                        {sample.observations.map((obs, idx) => <li key={`${tool.publicToolName}-obs-${sample.callIndex}-${idx}`}>{obs}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {sample.issues.filter((i) => reportSeveritySet.has(i.severity as FindingSeverity)).length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {sample.issues.filter((i) => reportSeveritySet.has(i.severity as FindingSeverity)).map((issue, index) => (
                                        <div key={`${sample.callIndex}-${issue.id}`} className="rounded border p-2">
                                          <div className="mb-1 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
                                              <span className="min-w-0 font-bold leading-tight">{issue.title}</span>
                                            </div>
                                            <Badge variant="outline" className={`shrink-0 text-[10px] ${severityBadgeClass(issue.severity as FindingSeverity)}`}>{issue.severity}</Badge>
                                          </div>
                                          <p><span className="font-bold">Finding:</span> {issue.detail}</p>
                                          {issue.suggestion && <SuggestionCallout text={issue.suggestion} />}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

