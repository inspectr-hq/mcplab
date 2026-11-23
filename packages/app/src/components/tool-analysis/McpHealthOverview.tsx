import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { McpHealthReport, ToolAnalysisModes } from '@/lib/data-sources/types';
import {
  CATALOG_STATUS_LABELS,
  mcpHealthCoverage,
  mcpHealthPrivacy,
  mcpHealthTimings
} from '@/lib/tool-analysis-utils';

export function McpHealthOverview({
  name,
  health,
  modes,
  hasCatalogChecks
}: {
  name: string;
  health: McpHealthReport;
  modes: ToolAnalysisModes;
  hasCatalogChecks: boolean;
}) {
  const implementation = health.implementation;
  const identity = implementation?.name ?? name;
  const timings = mcpHealthTimings(health);
  const expandChecks = !hasCatalogChecks || health.checks.some(({ status }) => status === 'fail');
  const protocol = [health.protocolVersion, health.transport].filter(Boolean).join(' · ');
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0 p-4 sm:px-6">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold">Server health</h2>
          <p className="font-medium">
            {identity}
            {implementation?.version && ` v${implementation.version}`}
          </p>
          {health.endpoint && (
            <p className="wrap-anywhere font-mono text-xs text-muted-foreground">
              {health.endpoint}
            </p>
          )}
          {protocol && <p className="text-xs text-muted-foreground">MCP {protocol}</p>}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Health score</p>
          <p className="text-3xl font-semibold tabular-nums">
            {health.score === null ? 'Unscored' : `${health.score}/100`}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-3 sm:px-6">
        <div className="space-y-1 text-sm">
          <p className="font-medium">{mcpHealthCoverage(health)}</p>
          <p className="text-muted-foreground">{mcpHealthPrivacy(modes)}</p>
          {timings.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
              {timings.map((timing) => (
                <li key={timing}>{timing}</li>
              ))}
            </ul>
          )}
        </div>
        <details className="group border-t" open={expandChecks}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-sm text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            Health check details
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform"
              aria-hidden="true"
            />
          </summary>
          <p className="mb-3 text-xs text-muted-foreground">
            Passed checks earn full credit. Warnings earn half credit. Skipped checks are excluded.
          </p>
          <ul className="divide-y">
            {health.checks.map((check) => (
              <li key={check.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant={check.status === 'fail' ? 'destructive' : 'outline'}>
                    {CATALOG_STATUS_LABELS[check.status]}
                  </Badge>
                  <span className="text-sm font-medium">{check.title}</span>
                  <span className="text-sm text-muted-foreground">{check.detail}</span>
                </div>
                {check.findings && (
                  <ul className="mt-2 space-y-1 pl-2">
                    {check.findings.map(({ status, item, message, path }, i) => (
                      <li key={i} className="wrap-anywhere text-sm">
                        <span className="text-muted-foreground">
                          {CATALOG_STATUS_LABELS[status]} ·{' '}
                        </span>
                        <code className="text-xs font-medium">{item}</code>
                        <span className="text-muted-foreground"> · {message}</span>
                        {path && <code className="ml-2 text-xs text-muted-foreground">{path}</code>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
