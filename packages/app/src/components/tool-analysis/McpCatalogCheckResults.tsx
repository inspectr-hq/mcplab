import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { McpCatalogCheck, McpCatalogCheckSummary } from '@/lib/data-sources/types';
import { CATALOG_SECTION_LABELS, CATALOG_STATUS_LABELS } from '@/lib/tool-analysis-utils';
import { useId } from 'react';

const STATUSES = ['pass', 'warning', 'fail', 'skipped'] as const;

function statusVariant(status: McpCatalogCheck['status']) {
  if (status === 'fail') return 'destructive';
  if (status === 'pass') return 'secondary';
  return 'outline';
}

export function McpCatalogStatusBadges({ summary }: { summary: McpCatalogCheckSummary }) {
  return STATUSES.filter((status) => summary.statusCounts[status] > 0).map((status) => (
    <Badge key={status} variant={statusVariant(status)}>
      {summary.statusCounts[status]} {CATALOG_STATUS_LABELS[status].toLowerCase()}
    </Badge>
  ));
}

export function McpCatalogCheckResults({
  server,
  checks
}: {
  server: string;
  checks: McpCatalogCheck[];
}) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader className="pb-3">
        <CardTitle id={headingId} className="text-base">
          Catalog checks for {server}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {checks.map(({ kind, status, itemsChecked, message, findings }) => (
            <li key={kind} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">{CATALOG_SECTION_LABELS[kind]}</h3>
                <Badge variant={statusVariant(status)}>{CATALOG_STATUS_LABELS[status]}</Badge>
                <span className="text-xs text-muted-foreground">{itemsChecked} checked</span>
              </div>
              {message && <p className="wrap-anywhere text-sm text-muted-foreground">{message}</p>}
              {findings.length > 0 && (
                <details className="text-sm">
                  <summary className="w-fit cursor-pointer font-medium">
                    {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {findings.map((finding, index) => (
                      <li key={index} className="wrap-anywhere rounded-md border p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusVariant(finding.status)}>
                            {CATALOG_STATUS_LABELS[finding.status]}
                          </Badge>
                          <span className="font-medium">{finding.item}</span>
                          <code className="text-xs text-muted-foreground">{finding.path}</code>
                        </div>
                        <p className="mt-1 text-muted-foreground">{finding.message}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
