import { useId, useState } from 'react';
import {
  ChevronDown,
  CircleCheck,
  CircleMinus,
  CircleX,
  ListChecks,
  TriangleAlert
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { McpCatalogCheck, McpCatalogCheckSummary } from '@/lib/data-sources/types';
import { CATALOG_SECTION_LABELS, CATALOG_STATUS_LABELS } from '@/lib/tool-analysis-utils';

const STATUS_STYLES = {
  pass: {
    icon: CircleCheck,
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
  },
  warning: {
    icon: TriangleAlert,
    className:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
  },
  fail: {
    icon: CircleX,
    className:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
  },
  skipped: {
    icon: CircleMinus,
    className: 'border-border bg-muted text-muted-foreground'
  }
} satisfies Record<McpCatalogCheck['status'], { icon: typeof CircleCheck; className: string }>;

const STATUSES = ['pass', 'warning', 'fail', 'skipped'] as const;
const STATUS_PRIORITY = { fail: 0, warning: 1, pass: 2, skipped: 3 } as const;

function StatusBadge({ status, count }: { status: McpCatalogCheck['status']; count?: number }) {
  const { icon: Icon, className } = STATUS_STYLES[status];
  const label = CATALOG_STATUS_LABELS[status];
  return (
    <Badge asChild variant="outline" className={`gap-1.5 px-2 py-0.5 ${className}`}>
      <span>
        <Icon className="size-3" aria-hidden="true" />
        {count === undefined ? label : `${count} ${label.toLowerCase()}`}
      </span>
    </Badge>
  );
}

export function McpCatalogStatusBadges({ summary }: { summary: McpCatalogCheckSummary }) {
  return STATUSES.filter((status) => summary.statusCounts[status] > 0).map((status) => (
    <StatusBadge key={status} status={status} count={summary.statusCounts[status]} />
  ));
}

function SectionHeader({ check }: { check: McpCatalogCheck }) {
  const { kind, status, itemsChecked, findings } = check;
  let coverage = `${itemsChecked} checked`;
  if (status === 'skipped') coverage = '';
  else if (status === 'pass' && itemsChecked === 0) coverage = 'None listed';
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="min-w-0 text-sm font-semibold">{CATALOG_SECTION_LABELS[kind]}</span>
      <StatusBadge status={status} />
      {coverage && <span className="text-xs text-muted-foreground">{coverage}</span>}
      {findings.length > 0 && (
        <span className="text-xs font-medium">
          {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
        </span>
      )}
    </span>
  );
}

function CatalogSection({
  check,
  expandedByDefault
}: {
  check: McpCatalogCheck;
  expandedByDefault: boolean;
}) {
  const message = check.message && (
    <p className="wrap-anywhere px-4 pb-3 text-sm text-muted-foreground">{check.message}</p>
  );
  if (!check.findings.length) {
    return (
      <div>
        <div className="flex min-h-12 items-center px-4 py-2">
          <SectionHeader check={check} />
        </div>
        {message}
      </div>
    );
  }
  return (
    <details open={expandedByDefault} className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <SectionHeader check={check} />
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform"
          aria-hidden="true"
        />
      </summary>
      {message}
      <ul className="divide-y border-t bg-muted/30 px-4 sm:px-5">
        {check.findings.map((finding, index) => (
          <li
            key={index}
            className="grid min-w-0 gap-1.5 py-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.65fr)] sm:gap-4"
          >
            <div className="min-w-0">
              <p className="wrap-anywhere font-mono text-sm font-semibold">{finding.item}</p>
              <code className="wrap-anywhere text-xs text-muted-foreground">{finding.path}</code>
            </div>
            <p className="wrap-anywhere text-sm text-muted-foreground">
              <span
                className={
                  finding.status === check.status ? 'sr-only' : 'mr-1 font-medium text-foreground'
                }
              >
                {CATALOG_STATUS_LABELS[finding.status]} ·
              </span>
              {finding.message}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function McpCatalogCheckResults({
  server,
  checks
}: {
  server: string;
  checks: McpCatalogCheck[];
}) {
  const headingId = useId();
  const [attentionOnly, setAttentionOnly] = useState(false);
  const orderedChecks = [...checks].sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
  );
  const attentionChecks = orderedChecks.filter(
    ({ status }) => status === 'fail' || status === 'warning'
  );
  const firstFinding = orderedChecks.find(({ findings }) => findings.length > 0)?.kind;
  const visibleChecks = attentionOnly ? attentionChecks : orderedChecks;
  const metrics = [
    {
      label: 'Entries checked',
      value: checks.reduce((total, check) => total + check.itemsChecked, 0)
    },
    { label: 'Sections passed', value: checks.filter(({ status }) => status === 'pass').length },
    { label: 'Findings', value: checks.reduce((total, check) => total + check.findings.length, 0) }
  ];

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader className="gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <ListChecks className="size-5 text-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id={headingId}
              aria-label={`Catalog checks for ${server}`}
              className="text-lg font-semibold tracking-tight"
            >
              Catalog checks
            </h2>
            <p className="wrap-anywhere text-xs text-muted-foreground">{server}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:gap-3 lg:w-3/5">
          {metrics.map(({ label, value }) => (
            <div key={label} className="min-w-0 rounded-lg border bg-muted/35 p-2.5 sm:p-4">
              <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{value}</dd>
            </div>
          ))}
        </dl>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Catalog sections</h3>
          {attentionChecks.length > 0 && (
            <div role="group" aria-label="Filter catalog sections" className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={attentionOnly ? 'ghost' : 'secondary'}
                className="min-h-11"
                aria-pressed={!attentionOnly}
                onClick={() => setAttentionOnly(false)}
              >
                All sections
              </Button>
              <Button
                size="sm"
                variant={attentionOnly ? 'secondary' : 'ghost'}
                className="min-h-11"
                aria-pressed={attentionOnly}
                onClick={() => setAttentionOnly(true)}
              >
                Needs attention{' '}
                <span className="tabular-nums text-muted-foreground">{attentionChecks.length}</span>
              </Button>
            </div>
          )}
        </div>
        <ul className="divide-y overflow-hidden rounded-lg border">
          {visibleChecks.map((check) => (
            <li key={check.kind}>
              <CatalogSection check={check} expandedByDefault={check.kind === firstFinding} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
