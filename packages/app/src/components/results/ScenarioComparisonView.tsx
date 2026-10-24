import { useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Clock3, Bot, ChevronDown, Layers, Wrench, XCircle } from 'lucide-react';
import { scenarioExecutionKey } from '@/lib/data-sources/types';
import { formatPassRate } from '@/lib/utils';
import { formatFailureReason } from '@/lib/format-failure-reason';
import {
  formatDurationMs,
  getScenarioToolTimeMs,
  getScenarioTotalDurationMs
} from '@/lib/run-duration';
import { formatTokenCount } from '@/lib/format-duration';
import { buildCheckItems, formatCheckStatusLabel } from '@/lib/check-presentation';
import { tallyCheckCounts } from '@/types/eval';
import { ConversationRow, ExpandableText } from '@/components/results/ScenarioEvidence';
import { EvalRuleLabel } from '@/components/results/EvalRuleLabel';
import { McpServerBadge } from '@/components/results/McpServerBadge';
import { formatProvider } from '@/components/ProviderBadge';
import { PassRateBadge } from '@/components/PassRateBadge';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

export function ScenarioComparisonView({
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
  const toggle = (key: string) =>
    setOpenSections((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const section = (
    key: string,
    title: ReactNode,
    content: ReactNode,
    defaultOpen = true,
    className = 'bg-card'
  ) => {
    const open = openSections.has(key) ? !defaultOpen : defaultOpen;
    return (
      <Collapsible key={key} open={open} onOpenChange={() => toggle(key)}>
        <div className={`rounded-md border p-2 ${className}`}>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center gap-2 text-left">
              <ChevronDown className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} />
              <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">{content}</CollapsibleContent>
        </div>
      </Collapsible>
    );
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
        const passed = checks.filter((check) => check.status === 'passed').length;
        const failed = checks.filter((check) => check.status === 'failed').length;
        const notEvaluated = checks.filter((check) => check.status === 'not_evaluated').length;
        const notExecuted = checks.filter((check) => check.status === 'not_executed').length;
        return (
          <div key={run.runIndex} className="space-y-2 rounded-md border bg-card p-2 text-sm">
            <p className="font-mono text-xs text-muted-foreground">
              Run #{run.runIndex + 1} · {run.duration}ms ·{' '}
              {formatTokenCount(run.toolTokenUsage?.totalTokens)} tool tokens
            </p>
            {run.failureReasons.length > 0
              ? section(
                  `failures-${run.runIndex}`,
                  <>
                    {' '}
                    <XCircle className="inline h-3.5 w-3.5 text-destructive" /> Failure reasons ·{' '}
                    {run.failureReasons.length}
                  </>,
                  <ul className="space-y-1 text-xs text-destructive">
                    {run.failureReasons.map((reason, index) => (
                      <li key={index}>• {formatFailureReason(reason)}</li>
                    ))}
                  </ul>,
                  true,
                  'border-destructive/30 bg-destructive/5'
                )
              : null}
            {checks.length > 0
              ? section(
                  `checks-${run.runIndex}`,
                  <>
                    <span>Checks</span>
                    <Badge
                      variant="outline"
                      className="h-5 border-success/30 bg-success/10 text-[10px] text-success"
                    >
                      {passed} passed
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`h-5 text-[10px] ${
                        failed > 0 ? 'border-destructive/30 bg-destructive/10 text-destructive' : ''
                      }`}
                    >
                      {failed} failed
                    </Badge>
                    {notEvaluated > 0 ? (
                      <Badge
                        variant="outline"
                        className="h-5 border-muted-foreground/30 bg-muted text-[10px] text-muted-foreground"
                      >
                        {notEvaluated} not evaluated
                      </Badge>
                    ) : null}
                    {notExecuted > 0 ? (
                      <Badge
                        variant="outline"
                        className="h-5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600"
                      >
                        {notExecuted} not executed
                      </Badge>
                    ) : null}
                  </>,
                  <>
                    {notExecuted > 0 ? (
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        Checks were not executed because this run ended before evaluation.
                      </p>
                    ) : null}
                    <div className="space-y-1">
                      {checks.map((check, index) => (
                        <div
                          key={`${check.rule.type}-${index}`}
                          className={`flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
                            check.status === 'failed'
                              ? 'border-destructive/20 bg-destructive/5'
                              : check.status === 'not_executed'
                                ? 'border-amber-500/20 bg-amber-500/5'
                                : check.status === 'not_evaluated'
                                  ? 'border-muted-foreground/20 bg-muted/40'
                                  : 'border-success/20 bg-success/5'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {check.status === 'failed' ? (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                              ) : check.status === 'not_executed' ? (
                                <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                              ) : check.status === 'not_evaluated' ? (
                                <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                              )}
                              <EvalRuleLabel rule={check.rule} className="font-medium" />
                            </div>
                            {check.decisionInput ? (
                              <p className="mt-1 pl-5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                                Assertion prompt: {check.decisionInput}
                              </p>
                            ) : null}
                            {!check.decisionInput && check.failureReason ? (
                              <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                                {formatFailureReason(check.failureReason)}
                              </p>
                            ) : null}
                            {check.decisionDetails ? (
                              <p className="mt-1 pl-5 text-[9px] text-muted-foreground">
                                {check.decisionDetails}
                              </p>
                            ) : null}
                          </div>
                          <Badge
                            variant="outline"
                            className={`shrink-0 text-[10px] ${
                              check.status === 'failed'
                                ? 'border-destructive/30 text-destructive'
                                : check.status === 'not_executed'
                                  ? 'border-amber-500/30 text-amber-600'
                                  : check.status === 'not_evaluated'
                                    ? 'border-muted-foreground/30 text-muted-foreground'
                                    : 'border-success/30 text-success'
                            }`}
                          >
                            {formatCheckStatusLabel(check.status)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </>,
                  true,
                  'bg-muted/20'
                )
              : null}
            {section(
              `extracts-${run.runIndex}`,
              <>
                {' '}
                <Layers className="inline h-3.5 w-3.5 text-violet-600" /> Extracted values ·{' '}
                {Object.keys(run.extractedValues ?? {}).length} total
              </>,
              Object.keys(run.extractedValues ?? {}).length ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {Object.entries(run.extractedValues ?? {}).map(([key, value]) => (
                    <div key={key} className="rounded border bg-background px-2 py-1.5 text-xs">
                      <span className="font-semibold text-muted-foreground">{key}</span>
                      <div className="font-mono break-all">
                        {value === null ? 'null' : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No extracted values captured for this run.
                </p>
              ),
              true,
              'border-violet-500/20 bg-violet-500/5'
            )}
            {section(
              `tools-${run.runIndex}`,
              <>
                {' '}
                <Wrench className="inline h-3.5 w-3.5 text-sky-600" /> Tool call sequence ·{' '}
                {run.toolCalls.length} total
              </>,
              run.toolCalls.length ? (
                <div className="flex flex-wrap gap-1">
                  {run.toolCalls.map((toolCall, index) => (
                    <Badge
                      key={`${toolCall.name}-${index}`}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      #{index + 1} {toolCall.name} · {toolCall.duration}ms
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No tool calls captured for this run.
                </p>
              ),
              true,
              'border-sky-500/20 bg-sky-500/5'
            )}
            {section(
              `final-${run.runIndex}`,
              <>
                <Bot className="inline h-3.5 w-3.5" /> Final answer
              </>,
              <ExpandableText
                text={run.finalAnswer || 'No final answer captured.'}
                maxLength={1200}
                className="text-xs"
              />
            )}
            {section(
              `conversation-${run.runIndex}`,
              'Conversation trace',
              run.conversation.length ? (
                <div className="space-y-2 rounded border bg-muted/20 p-2">
                  {run.conversation.map((item) => (
                    <ConversationRow
                      key={item.id}
                      item={item}
                      fallbackUserPrompt={scenarioDefinition?.prompt}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No conversation trace captured.</p>
              ),
              false,
              'bg-muted/10'
            )}
          </div>
        );
      })}
    </div>
  );
}
