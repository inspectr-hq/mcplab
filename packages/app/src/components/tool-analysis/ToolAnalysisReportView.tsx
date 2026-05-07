import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, Lightbulb } from 'lucide-react';
import type { ToolAnalysisReport } from '@/lib/data-sources/types';
import { isWriteDeleteClassification, safeJsonStringify } from '@/lib/tool-analysis-utils';

const ALL_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
type FindingSeverity = (typeof ALL_SEVERITIES)[number];

function severityBadgeClass(severity: FindingSeverity): string {
  switch (severity) {
    case 'critical':
      return 'border-red-300 bg-red-100 text-red-900';
    case 'high':
      return 'border-orange-300 bg-orange-100 text-orange-900';
    case 'medium':
      return 'border-amber-300 bg-amber-100 text-amber-900';
    case 'low':
      return 'border-sky-300 bg-sky-100 text-sky-900';
    default:
      return 'border-slate-300 bg-slate-100 text-slate-800';
  }
}

function severityBadgeInactiveClass(severity: FindingSeverity): string {
  switch (severity) {
    case 'critical':
      return 'border-red-300 bg-background text-red-900';
    case 'high':
      return 'border-orange-300 bg-background text-orange-900';
    case 'medium':
      return 'border-amber-300 bg-background text-amber-900';
    case 'low':
      return 'border-sky-300 bg-background text-sky-900';
    default:
      return 'border-slate-300 bg-background text-slate-800';
  }
}

function toSafeId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tool'
  );
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

function SafetyBadge({
  label,
  reason,
  variantClassName
}: {
  label: string;
  reason: string;
  variantClassName: string;
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={variantClassName}>
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs">
          <p>{reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function toolAnalysisReportToMarkdown(report: ToolAnalysisReport): string {
  const lines: string[] = [];
  const renderSchemaBlock = (title: string, schema: unknown) => {
    lines.push(`#### ${title}`);
    lines.push('```json');
    try {
      lines.push(JSON.stringify(schema, null, 2));
    } catch {
      lines.push('"[schema not serializable]"');
    }
    lines.push('```');
  };
  lines.push(`# MCP Tool Analysis Report`, '');
  lines.push(`- Created: ${report.createdAt}`);
  lines.push(`- Assistant Agent: ${report.assistantAgentName}`);
  lines.push(`- Assistant Model: ${report.assistantAgentModel}`);
  if (report.mcpServerVersions && Object.keys(report.mcpServerVersions).length > 0) {
    const versionStr = Object.entries(report.mcpServerVersions)
      .map(([name, v]) => `${name}: ${v ?? 'unknown'}`)
      .join(', ');
    lines.push(`- MCP Server Versions: ${versionStr}`);
  }
  lines.push(
    `- Modes: ${[
      report.modes.metadataReview ? 'metadata review' : null,
      report.modes.deeperAnalysis ? 'deeper analysis' : null
    ]
      .filter(Boolean)
      .join(' + ')}`
  );
  lines.push('', `## Summary`);
  lines.push(`- Servers analyzed: ${report.summary.serversAnalyzed}`);
  lines.push(`- Tools analyzed: ${report.summary.toolsAnalyzed}`);
  lines.push(`- Tools skipped: ${report.summary.toolsSkipped}`, '');
  for (const server of report.servers) {
    lines.push(`## Server: ${server.serverName}`);
    if (server.warnings.length > 0) {
      lines.push(...server.warnings.map((w) => `- Warning: ${w}`), '');
    }
    for (const tool of server.tools) {
      lines.push(`### ${tool.publicToolName}`);
      if (tool.title) lines.push(`- Title: ${tool.title}`);
      lines.push(`- Safety: ${tool.safetyClassification} (${tool.classificationReason})`);
      if (tool.inputSchema !== undefined) renderSchemaBlock('Input schema', tool.inputSchema);
      if (tool.outputSchema !== undefined) renderSchemaBlock('Output schema', tool.outputSchema);
      if (tool.metadataReview?.issues.length) {
        lines.push(`#### Metadata issues`);
        for (const issue of tool.metadataReview.issues) {
          lines.push(`  - [${issue.severity}] ${issue.title}: ${issue.detail}`);
        }
      }
      if (tool.deeperAnalysis) {
        if (!tool.deeperAnalysis.attempted) {
          lines.push(
            `- Deeper analysis: skipped (${tool.deeperAnalysis.skippedReason ?? 'unknown'})`
          );
        } else {
          lines.push(`- Deeper analysis sample calls: ${tool.deeperAnalysis.sampleCalls.length}`);
          for (const sample of tool.deeperAnalysis.sampleCalls) {
            lines.push(
              `  - Call ${sample.callIndex}: ${sample.ok ? 'ok' : 'error'}${
                sample.durationMs ? ` (${sample.durationMs}ms)` : ''
              }`
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
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function ToolAnalysisReportView({ report }: { report: ToolAnalysisReport }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSeverityFilters, setActiveSeverityFilters] = useState<FindingSeverity[]>([
    ...ALL_SEVERITIES
  ]);
  const [collapsedSeveritySet, setCollapsedSeveritySet] = useState<Set<FindingSeverity>>(new Set());
  const [toolFilter, setToolFilter] = useState('');
  const [openToolFilterPicker, setOpenToolFilterPicker] = useState(false);
  const groupBy = searchParams.get('groupBy') === 'severity' ? 'severity' : 'tool';
  const toolReportContainerRef = useRef<HTMLDivElement | null>(null);
  const normalizedToolFilter = toolFilter.trim().toLowerCase();
  const reportSeveritySet = useMemo(() => new Set(activeSeverityFilters), [activeSeverityFilters]);
  const toggleSeverityFilter = (severity: FindingSeverity) => {
    setActiveSeverityFilters((prev) => {
      const next = prev.includes(severity)
        ? prev.filter((s) => s !== severity)
        : [...prev, severity];
      return next.length === 0 ? [...ALL_SEVERITIES] : next;
    });
  };
  const setGroupBy = (nextGroupBy: 'tool' | 'severity') => {
    const next = new URLSearchParams(searchParams);
    if (nextGroupBy === 'severity') next.set('groupBy', 'severity');
    else next.delete('groupBy');
    setSearchParams(next, { replace: true });
  };
  const findingsBySeverity = useMemo(() => {
    const grouped: Record<
      FindingSeverity,
      Array<{
        key: string;
        toolAnchorId: string;
        toolLabel: string;
        toolDisplayName: string;
        sourceLabel: string;
        issue: {
          id: string;
          title: string;
          detail: string;
          severity: FindingSeverity;
          suggestion?: string;
        };
      }>
    > = {
      critical: [],
      high: [],
      medium: [],
      low: [],
      info: []
    };

    for (const server of report.servers) {
      for (const tool of server.tools) {
        const toolAnchorId = `tool-${toSafeId(`${server.serverName}-${tool.publicToolName}`)}`;
        const toolLabel = `${server.serverName}::${tool.publicToolName}`;
        const toolDisplayName = tool.publicToolName.split('::').pop() ?? tool.publicToolName;
        for (const issue of tool.metadataReview?.issues ?? []) {
          const severity = issue.severity as FindingSeverity;
          grouped[severity].push({
            key: `${toolLabel}-metadata-${issue.id}`,
            toolAnchorId,
            toolLabel,
            toolDisplayName,
            sourceLabel: 'Metadata review',
            issue: {
              id: issue.id,
              title: issue.title,
              detail: issue.detail,
              severity,
              suggestion: issue.suggestion
            }
          });
        }
        for (const sample of tool.deeperAnalysis?.sampleCalls ?? []) {
          for (const issue of sample.issues) {
            const severity = issue.severity as FindingSeverity;
            grouped[severity].push({
              key: `${toolLabel}-call-${sample.callIndex}-${issue.id}`,
              toolAnchorId,
              toolLabel,
              toolDisplayName,
              sourceLabel: `Sample call ${sample.callIndex}`,
              issue: {
                id: issue.id,
                title: issue.title,
                detail: issue.detail,
                severity,
                suggestion: issue.suggestion
              }
            });
          }
        }
      }
    }
    return grouped;
  }, [report.servers]);
  const toolFilterOptions = useMemo(
    () =>
      Array.from(
        new Set(
          report.servers
            .flatMap((server) => server.tools.map((tool) => tool.publicToolName))
            .map((publicToolName) => publicToolName.split('::').pop() ?? publicToolName)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [report.servers]
  );
  const matchesToolFilter = (toolLabel: string) => {
    if (normalizedToolFilter.length === 0) return true;
    const shortName = toolLabel.toLowerCase().split('::').pop() ?? toolLabel.toLowerCase();
    return shortName.includes(normalizedToolFilter);
  };
  const setAllToolDetailsOpen = (open: boolean) => {
    if (!toolReportContainerRef.current) return;
    const detailsEls = toolReportContainerRef.current.querySelectorAll('details');
    detailsEls.forEach((el) => {
      (el as HTMLDetailsElement).open = open;
    });
  };
  const collapseAllSeveritySections = () => setCollapsedSeveritySet(new Set(ALL_SEVERITIES));
  const expandAllSeveritySections = () => setCollapsedSeveritySet(new Set());
  const toggleSeveritySection = (severity: FindingSeverity) => {
    setCollapsedSeveritySet((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Tools analyzed</div>
            <div className="text-2xl font-semibold">{report.summary.toolsAnalyzed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Tools skipped</div>
            <div className="text-2xl font-semibold">{report.summary.toolsSkipped}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Findings</div>
            <div className="text-2xl font-semibold">{report.findings.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Analysis Overview</CardTitle>
          <CardDescription>
            Visual breakdown of findings by severity. Click badges to filter the report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {ALL_SEVERITIES.filter((s) => report.summary.issueCounts[s] > 0).map((severity) => {
              const active = reportSeveritySet.has(severity);
              return (
                <button
                  key={severity}
                  type="button"
                  onClick={() => toggleSeverityFilter(severity)}
                  className="rounded-full"
                  aria-pressed={active}
                >
                  <Badge
                    variant="outline"
                    className={`capitalize font-normal ${
                      active ? severityBadgeClass(severity) : severityBadgeInactiveClass(severity)
                    } ${active ? 'ring-1 ring-current' : 'opacity-70'}`}
                  >
                    {severity}: {report.summary.issueCounts[severity]}
                  </Badge>
                </button>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setActiveSeverityFilters([...ALL_SEVERITIES])}
              className="h-7 px-2 text-xs"
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-0">
        <Tabs
          value={groupBy}
          onValueChange={(value) => {
            if (value === 'tool' || value === 'severity') setGroupBy(value);
          }}
          className="min-w-0 px-3 pt-1"
        >
          <div className="flex flex-wrap items-end justify-between gap-2 border-b">
            <TabsList className="h-auto justify-start rounded-none bg-transparent p-0">
              <TabsTrigger
                value="tool"
                className="-mb-px h-10 rounded-none rounded-t border border-border border-b-border bg-muted/20 px-6 text-sm font-semibold text-muted-foreground data-[state=active]:z-10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border-border data-[state=active]:border-b-card data-[state=active]:shadow-none"
              >
                Report by Tool
              </TabsTrigger>
              <TabsTrigger
                value="severity"
                className="-mb-px h-10 rounded-none rounded-t border border-border border-b-border bg-muted/20 px-6 text-sm font-semibold text-muted-foreground data-[state=active]:z-10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:border-border data-[state=active]:border-b-card data-[state=active]:shadow-none"
              >
                By Severity
              </TabsTrigger>
            </TabsList>
            <div className="mb-2 flex min-w-0 items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted-foreground">Filter tools</span>
              <Popover open={openToolFilterPicker} onOpenChange={setOpenToolFilterPicker}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={openToolFilterPicker}
                    className="h-8 w-[320px] max-w-full justify-between text-xs font-normal"
                  >
                    <span className="truncate text-left">{toolFilter || 'All tools'}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Search tools..." />
                    <CommandList>
                      <CommandEmpty>No tools found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all tools"
                          onSelect={() => {
                            setToolFilter('');
                            setOpenToolFilterPicker(false);
                          }}
                        >
                          All tools
                        </CommandItem>
                        {toolFilterOptions.map((toolName) => (
                          <CommandItem
                            key={toolName}
                            value={toolName}
                            onSelect={() => {
                              setToolFilter(toolName);
                              setOpenToolFilterPicker(false);
                            }}
                          >
                            {toolName}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {groupBy === 'severity' && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={expandAllSeveritySections}
                  >
                    Expand all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={collapseAllSeveritySections}
                  >
                    Collapse all
                  </Button>
                </>
              )}
              {groupBy === 'tool' && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setAllToolDetailsOpen(true)}
                  >
                    Expand all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setAllToolDetailsOpen(false)}
                  >
                    Collapse all
                  </Button>
                </>
              )}
            </div>
          </div>
        </Tabs>

        {groupBy === 'severity' ? (
          <div className="space-y-4">
            {ALL_SEVERITIES.filter((severity) => reportSeveritySet.has(severity)).map(
              (severity) => {
                const entries = findingsBySeverity[severity].filter((entry) =>
                  matchesToolFilter(entry.toolLabel)
                );
                if (entries.length === 0) return null;
                const isCollapsed = collapsedSeveritySet.has(severity);
                return (
                  <Card key={severity}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base capitalize">{severity}</CardTitle>
                          <CardDescription>{entries.length} finding(s)</CardDescription>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => toggleSeveritySection(severity)}
                          >
                            {isCollapsed ? 'Expand' : 'Collapse'}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    {!isCollapsed && (
                      <CardContent className="space-y-2">
                        {entries.map((entry, index) => (
                          <div key={entry.key} className="rounded border p-2 text-xs">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                                  {index + 1}
                                </span>
                                <span className="min-w-0 font-bold leading-tight">
                                  {entry.issue.title}
                                </span>
                              </div>
                              <Badge
                                variant="outline"
                                className={`shrink-0 text-[10px] ${severityBadgeClass(
                                  entry.issue.severity
                                )}`}
                              >
                                {entry.issue.severity}
                              </Badge>
                            </div>
                            <p>
                              <span className="font-bold">Finding:</span> {entry.issue.detail}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                              <Badge variant="secondary" className="font-normal">
                                {entry.sourceLabel}
                              </Badge>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 font-mono text-[11px]"
                                title={entry.toolLabel}
                                onClick={() => {
                                  setGroupBy('tool');
                                  requestAnimationFrame(() => {
                                    document.getElementById(entry.toolAnchorId)?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start'
                                    });
                                  });
                                }}
                              >
                                {entry.toolDisplayName}
                              </Button>
                            </div>
                            {entry.issue.suggestion && (
                              <SuggestionCallout text={entry.issue.suggestion} />
                            )}
                          </div>
                        ))}
                      </CardContent>
                    )}
                  </Card>
                );
              }
            )}
          </div>
        ) : (
          <div ref={toolReportContainerRef} className="space-y-4">
            {report.servers.map((server) => {
              const filteredTools = server.tools.filter((tool) => {
                const toolLabel = `${server.serverName}::${tool.publicToolName}`;
                if (!matchesToolFilter(toolLabel)) return false;
                const findings = [
                  ...(tool.metadataReview?.issues ?? []),
                  ...(tool.deeperAnalysis?.sampleCalls.flatMap((call) => call.issues) ?? [])
                ];
                if (findings.length === 0)
                  return activeSeverityFilters.length === ALL_SEVERITIES.length;
                return findings.some((f) => reportSeveritySet.has(f.severity as FindingSeverity));
              });
              if (filteredTools.length === 0) return null;
              return (
                <Card key={server.serverName}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{server.serverName}</CardTitle>
                    <CardDescription>
                      Discovered {server.toolCountDiscovered} · Showing {filteredTools.length} of{' '}
                      {server.toolCountAnalyzed} analyzed · Skipped {server.toolCountSkipped}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {server.warnings.length > 0 && (
                      <Alert>
                        <AlertTitle>Warnings</AlertTitle>
                        <AlertDescription>
                          <ul className="ml-4 list-disc space-y-1">
                            {server.warnings.map((warning) => (
                              <li key={`${server.serverName}-${warning}`}>{warning}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                    {filteredTools.map((tool) => {
                      const toolDisplayName =
                        tool.publicToolName.split('::').pop() ?? tool.publicToolName;
                      const isWriteDelete = isWriteDeleteClassification(tool.classificationReason);
                      const safetyLabel =
                        tool.safetyClassification === 'read_only'
                          ? 'read-only'
                          : isWriteDelete
                          ? 'write/delete'
                          : 'unsafe/unknown';
                      const safetyVariantClass =
                        tool.safetyClassification === 'read_only'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : isWriteDelete
                          ? 'border-amber-300 bg-amber-50 text-amber-800'
                          : 'border-slate-300 bg-slate-100 text-slate-700';
                      return (
                        <details
                          key={tool.publicToolName}
                          id={`tool-${toSafeId(`${server.serverName}-${tool.publicToolName}`)}`}
                          className="group rounded-md border p-3"
                        >
                          <summary className="cursor-pointer list-none">
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div
                                    className="min-w-0 truncate font-mono text-sm"
                                    title={tool.publicToolName}
                                  >
                                    {toolDisplayName}
                                  </div>
                                  <SafetyBadge
                                    label={safetyLabel}
                                    reason={tool.classificationReason}
                                    variantClassName={safetyVariantClass}
                                  />
                                </div>
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                              </div>
                              {tool.title && (
                                <p className="text-sm text-foreground/85">{tool.title}</p>
                              )}
                              {tool.description && (
                                <p className="text-xs text-muted-foreground">{tool.description}</p>
                              )}
                            </div>
                          </summary>
                          <div className="mt-3 space-y-2">
                            {(tool.inputSchema !== undefined ||
                              tool.outputSchema !== undefined) && (
                              <details className="group/schema rounded border bg-muted/10 p-2">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium">
                                  <span>Schemas</span>
                                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open/schema:rotate-180" />
                                </summary>
                                <div className="mt-2 space-y-2">
                                  {tool.inputSchema !== undefined && (
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-medium text-muted-foreground">
                                        Input schema
                                      </div>
                                      <pre className="max-h-52 overflow-auto rounded border bg-muted/20 p-2 text-[11px]">
                                        {safeJsonStringify(tool.inputSchema)}
                                      </pre>
                                    </div>
                                  )}
                                  {tool.outputSchema !== undefined && (
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-medium text-muted-foreground">
                                        Output schema
                                      </div>
                                      <pre className="max-h-52 overflow-auto rounded border bg-muted/20 p-2 text-[11px]">
                                        {safeJsonStringify(tool.outputSchema)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </details>
                            )}
                            {tool.metadataReview && (
                              <div className="space-y-1">
                                <div className="text-xs font-medium">Metadata review</div>
                                {tool.metadataReview.issues.filter((i) =>
                                  reportSeveritySet.has(i.severity as FindingSeverity)
                                ).length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No metadata issues reported.
                                  </p>
                                ) : (
                                  <div className="space-y-1">
                                    {tool.metadataReview.issues
                                      .filter((i) =>
                                        reportSeveritySet.has(i.severity as FindingSeverity)
                                      )
                                      .map((issue, index) => (
                                        <div key={issue.id} className="rounded border p-2 text-xs">
                                          <div className="mb-1 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-center gap-2">
                                              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                                                {index + 1}
                                              </span>
                                              <span className="min-w-0 font-bold leading-tight">
                                                {issue.title}
                                              </span>
                                            </div>
                                            <Badge
                                              variant="outline"
                                              className={`shrink-0 text-[10px] ${severityBadgeClass(
                                                issue.severity as FindingSeverity
                                              )}`}
                                            >
                                              {issue.severity}
                                            </Badge>
                                          </div>
                                          <p>
                                            <span className="font-bold">Finding:</span>{' '}
                                            {issue.detail}
                                          </p>
                                          {issue.suggestion && (
                                            <SuggestionCallout text={issue.suggestion} />
                                          )}
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
                                  <p className="text-xs text-muted-foreground">
                                    {tool.deeperAnalysis.skippedReason ?? 'Skipped'}
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {tool.deeperAnalysis.sampleCalls.map((sample) => (
                                      <div
                                        key={`${tool.publicToolName}-call-${sample.callIndex}`}
                                        className="rounded border p-2 text-xs"
                                      >
                                        <div className="mb-1 flex items-center gap-2">
                                          <Badge
                                            variant={sample.ok ? 'secondary' : 'destructive'}
                                            className="text-[10px]"
                                          >
                                            {sample.ok ? 'ok' : 'error'}
                                          </Badge>
                                          <span>Call {sample.callIndex}</span>
                                          {sample.durationMs !== undefined && (
                                            <span className="text-muted-foreground">
                                              {sample.durationMs}ms
                                            </span>
                                          )}
                                        </div>
                                        {sample.error && (
                                          <p className="text-destructive">{sample.error}</p>
                                        )}
                                        {sample.observations.length > 0 && (
                                          <div className="mt-2">
                                            <div className="mb-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                              Observations
                                            </div>
                                            <ul className="ml-4 list-disc space-y-1">
                                              {sample.observations.map((obs, idx) => (
                                                <li
                                                  key={`${tool.publicToolName}-obs-${sample.callIndex}-${idx}`}
                                                >
                                                  {obs}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {sample.issues.filter((i) =>
                                          reportSeveritySet.has(i.severity as FindingSeverity)
                                        ).length > 0 && (
                                          <div className="mt-2 space-y-1">
                                            {sample.issues
                                              .filter((i) =>
                                                reportSeveritySet.has(i.severity as FindingSeverity)
                                              )
                                              .map((issue, index) => (
                                                <div
                                                  key={`${sample.callIndex}-${issue.id}`}
                                                  className="rounded border p-2"
                                                >
                                                  <div className="mb-1 flex items-center justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                                                        {index + 1}
                                                      </span>
                                                      <span className="min-w-0 font-bold leading-tight">
                                                        {issue.title}
                                                      </span>
                                                    </div>
                                                    <Badge
                                                      variant="outline"
                                                      className={`shrink-0 text-[10px] ${severityBadgeClass(
                                                        issue.severity as FindingSeverity
                                                      )}`}
                                                    >
                                                      {issue.severity}
                                                    </Badge>
                                                  </div>
                                                  <p>
                                                    <span className="font-bold">Finding:</span>{' '}
                                                    {issue.detail}
                                                  </p>
                                                  {issue.suggestion && (
                                                    <SuggestionCallout text={issue.suggestion} />
                                                  )}
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
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
