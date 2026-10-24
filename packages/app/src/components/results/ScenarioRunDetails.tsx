import type { ReactNode } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers,
  Sparkles,
  Wrench,
  XCircle
} from 'lucide-react';
import { formatFailureReason } from '@/lib/format-failure-reason';
import { formatCheckStatusLabel, buildCheckItems } from '@/lib/check-presentation';
import { formatTokenCount } from '@/lib/format-duration';
import { ConversationRow, ExpandableText } from '@/components/results/ScenarioEvidence';
import { EvalRuleLabel } from '@/components/results/EvalRuleLabel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import type { EvalConfig as UiEvalConfig, ScenarioResult } from '@/types/eval';

export type ScenarioRun = ScenarioResult['runs'][number];
export type ScenarioCheck = ReturnType<typeof buildCheckItems>[number];
export type ScenarioDefinition = UiEvalConfig['scenarios'][number];
export type ScenarioRunSection = 'failures' | 'checks' | 'extracts' | 'tools' | 'final' | 'conversation';

export function ScenarioRunHeader({ run }: { run: ScenarioRun }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-xs text-muted-foreground">Run #{run.runIndex + 1}</span>
      <span className="text-xs text-muted-foreground">·</span>
      <span className="text-xs text-muted-foreground">{run.duration}ms</span>
      <span className="text-xs text-muted-foreground">·</span>
      <span className="text-xs text-muted-foreground">
        {formatTokenCount(run.toolTokenUsage?.totalTokens)} tool tokens
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
  );
}

export function ScenarioOutcomeIcon({ run }: { run: ScenarioRun }) {
  return run.outcome === 'incomplete' || run.outcome === 'stopped' ? (
    <Clock3 className="h-4 w-4 text-amber-500" />
  ) : run.passed ? (
    <CheckCircle2 className="h-4 w-4 text-success" />
  ) : (
    <XCircle className="h-4 w-4 text-destructive" />
  );
}

export function ScenarioFailureReasons({
  run,
  open,
  onOpenChange
}: {
  run: ScenarioRun;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  if (run.failureReasons.length === 0) return null;
  const content = (
    <ul className="space-y-1 text-xs text-destructive">
      {run.failureReasons.map((reason, index) => (
        <li key={index}>• {formatFailureReason(reason)}</li>
      ))}
    </ul>
  );
  if (open === undefined || !onOpenChange) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          Failure reasons
        </p>
        {content}
      </div>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="mb-1 flex w-full items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-destructive"
          >
            <ChevronDown className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} />
            <XCircle className="h-3.5 w-3.5" />
            Failure reasons · {run.failureReasons.length}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>{content}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ScenarioStopReason({ run }: { run: ScenarioRun }) {
  if (run.outcome !== 'stopped' || !run.stopReason) return null;
  return (
    <div className="rounded-md border border-muted-foreground/20 bg-muted/40 p-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Stop reason
      </p>
      <p className="text-xs text-muted-foreground">{run.stopReason}</p>
    </div>
  );
}

export function ScenarioChecksSection({
  checks,
  open,
  onOpenChange
}: {
  checks: ScenarioCheck[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (checks.length === 0) return null;
  const passed = checks.filter((check) => check.status === 'passed').length;
  const failed = checks.filter((check) => check.status === 'failed').length;
  const notEvaluated = checks.filter((check) => check.status === 'not_evaluated').length;
  const notExecuted = checks.filter((check) => check.status === 'not_executed').length;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border bg-muted/20 p-2">
        <CollapsibleTrigger asChild>
          <button type="button" className="mb-2 flex w-full flex-wrap items-center gap-2 text-left">
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Checks
            </p>
            <Badge
              variant="outline"
              className="h-5 border-success/30 bg-success/10 text-success text-[10px]"
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
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {notExecuted > 0 ? (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Checks were not executed because this run ended before evaluation.
            </p>
          ) : null}
          <div className="space-y-1">
            {checks.map((check, index) => (
              <div
                key={`${check.rule.type}-${check.rule.value ?? check.rule.path ?? ''}-${index}`}
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
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ScenarioSection({
  open,
  onOpenChange,
  title,
  children,
  className = 'bg-card',
  trailing
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className={`rounded-md border p-2 ${className}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <ChevronDown className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} />
              <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </span>
            </button>
          </CollapsibleTrigger>
          {trailing}
        </div>
        <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ScenarioExtractedValuesSection({
  run,
  open,
  onOpenChange
}: {
  run: ScenarioRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const values = Object.entries(run.extractedValues ?? {});
  return (
    <ScenarioSection
      open={open}
      onOpenChange={onOpenChange}
      className="border-violet-500/20 bg-violet-500/5"
      title={
        <>
          <Layers className="h-3.5 w-3.5 text-violet-600" /> Extracted values
          <Badge variant="outline" className="h-5 text-[10px]">
            {values.length} total
          </Badge>
        </>
      }
    >
      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground">No extracted values captured for this run.</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {values.map(([key, value]) => (
            <div key={key} className="rounded-md border bg-background px-2 py-1.5 text-xs">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {key}
              </div>
              <div className="font-mono break-all text-foreground">
                {value === null ? 'null' : String(value)}
              </div>
            </div>
          ))}
        </div>
      )}
    </ScenarioSection>
  );
}

export function ScenarioToolCallsSection({
  run,
  open,
  onOpenChange,
  detailed = false
}: {
  run: ScenarioRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detailed?: boolean;
}) {
  return (
    <ScenarioSection
      open={open}
      onOpenChange={onOpenChange}
      className="border-sky-500/20 bg-sky-500/5"
      title={
        <>
          <Wrench className="h-3.5 w-3.5 text-sky-600" /> Tool call sequence
          <Badge variant="outline" className="h-5 text-[10px]">
            {run.toolCalls.length} total
          </Badge>
        </>
      }
    >
      {run.toolCalls.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tool calls captured for this run.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {detailed ? (
              <TooltipProvider delayDuration={0}>
                {run.toolCalls.map((toolCall, index) => {
                  const usage = run.conversation.filter((item) => item.kind === 'tool_call')[index]
                    ?.estimatedTokens;
                  const hasEstimate = typeof usage?.totalTokens === 'number';
                  return (
                    <UiTooltip key={index}>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="font-mono text-xs bg-background">
                          <span className="mr-1 text-muted-foreground">#{index + 1}</span>
                          {toolCall.name}
                          <span className="ml-1 text-muted-foreground">
                            {toolCall.duration}ms
                          </span>
                          {hasEstimate ? (
                            <span className="ml-1 text-muted-foreground">
                              · {formatTokenCount(usage?.totalTokens)} tok
                            </span>
                          ) : null}
                        </Badge>
                      </TooltipTrigger>
                      {hasEstimate ? (
                        <TooltipContent className="text-xs">
                          {`${toolCall.name} · tokens total: ${formatTokenCount(
                            usage?.totalTokens
                          )} · in: ${formatTokenCount(usage?.inputTokens)} · out: ${formatTokenCount(
                            usage?.outputTokens
                          )}`}
                        </TooltipContent>
                      ) : null}
                    </UiTooltip>
                  );
                })}
              </TooltipProvider>
            ) : (
              run.toolCalls.map((toolCall, index) => (
                <Badge key={`${toolCall.name}-${index}`} variant="outline" className="font-mono text-xs">
                  #{index + 1} {toolCall.name} · {toolCall.duration}ms
                </Badge>
              ))
            )}
          </div>
          {detailed ? (
            <div className="rounded-md border bg-background p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Tool token estimate
                </p>
                <Badge variant="outline" className="h-5 text-[10px]">
                  estimated
                </Badge>
              </div>
              {Object.keys(run.toolTokenUsageByTool ?? {}).length === 0 ? (
                <p className="text-xs text-muted-foreground">n/a</p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {Object.entries(run.toolTokenUsageByTool ?? {}).map(([toolName, usage]) => (
                    <div key={toolName} className="rounded border bg-muted/30 px-2 py-1.5 text-xs">
                      <div className="font-mono text-[11px]">{toolName}</div>
                      <div className="text-muted-foreground">
                        total: {formatTokenCount(usage.totalTokens)} · in:{' '}
                        {formatTokenCount(usage.inputTokens)} · out:{' '}
                        {formatTokenCount(usage.outputTokens)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </ScenarioSection>
  );
}

export function ScenarioFinalAnswerSection({
  run,
  open,
  onOpenChange,
  onCopy
}: {
  run: ScenarioRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy?: ReactNode;
}) {
  return (
    <ScenarioSection
      open={open}
      onOpenChange={onOpenChange}
      trailing={onCopy}
      title={
        <>
          <Bot className="h-3.5 w-3.5" /> Final answer
        </>
      }
    >
      <ExpandableText
        text={run.finalAnswer || 'No final answer captured.'}
        maxLength={1200}
        className="text-xs text-foreground"
      />
    </ScenarioSection>
  );
}

export function ScenarioConversationSection({
  run,
  scenarioDefinition,
  open,
  onOpenChange,
  onAskAssistant,
  showCollapsedHint = false
}: {
  run: ScenarioRun;
  scenarioDefinition?: ScenarioDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAskAssistant?: () => void;
  showCollapsedHint?: boolean;
}) {
  return (
    <ScenarioSection
      open={open}
      onOpenChange={onOpenChange}
      className="bg-muted/10"
      trailing={
        onAskAssistant ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onAskAssistant}
          >
            <Sparkles className="h-4 w-4 text-amber-500" />
            Ask Assistant
          </Button>
        ) : null
      }
      title="Conversation trace"
    >
      <div className="space-y-2 rounded-md border bg-muted/20 p-2">
        {run.conversation.length === 0 ? (
          <p className="text-xs text-muted-foreground">No conversation trace captured.</p>
        ) : (
          run.conversation.map((item) => (
            <ConversationRow
              key={item.id}
              item={item}
              fallbackUserPrompt={scenarioDefinition?.prompt}
            />
          ))
        )}
      </div>
      {showCollapsedHint && !open ? (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          onClick={() => onOpenChange(true)}
        >
          Expand to inspect user/assistant/tool messages for this run.
        </button>
      ) : null}
    </ScenarioSection>
  );
}

export function ScenarioRunSections({
  run,
  scenarioDefinition,
  checks,
  isOpen,
  onToggle,
  collapsibleFailures = false,
  showTokenDetails = false,
  onAskAssistant,
  onCopyFinalAnswer,
  showCollapsedConversationHint = false
}: {
  run: ScenarioRun;
  scenarioDefinition?: ScenarioDefinition;
  checks: ScenarioCheck[];
  isOpen: (section: ScenarioRunSection) => boolean;
  onToggle: (section: ScenarioRunSection, open: boolean) => void;
  collapsibleFailures?: boolean;
  showTokenDetails?: boolean;
  onAskAssistant?: () => void;
  onCopyFinalAnswer?: ReactNode;
  showCollapsedConversationHint?: boolean;
}) {
  return (
    <>
      <ScenarioFailureReasons
        run={run}
        open={collapsibleFailures ? isOpen('failures') : undefined}
        onOpenChange={collapsibleFailures ? (open) => onToggle('failures', open) : undefined}
      />
      <ScenarioStopReason run={run} />
      <ScenarioChecksSection
        checks={checks}
        open={isOpen('checks')}
        onOpenChange={(open) => onToggle('checks', open)}
      />
      <ScenarioExtractedValuesSection
        run={run}
        open={isOpen('extracts')}
        onOpenChange={(open) => onToggle('extracts', open)}
      />
      <ScenarioToolCallsSection
        run={run}
        open={isOpen('tools')}
        onOpenChange={(open) => onToggle('tools', open)}
        detailed={showTokenDetails}
      />
      <ScenarioFinalAnswerSection
        run={run}
        open={isOpen('final')}
        onOpenChange={(open) => onToggle('final', open)}
        onCopy={onCopyFinalAnswer}
      />
      <ScenarioConversationSection
        run={run}
        scenarioDefinition={scenarioDefinition}
        open={isOpen('conversation')}
        onOpenChange={(open) => onToggle('conversation', open)}
        onAskAssistant={onAskAssistant}
        showCollapsedHint={showCollapsedConversationHint}
      />
    </>
  );
}
