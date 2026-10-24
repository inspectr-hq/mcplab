import { scenarioExecutionKey } from '@/lib/data-sources/types';
import { formatPassRate } from '@/lib/utils';
import { formatProvider } from '@/components/ProviderBadge';
import { buildCheckItems } from '@/lib/check-presentation';
import { formatCompactOneDecimal, formatTokenCount } from '@/lib/format-duration';
import {
  formatDurationMs,
  getScenarioToolTimeMs,
  getScenarioTotalDurationMs
} from '@/lib/run-duration';
import {
  ScenarioOutcomeIcon,
  ScenarioRunHeader,
  ScenarioRunSections
} from '@/components/results/ScenarioRunDetails';
import { PassRateBadge } from '@/components/PassRateBadge';
import { ScenarioTraceButtons } from '@/components/results/ScenarioTraceButtons';
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
import { tallyCheckCounts } from '@/types/eval';
import { ChevronDown, FileCode, Pencil, Sparkles } from 'lucide-react';
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
                        {sc.runs.map((run) => {
                          const scenarioDef = scenarioDefinitionByResultId.get(sc.scenarioId);
                          const checks = scenarioDef
                            ? buildRunCheckItems(
                                scenarioDef.evalRules,
                                run.failureReasons,
                                run.error,
                                run.checkResults
                              )
                            : [];
                          const sectionIsOpen = (section: Parameters<typeof runSectionKey>[2]) =>
                            isRunSectionOpen(
                              runSectionKey(rowKey, run.runIndex, section),
                              section === 'extracts'
                                ? Object.keys(run.extractedValues ?? {}).length > 0
                                : section === 'tools'
                                  ? run.toolCalls.length > 0
                                  : undefined
                            );
                          const toggleSection = (
                            section: Parameters<typeof runSectionKey>[2],
                            _open: boolean
                          ) => toggleRunSection(runSectionKey(rowKey, run.runIndex, section));
                          return (
                            <div
                              key={run.runIndex}
                              className="flex items-start gap-3 rounded-md border bg-card p-3 text-sm"
                            >
                              <div className="mt-0.5">
                                <ScenarioOutcomeIcon run={run} />
                              </div>
                              <div className="flex-1 space-y-1">
                                <ScenarioRunHeader run={run} />
                                <ScenarioRunSections
                                  run={run}
                                  scenarioDefinition={scenarioDef}
                                  checks={checks}
                                  isOpen={(section) =>
                                    section === 'failures' ? true : sectionIsOpen(section)
                                  }
                                  onToggle={(section, open) => {
                                    if (section !== 'failures') toggleSection(section, open);
                                  }}
                                  showTokenDetails
                                  onCopyFinalAnswer={
                                    <CopyButton
                                      text={run.finalAnswer || ''}
                                      label="Final answer"
                                      iconOnly
                                    />
                                  }
                                  onAskAssistant={() =>
                                    openAssistantWithPrompt(
                                      'Explain Run #' +
                                        (run.runIndex + 1) +
                                        " for scenario '" +
                                        scenarioLabel +
                                        "'. Its outcome was " +
                                        (run.outcome ?? (run.passed ? 'passed' : 'failed')) +
                                        ' in ' +
                                        run.duration +
                                        'ms. Focus on the tool sequence and evaluated checks.',
                                      { scenarioId: sc.scenarioId }
                                    )
                                  }
                                  showCollapsedConversationHint
                                />
                              </div>
                            </div>
                          );
                        })}
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
