import { useState } from 'react';
import type { ReactNode } from 'react';
import { scenarioExecutionKey } from '@/lib/data-sources/types';
import { formatPassRate } from '@/lib/utils';
import {
  formatDurationMs,
  getScenarioToolTimeMs,
  getScenarioTotalDurationMs
} from '@/lib/run-duration';
import { formatTokenCount } from '@/lib/format-duration';
import { buildCheckItems } from '@/lib/check-presentation';
import { tallyCheckCounts } from '@/types/eval';
import { McpServerBadge } from '@/components/results/McpServerBadge';
import { formatProvider } from '@/components/ProviderBadge';
import { PassRateBadge } from '@/components/PassRateBadge';
import {
  ScenarioOutcomeIcon,
  ScenarioRunHeader,
  ScenarioRunSections
} from '@/components/results/ScenarioRunDetails';
import type { ScenarioRunSection } from '@/components/results/ScenarioRunDetails';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { EvalResult, EvalConfig as UiEvalConfig, ScenarioResult } from '@/types/eval';

export function ScenarioResultsComparison({
  result,
  scenarios,
  leftKey,
  rightKey,
  onLeftChange,
  onRightChange,
  mcpServerNames,
  scenarioDefinitionByResultId
}: {
  result: EvalResult;
  scenarios: ScenarioResult[];
  leftKey: string;
  rightKey: string;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
  mcpServerNames: Record<string, string>;
  scenarioDefinitionByResultId: Map<string, UiEvalConfig['scenarios'][number]>;
}) {
  const left = scenarios.find(
    (scenario) =>
      scenarioExecutionKey(scenario.scenarioId, scenario.agentName, scenario.server_variant) ===
      leftKey
  );
  const right = scenarios.find(
    (scenario) =>
      scenarioExecutionKey(scenario.scenarioId, scenario.agentName, scenario.server_variant) ===
      rightKey
  );
  if (!left || !right) return null;

  const serverIds = (scenario: ScenarioResult) => {
    if (scenario.servers?.length) return scenario.servers;
    if (scenario.server_variant) {
      return (
        result.server_variants?.find((variant) => variant.id === scenario.server_variant)
          ?.serverIds ?? []
      );
    }
    const definition = scenarioDefinitionByResultId.get(scenario.scenarioId);
    if (definition?.serverIds?.length) return definition.serverIds;
    return (
      definition?.mcpServers?.flatMap((entry) =>
        entry.kind === 'referenced' ? [entry.ref] : [entry.server.id]
      ) ?? []
    );
  };
  const serverNames = (scenario: ScenarioResult) => {
    const ids = serverIds(scenario);
    return ids.map((id) => mcpServerNames[id]?.trim() || id);
  };
  const serverBadges = (scenario: ScenarioResult) => {
    const ids = serverIds(scenario);
    const versions = Object.fromEntries(
      ids.map((id) => [id, result.mcpServerVersions[id] ?? null] as const)
    );
    return Object.keys(versions).length > 0 ? (
      <McpServerBadge
        versions={versions}
        serverNames={mcpServerNames}
        showPrefix={false}
        size="compact"
      />
    ) : (
      serverNames(scenario).join(' + ') || 'Scenario defaults'
    );
  };
  const scenarioName = (scenario: ScenarioResult) => scenario.scenarioName || scenario.scenarioId;
  const agentDetails = (scenario: ScenarioResult) => {
    const agentName = scenario.agentName || scenario.agentId || 'Unknown agent';
    const details = [scenario.provider ? formatProvider(scenario.provider) : null, scenario.model]
      .filter(Boolean)
      .join(' · ');
    return (
      <div>
        <div>{agentName}</div>
        {details ? <div className="text-xs text-muted-foreground">{details}</div> : null}
      </div>
    );
  };
  const checkSummary = (scenario: ScenarioResult): ReactNode => {
    const counts = tallyCheckCounts(scenario.runs.flatMap((run) => run.checkResults ?? []));
    const hasCheckResults = scenario.runs.some((run) => (run.checkResults?.length ?? 0) > 0);
    if (!hasCheckResults) return '—';
    const notEvaluatedLabel = counts.not_evaluated
      ? ` · ${counts.not_evaluated} not evaluated`
      : '';
    const notExecutedLabel = counts.not_executed ? ` · ${counts.not_executed} not executed` : '';
    return (
      <span
        title={`${counts.passed} passed · ${counts.failed} failed${notEvaluatedLabel}${notExecutedLabel}`}
        aria-label={`${counts.passed} checks passed, ${counts.failed} checks failed${
          counts.not_evaluated ? `, ${counts.not_evaluated} not evaluated` : ''
        }${counts.not_executed ? `, ${counts.not_executed} not executed` : ''}`}
      >
        <span className="text-success">{counts.passed} ✓</span>
        <span className="text-muted-foreground"> </span>
        <span className="text-destructive">{counts.failed} ✕</span>
        {counts.not_evaluated > 0 && (
          <>
            <span className="text-muted-foreground"> </span>
            <span>{counts.not_evaluated} ○</span>
          </>
        )}
        {counts.not_executed > 0 && (
          <>
            <span className="text-muted-foreground"> </span>
            <span>{counts.not_executed} ⊘</span>
          </>
        )}
      </span>
    );
  };
  const label = (scenario: ScenarioResult) => {
    const agentName = scenario.agentName || scenario.agentId || 'Unknown agent';
    const serverLabel = scenario.server_variant
      ? result.server_variants?.find((variant) => variant.id === scenario.server_variant)?.label ||
        serverNames(scenario).join(' + ') ||
        scenario.server_variant
      : serverNames(scenario).join(' + ') || 'Scenario defaults';
    return `${scenarioName(scenario)} · ${agentName} · ${serverLabel}`;
  };
  const metricRows: Array<[string, ReactNode, ReactNode]> = [
    ['Scenario', scenarioName(left), scenarioName(right)],
    ['Agent', agentDetails(left), agentDetails(right)],
    ['MCP servers', serverBadges(left), serverBadges(right)],
    ['Runs', String(left.runs.length), String(right.runs.length)],
    ['Pass rate', <PassRateBadge rate={left.passRate} />, <PassRateBadge rate={right.passRate} />],
    ['Checks', checkSummary(left), checkSummary(right)],
    [
      'Total time',
      formatDurationMs(getScenarioTotalDurationMs(left), { preciseUnderTenSeconds: true }),
      formatDurationMs(getScenarioTotalDurationMs(right), { preciseUnderTenSeconds: true })
    ],
    [
      'Tool calls',
      String(left.runs.reduce((sum, run) => sum + run.toolCalls.length, 0)),
      String(right.runs.reduce((sum, run) => sum + run.toolCalls.length, 0))
    ],
    [
      'Tool tokens',
      formatTokenCount(left.toolTokenUsage?.totalTokens),
      formatTokenCount(right.toolTokenUsage?.totalTokens)
    ],
    [
      'Tool time',
      formatDurationMs(getScenarioToolTimeMs(left), { preciseUnderTenSeconds: true }),
      formatDurationMs(getScenarioToolTimeMs(right), { preciseUnderTenSeconds: true })
    ]
  ];

  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium">
          <span className="text-muted-foreground">Left scenario</span>
          <Select value={leftKey} onValueChange={onLeftChange}>
            <SelectTrigger className="h-8 min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((scenario) => {
                const key = scenarioExecutionKey(
                  scenario.scenarioId,
                  scenario.agentName,
                  scenario.server_variant
                );
                return (
                  <SelectItem key={key} value={key} disabled={key === rightKey}>
                    {label(scenario)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          <span className="text-muted-foreground">Right scenario</span>
          <Select value={rightKey} onValueChange={onRightChange}>
            <SelectTrigger className="h-8 min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((scenario) => {
                const key = scenarioExecutionKey(
                  scenario.scenarioId,
                  scenario.agentName,
                  scenario.server_variant
                );
                return (
                  <SelectItem key={key} value={key} disabled={key === leftKey}>
                    {label(scenario)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[42rem] table-fixed">
          <colgroup>
            <col style={{ width: '8rem' }} />
            <col style={{ width: 'calc(50% - 8rem)' }} />
            <col style={{ width: '50%' }} />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Metric</TableHead>
              <TableHead>{label(left)}</TableHead>
              <TableHead className="border-l border-border/60">{label(right)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metricRows.map(([name, leftValue, rightValue]) => (
              <TableRow key={name}>
                <TableCell className="font-medium text-muted-foreground">{name}</TableCell>
                <TableCell className={name === 'Agent' ? 'text-sm' : 'font-mono text-sm'}>
                  {leftValue}
                </TableCell>
                <TableCell
                  className={`${name === 'Agent' ? 'text-sm' : 'font-mono text-sm'} border-l border-border/60`}
                >
                  {rightValue}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 border-t pt-3 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
        <ScenarioComparisonEvidence
          scenario={left}
          scenarioDefinition={scenarioDefinitionByResultId.get(left.scenarioId)}
        />
        <div className="hidden bg-border/60 md:block" aria-hidden="true" />
        <ScenarioComparisonEvidence
          scenario={right}
          scenarioDefinition={scenarioDefinitionByResultId.get(right.scenarioId)}
        />
      </div>
    </div>
  );
}

function ScenarioComparisonEvidence({
  scenario,
  scenarioDefinition
}: {
  scenario: ScenarioResult;
  scenarioDefinition?: UiEvalConfig['scenarios'][number];
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const sectionKey = (runIndex: number, section: ScenarioRunSection) =>
    `${runIndex}-${section}`;
  const isOpen = (runIndex: number, section: ScenarioRunSection) => {
    const defaultOpen = section !== 'conversation';
    const key = sectionKey(runIndex, section);
    return openSections.has(key) ? !defaultOpen : defaultOpen;
  };
  const onToggle = (runIndex: number, section: ScenarioRunSection, open: boolean) => {
    const key = sectionKey(runIndex, section);
    setOpenSections((previous) => {
      const next = new Set(previous);
      if (open === (section !== 'conversation')) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="min-w-0 space-y-2 rounded-md border bg-muted/20 p-3">
      <div>
        <p className="text-xs font-semibold">{scenario.scenarioName || scenario.scenarioId}</p>
        <p className="text-[11px] text-muted-foreground">
          {scenario.agentName} · {formatPassRate(scenario.passRate)} pass rate
        </p>
      </div>
      {scenario.runs.map((run) => {
        const checks = scenarioDefinition
          ? buildCheckItems({
              evalRules: scenarioDefinition.evalRules,
              failureReasons: run.failureReasons,
              runError: run.error,
              checkResults: run.checkResults
            })
          : [];
        return (
          <div key={run.runIndex} className="space-y-2 rounded-md border bg-card p-2 text-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <ScenarioOutcomeIcon run={run} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <ScenarioRunHeader run={run} />
                <ScenarioRunSections
                  run={run}
                  scenarioDefinition={scenarioDefinition}
                  checks={checks}
                  isOpen={(section) => isOpen(run.runIndex, section)}
                  onToggle={(section, open) => onToggle(run.runIndex, section, open)}
                  collapsibleFailures
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
