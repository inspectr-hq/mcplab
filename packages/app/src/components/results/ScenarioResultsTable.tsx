import { scenarioExecutionKey } from '@/lib/data-sources/types';
import { formatPassRate } from '@/lib/utils';
import { formatProvider } from '@/components/ProviderBadge';
import { buildCheckItems, formatCheckStatusLabel } from '@/lib/check-presentation';
import { formatFailureReason } from '@/lib/format-failure-reason';
import { formatCompactOneDecimal, formatTokenCount } from '@/lib/format-duration';
import {
  formatDurationMs,
  getScenarioToolTimeMs,
  getScenarioTotalDurationMs
} from '@/lib/run-duration';
import { ConversationRow, ExpandableText } from '@/components/results/ScenarioEvidence';
import { PassRateBadge } from '@/components/PassRateBadge';
import { ScenarioTraceButtons } from '@/components/results/ScenarioTraceButtons';
import { EvalRuleLabel } from '@/components/results/EvalRuleLabel';
import { CopyButton } from '@/components/CopyButton';
import { McpServerBadge } from '@/components/results/McpServerBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { tallyCheckCounts } from '@/types/eval';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileCode,
  Layers,
  Pencil,
  Sparkles,
  Wrench,
  XCircle
} from 'lucide-react';
import type {
  EvalResult,
  EvalConfig as UiEvalConfig,
  EvalRule,
  ScenarioResult
} from '@/types/eval';

export function ScenarioResultsTable({
  result,
  filteredScenarios,
  isEmbedded,
  mcpServerNames,
  openScenarios,
  scenarioDefinitionByResultId,
  activeConfig,
  libraryScenarios,
  id,
  toggle,
  runSectionKey,
  toggleRunSection,
  isRunSectionOpen,
  openAssistantWithPrompt
}: {
  result: EvalResult;
  filteredScenarios: ScenarioResult[];
  isEmbedded: boolean;
  mcpServerNames: Record<string, string>;
  openScenarios: Set<string>;
  scenarioDefinitionByResultId: Map<string, UiEvalConfig['scenarios'][number]>;
  activeConfig?: UiEvalConfig;
  libraryScenarios: UiEvalConfig['scenarios'];
  id?: string;
  toggle: (rowId: string) => void;
  runSectionKey: (
    executionKey: string,
    runIndex: number,
    section: 'checks' | 'extracts' | 'tools' | 'final' | 'conversation'
  ) => string;
  toggleRunSection: (key: string) => void;
  isRunSectionOpen: (key: string, defaultOpen?: boolean) => boolean;
  openAssistantWithPrompt: (prompt?: string, options?: { scenarioId?: string }) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scenario</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Runs</TableHead>
          <TableHead>Pass Rate</TableHead>
          <TableHead>Checks</TableHead>
          <TableHead className="text-right">Total Time</TableHead>
          <TableHead className="text-right">Tool Calls</TableHead>
          <TableHead className="text-right">Tool Tokens</TableHead>
          <TableHead className="text-right">Tool Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredScenarios.map((sc) => {
          const rowKey = scenarioExecutionKey(sc.scenarioId, sc.agentName, sc.server_variant);
          const scenarioLabel = sc.scenarioName || sc.scenarioId;
          const checkCounts = tallyCheckCounts(sc.runs.flatMap((run) => run.checkResults ?? []));
          const scenarioServerIds = sc.servers?.length
            ? sc.servers
            : sc.server_variant
              ? result.server_variants?.find((variant) => variant.id === sc.server_variant)
                  ?.serverIds
              : undefined;
          const scenarioServerNames = (scenarioServerIds ?? []).map(
            (serverId) => mcpServerNames[serverId]?.trim() || serverId
          );
          const hasCheckResults = sc.runs.some((run) => (run.checkResults?.length ?? 0) > 0);
          const scenarioConfigId = activeConfig?.id || result?.configId?.trim();
          const scenarioEditHref = scenarioConfigId
            ? `/mcp-evaluations/${encodeURIComponent(scenarioConfigId)}/scenarios`
            : null;
          const libraryTestCase = libraryScenarios.find(
            (scenario) => scenario.id === sc.scenarioId
          );
          const testCaseEditHref = libraryTestCase
            ? `/libraries/test-cases/${encodeURIComponent(
                libraryTestCase.id
              )}?returnTo=${encodeURIComponent(`/results/${result?.id ?? id}`)}`
            : null;
          return (
            <Collapsible
              key={rowKey}
              open={openScenarios.has(rowKey)}
              onOpenChange={() => toggle(rowKey)}
              asChild
            >
              <>
                <CollapsibleTrigger asChild>
                  <TableRow className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium text-sm">
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${
                            openScenarios.has(rowKey) ? 'rotate-180' : ''
                          }`}
                        />
                        <span>{sc.scenarioName}</span>
                        {!isEmbedded && sc.server_variant && (
                          <Badge variant="outline">
                            {result.server_variants?.find(
                              (variant) => variant.id === sc.server_variant
                            )?.label ||
                              sc.servers?.join(' + ') ||
                              sc.server_variant}
                          </Badge>
                        )}
                        {scenarioEditHref ? (
                          <Link
                            to={scenarioEditHref}
                            aria-label="Edit scenario"
                            title="Edit scenario"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{sc.agentName}</div>
                      {sc.provider || sc.model ? (
                        <div className="text-xs text-muted-foreground">
                          {[sc.provider ? formatProvider(sc.provider) : null, sc.model]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{sc.runs.length}</TableCell>
                    <TableCell>
                      <PassRateBadge rate={sc.passRate} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {hasCheckResults ? (
                        <span
                          title={`${checkCounts.passed} passed · ${checkCounts.failed} failed${
                            checkCounts.not_evaluated
                              ? ` · ${checkCounts.not_evaluated} not evaluated`
                              : ''
                          }${
                            checkCounts.not_executed
                              ? ` · ${checkCounts.not_executed} not executed`
                              : ''
                          }`}
                          aria-label={`${checkCounts.passed} checks passed, ${
                            checkCounts.failed
                          } checks failed${
                            checkCounts.not_evaluated
                              ? `, ${checkCounts.not_evaluated} not evaluated`
                              : ''
                          }${
                            checkCounts.not_executed
                              ? `, ${checkCounts.not_executed} not executed`
                              : ''
                          }`}
                        >
                          <span className="text-success">{checkCounts.passed} ✓</span>
                          <span className="text-muted-foreground"> </span>
                          <span className="text-destructive">{checkCounts.failed} ✕</span>
                          {checkCounts.not_evaluated > 0 && (
                            <>
                              <span className="text-muted-foreground"> </span>
                              <span>{checkCounts.not_evaluated} ○</span>
                            </>
                          )}
                          {checkCounts.not_executed > 0 && (
                            <>
                              <span className="text-muted-foreground"> </span>
                              <span>{checkCounts.not_executed} ⊘</span>
                            </>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatDurationMs(getScenarioTotalDurationMs(sc), {
                        preciseUnderTenSeconds: true
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCompactOneDecimal(sc.avgToolCalls)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatTokenCount(sc.toolTokenUsage?.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatDurationMs(getScenarioToolTimeMs(sc), {
                        preciseUnderTenSeconds: true
                      })}
                    </TableCell>
                  </TableRow>
                </CollapsibleTrigger>
                <CollapsibleContent asChild>
                  <tr>
                    <td colSpan={9} className="p-0">
                      <div className="bg-muted/30 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">Scenario details</p>
                            <p className="text-[11px] text-muted-foreground">
                              {scenarioLabel} · {sc.agentName}
                              {scenarioServerNames.length > 0
                                ? ` · MCP: ${scenarioServerNames.join(', ')}`
                                : ''}{' '}
                              · {formatPassRate(sc.passRate)} pass rate ·{' '}
                              {hasCheckResults
                                ? `Checks ${checkCounts.passed} ✓ · ${checkCounts.failed} ✕${
                                    checkCounts.not_evaluated
                                      ? ` · ${checkCounts.not_evaluated} ○`
                                      : ''
                                  }${
                                    checkCounts.not_executed
                                      ? ` · ${checkCounts.not_executed} ⊘`
                                      : ''
                                  } · `
                                : ''}
                              {formatTokenCount(sc.toolTokenUsage?.totalTokens)} tool tokens ·{' '}
                              {formatDurationMs(getScenarioTotalDurationMs(sc), {
                                preciseUnderTenSeconds: true
                              })}{' '}
                              total time ·{' '}
                              {formatDurationMs(getScenarioToolTimeMs(sc), {
                                preciseUnderTenSeconds: true
                              })}{' '}
                              tool time
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {testCaseEditHref ? (
                              <Button
                                asChild
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                              >
                                <Link to={testCaseEditHref} aria-label="Edit test case">
                                  <FileCode className="h-3.5 w-3.5" />
                                  Edit test case
                                </Link>
                              </Button>
                            ) : null}
                            <ScenarioTraceButtons
                              runId={id}
                              scenario={sc}
                              langsmithTraceUrls={result.langsmithTraceUrls}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() =>
                                openAssistantWithPrompt(
                                  `Explain why scenario '${scenarioLabel}' failed (agent: ${sc.agentName}). Summarize the likely cause from the result details and suggest what to inspect next.`,
                                  { scenarioId: sc.scenarioId }
                                )
                              }
                            >
                              <Sparkles className="h-4 w-4 text-amber-500" />
                              Ask Assistant
                            </Button>
                          </div>
                        </div>
                        {sc.runs.map((run) => (
                          <div
                            key={run.runIndex}
                            className="flex items-start gap-3 rounded-md border bg-card p-3 text-sm"
                          >
                            <div className="mt-0.5">
                              {run.outcome === 'incomplete' || run.outcome === 'stopped' ? (
                                <Clock3 className="h-4 w-4 text-amber-500" />
                              ) : run.passed ? (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              ) : (
                                <XCircle className="h-4 w-4 text-destructive" />
                              )}
                            </div>
                            <div className="flex-1 space-y-1">
                              {(() => {
                                const scenarioDef = scenarioDefinitionByResultId.get(sc.scenarioId);
                                const checks = scenarioDef
                                  ? buildRunCheckItems(
                                      scenarioDef.evalRules,
                                      run.failureReasons,
                                      run.error,
                                      run.checkResults
                                    )
                                  : [];
                                const failedChecks = checks.filter((c) => c.status === 'failed');
                                const passedChecks = checks.filter((c) => c.status === 'passed');
                                const notEvaluatedChecks = checks.filter(
                                  (c) => c.status === 'not_evaluated'
                                );
                                const notExecutedChecks = checks.filter(
                                  (c) => c.status === 'not_executed'
                                );
                                return (
                                  <>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono text-xs text-muted-foreground">
                                        Run #{run.runIndex + 1}
                                      </span>
                                      <span className="text-xs text-muted-foreground">·</span>
                                      <span className="text-xs text-muted-foreground">
                                        {run.duration}ms
                                      </span>
                                      <span className="text-xs text-muted-foreground">·</span>
                                      <span className="text-xs text-muted-foreground">
                                        {formatTokenCount(run.toolTokenUsage?.totalTokens)} tool
                                        tokens
                                      </span>
                                      {run.outcome === 'incomplete' ? (
                                        <Badge
                                          variant="outline"
                                          className="h-5 border-amber-500/30 bg-amber-500/10 text-amber-600 text-[10px]"
                                        >
                                          Incomplete
                                        </Badge>
                                      ) : run.outcome === 'stopped' ? (
                                        <Badge
                                          variant="outline"
                                          className="h-5 border-muted-foreground/30 bg-muted text-muted-foreground text-[10px]"
                                        >
                                          Stopped
                                        </Badge>
                                      ) : !run.passed ? (
                                        <Badge
                                          variant="outline"
                                          className="h-5 border-destructive/30 bg-destructive/10 text-destructive text-[10px]"
                                        >
                                          Failed
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {run.failureReasons.length > 0 && (
                                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                                        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                                          <XCircle className="h-3.5 w-3.5" />
                                          Failure reasons
                                        </p>
                                        <ul className="space-y-1 text-xs text-destructive">
                                          {run.failureReasons.map((reason, index) => (
                                            <li key={index}>• {formatFailureReason(reason)}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {run.outcome === 'stopped' && run.stopReason ? (
                                      <div className="rounded-md border border-muted-foreground/20 bg-muted/40 p-2">
                                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          Stop reason
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {run.stopReason}
                                        </p>
                                      </div>
                                    ) : null}
                                    {checks.length > 0 && (
                                      <Collapsible
                                        open={isRunSectionOpen(
                                          runSectionKey(rowKey, run.runIndex, 'checks')
                                        )}
                                        onOpenChange={() =>
                                          toggleRunSection(
                                            runSectionKey(rowKey, run.runIndex, 'checks')
                                          )
                                        }
                                      >
                                        <div className="rounded-md border bg-muted/20 p-2">
                                          <CollapsibleTrigger asChild>
                                            <button
                                              type="button"
                                              className="mb-2 flex w-full flex-wrap items-center gap-2 text-left"
                                            >
                                              <ChevronDown
                                                className={`h-3.5 w-3.5 transition-transform ${
                                                  isRunSectionOpen(
                                                    runSectionKey(rowKey, run.runIndex, 'checks')
                                                  )
                                                    ? 'rotate-180'
                                                    : ''
                                                }`}
                                              />
                                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Checks
                                              </p>
                                              <Badge
                                                variant="outline"
                                                className="h-5 border-success/30 bg-success/10 text-success text-[10px]"
                                              >
                                                {passedChecks.length} passed
                                              </Badge>
                                              <Badge
                                                variant="outline"
                                                className={`h-5 text-[10px] ${
                                                  failedChecks.length > 0
                                                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                                    : ''
                                                }`}
                                              >
                                                {failedChecks.length} failed
                                              </Badge>
                                              {notEvaluatedChecks.length > 0 && (
                                                <Badge
                                                  variant="outline"
                                                  className="h-5 border-muted-foreground/30 bg-muted text-[10px] text-muted-foreground"
                                                >
                                                  {notEvaluatedChecks.length} not evaluated
                                                </Badge>
                                              )}
                                              {notExecutedChecks.length > 0 && (
                                                <Badge
                                                  variant="outline"
                                                  className="h-5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600"
                                                >
                                                  {notExecutedChecks.length} not executed
                                                </Badge>
                                              )}
                                            </button>
                                          </CollapsibleTrigger>
                                          <CollapsibleContent>
                                            {notExecutedChecks.length > 0 && (
                                              <p className="mb-2 text-[11px] text-muted-foreground">
                                                Checks were not executed because this run ended
                                                before evaluation.
                                              </p>
                                            )}
                                            <div className="space-y-1">
                                              {checks.map((check, idx) => (
                                                <div
                                                  key={`${check.rule.type}-${
                                                    check.rule.value ?? check.rule.path ?? ''
                                                  }-${idx}`}
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
                                                      <EvalRuleLabel
                                                        rule={check.rule}
                                                        className="font-medium"
                                                      />
                                                    </div>
                                                    {check.decisionInput && (
                                                      <p className="mt-1 pl-5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                                                        Assertion prompt: {check.decisionInput}
                                                      </p>
                                                    )}
                                                    {!check.decisionInput &&
                                                      check.failureReason && (
                                                        <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                                                          {formatFailureReason(check.failureReason)}
                                                        </p>
                                                      )}
                                                    {check.decisionDetails && (
                                                      <p className="mt-1 pl-5 text-[9px] text-muted-foreground">
                                                        {check.decisionDetails}
                                                      </p>
                                                    )}
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
                                          </CollapsibleContent>
                                        </div>
                                      </Collapsible>
                                    )}
                                  </>
                                );
                              })()}
                              <Collapsible
                                open={isRunSectionOpen(
                                  runSectionKey(rowKey, run.runIndex, 'extracts'),
                                  Object.keys(run.extractedValues ?? {}).length > 0
                                )}
                                onOpenChange={() =>
                                  toggleRunSection(runSectionKey(rowKey, run.runIndex, 'extracts'))
                                }
                              >
                                <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2">
                                  <CollapsibleTrigger asChild>
                                    <button
                                      type="button"
                                      className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-left"
                                    >
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <ChevronDown
                                          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                            isRunSectionOpen(
                                              runSectionKey(rowKey, run.runIndex, 'extracts'),
                                              Object.keys(run.extractedValues ?? {}).length > 0
                                            )
                                              ? 'rotate-180'
                                              : ''
                                          }`}
                                        />
                                        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          <Layers className="h-3.5 w-3.5 text-violet-600" />
                                          Extracted values
                                        </p>
                                      </div>
                                      <Badge variant="outline" className="h-5 text-[10px]">
                                        {Object.keys(run.extractedValues ?? {}).length} total
                                      </Badge>
                                    </button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    {Object.keys(run.extractedValues ?? {}).length === 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        No extracted values captured for this run.
                                      </p>
                                    ) : (
                                      <div className="grid gap-1.5 sm:grid-cols-2">
                                        {Object.entries(run.extractedValues ?? {}).map(
                                          ([key, value]) => (
                                            <div
                                              key={key}
                                              className="rounded-md border bg-background px-2 py-1.5 text-xs"
                                            >
                                              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                {key}
                                              </div>
                                              <div className="font-mono break-all text-foreground">
                                                {value === null ? 'null' : String(value)}
                                              </div>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    )}
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                              <Collapsible
                                open={isRunSectionOpen(
                                  runSectionKey(rowKey, run.runIndex, 'tools'),
                                  run.toolCalls.length > 0
                                )}
                                onOpenChange={() =>
                                  toggleRunSection(runSectionKey(rowKey, run.runIndex, 'tools'))
                                }
                              >
                                <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-2">
                                  <CollapsibleTrigger asChild>
                                    <button
                                      type="button"
                                      className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-left"
                                    >
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <ChevronDown
                                          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                            isRunSectionOpen(
                                              runSectionKey(rowKey, run.runIndex, 'tools'),
                                              run.toolCalls.length > 0
                                            )
                                              ? 'rotate-180'
                                              : ''
                                          }`}
                                        />
                                        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          <Wrench className="h-3.5 w-3.5 text-sky-600" />
                                          Tool call sequence
                                        </p>
                                      </div>
                                      <Badge variant="outline" className="h-5 text-[10px]">
                                        {run.toolCalls.length} total
                                      </Badge>
                                    </button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    {run.toolCalls.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        No tool calls captured for this run.
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        <div className="flex flex-wrap gap-1">
                                          <TooltipProvider delayDuration={0}>
                                            {run.toolCalls.map((tc, i) => {
                                              const usage = run.conversation.filter(
                                                (item) => item.kind === 'tool_call'
                                              )[i]?.estimatedTokens;
                                              const hasEstimate =
                                                typeof usage?.totalTokens === 'number';
                                              return (
                                                <UiTooltip key={i}>
                                                  <TooltipTrigger asChild>
                                                    <Badge
                                                      variant="outline"
                                                      className="font-mono text-xs bg-background"
                                                    >
                                                      <span className="mr-1 text-muted-foreground">
                                                        #{i + 1}
                                                      </span>
                                                      {tc.name}
                                                      <span className="ml-1 text-muted-foreground">
                                                        {tc.duration}ms
                                                      </span>
                                                      {hasEstimate && (
                                                        <span className="ml-1 text-muted-foreground">
                                                          · {formatTokenCount(usage?.totalTokens)}
                                                          tok
                                                        </span>
                                                      )}
                                                    </Badge>
                                                  </TooltipTrigger>
                                                  {hasEstimate && (
                                                    <TooltipContent className="text-xs">
                                                      {`${
                                                        tc.name
                                                      } · tokens total: ${formatTokenCount(
                                                        usage?.totalTokens
                                                      )} · in: ${formatTokenCount(
                                                        usage?.inputTokens
                                                      )} · out: ${formatTokenCount(
                                                        usage?.outputTokens
                                                      )}`}
                                                    </TooltipContent>
                                                  )}
                                                </UiTooltip>
                                              );
                                            })}
                                          </TooltipProvider>
                                        </div>
                                        <div className="rounded-md border bg-background p-2">
                                          <div className="mb-1.5 flex items-center justify-between gap-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                              Tool token estimate
                                            </p>
                                            <Badge variant="outline" className="h-5 text-[10px]">
                                              estimated
                                            </Badge>
                                          </div>
                                          {Object.keys(run.toolTokenUsageByTool ?? {}).length ===
                                          0 ? (
                                            <p className="text-xs text-muted-foreground">n/a</p>
                                          ) : (
                                            <div className="grid gap-1.5 sm:grid-cols-2">
                                              {Object.entries(run.toolTokenUsageByTool ?? {}).map(
                                                ([toolName, usage]) => (
                                                  <div
                                                    key={toolName}
                                                    className="rounded border bg-muted/30 px-2 py-1.5 text-xs"
                                                  >
                                                    <div className="font-mono text-[11px]">
                                                      {toolName}
                                                    </div>
                                                    <div className="text-muted-foreground">
                                                      total: {formatTokenCount(usage.totalTokens)} ·
                                                      in: {formatTokenCount(usage.inputTokens)} ·
                                                      out: {formatTokenCount(usage.outputTokens)}
                                                    </div>
                                                  </div>
                                                )
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                              <Collapsible
                                open={isRunSectionOpen(
                                  runSectionKey(rowKey, run.runIndex, 'final')
                                )}
                                onOpenChange={() =>
                                  toggleRunSection(runSectionKey(rowKey, run.runIndex, 'final'))
                                }
                              >
                                <div className="rounded-md border border-muted-foreground/20 bg-card p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <CollapsibleTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                      >
                                        <ChevronDown
                                          className={`h-3.5 w-3.5 transition-transform ${
                                            isRunSectionOpen(
                                              runSectionKey(rowKey, run.runIndex, 'final')
                                            )
                                              ? 'rotate-180'
                                              : ''
                                          }`}
                                        />
                                        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          <Bot className="h-3.5 w-3.5" />
                                          Final answer
                                        </p>
                                      </button>
                                    </CollapsibleTrigger>
                                    <CopyButton
                                      text={run.finalAnswer || ''}
                                      label="Final answer"
                                      iconOnly
                                    />
                                  </div>
                                  <CollapsibleContent>
                                    <ExpandableText
                                      text={run.finalAnswer || 'No final answer captured.'}
                                      maxLength={1200}
                                      className="text-xs text-foreground"
                                    />
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                              <Collapsible
                                open={isRunSectionOpen(
                                  runSectionKey(rowKey, run.runIndex, 'conversation')
                                )}
                                onOpenChange={() =>
                                  toggleRunSection(
                                    runSectionKey(rowKey, run.runIndex, 'conversation')
                                  )
                                }
                              >
                                <div className="rounded-md border bg-muted/10 p-2">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <CollapsibleTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex min-w-0 items-center gap-2 text-left"
                                      >
                                        <ChevronDown
                                          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                            isRunSectionOpen(
                                              runSectionKey(rowKey, run.runIndex, 'conversation')
                                            )
                                              ? 'rotate-180'
                                              : ''
                                          }`}
                                        />
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          Conversation trace
                                        </p>
                                      </button>
                                    </CollapsibleTrigger>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 gap-1.5 px-2 text-xs"
                                        onClick={() =>
                                          openAssistantWithPrompt(
                                            `Explain Run #${
                                              run.runIndex + 1
                                            } for scenario '${scenarioLabel}'. Its outcome was ${
                                              run.outcome ?? (run.passed ? 'passed' : 'failed')
                                            } in ${
                                              run.duration
                                            }ms. Focus on the tool sequence and evaluated checks.`,
                                            { scenarioId: sc.scenarioId }
                                          )
                                        }
                                      >
                                        <Sparkles className="h-4 w-4 text-amber-500" />
                                        Ask Assistant
                                      </Button>
                                    </div>
                                  </div>
                                  <CollapsibleContent>
                                    <div className="space-y-2 rounded-md border bg-muted/20 p-2">
                                      {run.conversation.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                          No conversation trace captured.
                                        </p>
                                      ) : (
                                        run.conversation.map((item) => (
                                          <ConversationRow
                                            key={item.id}
                                            item={item}
                                            fallbackUserPrompt={
                                              scenarioDefinitionByResultId.get(sc.scenarioId)
                                                ?.prompt
                                            }
                                          />
                                        ))
                                      )}
                                    </div>
                                  </CollapsibleContent>
                                  {!isRunSectionOpen(
                                    runSectionKey(rowKey, run.runIndex, 'conversation')
                                  ) && (
                                    <button
                                      type="button"
                                      className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                                      onClick={() =>
                                        toggleRunSection(
                                          runSectionKey(rowKey, run.runIndex, 'conversation')
                                        )
                                      }
                                    >
                                      Expand to inspect user/assistant/tool messages for this run.
                                    </button>
                                  )}
                                </div>
                              </Collapsible>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                </CollapsibleContent>
              </>
            </Collapsible>
          );
        })}
      </TableBody>
    </Table>
  );
}

function buildRunCheckItems(
  evalRules: EvalRule[],
  failureReasons: string[],
  runError?: string,
  checkResults?: Array<{
    type: string;
    label: string;
    status: 'passed' | 'failed' | 'not_evaluated' | 'not_executed';
    reason?: string;
  }>
) {
  return buildCheckItems({ evalRules, failureReasons, runError, checkResults });
}
