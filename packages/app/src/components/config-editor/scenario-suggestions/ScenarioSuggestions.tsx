import { useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { formatEvalRuleLabel } from '@/lib/check-presentation';
import { formatToolSequenceText } from '@/types/eval';
import type { EvalRule, Scenario } from '@/types/eval';
import type { ScenarioAssistantSuggestionBundle } from '@/lib/data-sources/types';

export type ScenarioPatch = {
  prompt?: string;
  evalRules?: Scenario['evalRules'];
  extractRules?: Scenario['extractRules'];
};

type SuggestedEvalRule = NonNullable<
  ScenarioAssistantSuggestionBundle['evalRules']
>['replacement'][number];
type SuggestedExtractRule = NonNullable<
  ScenarioAssistantSuggestionBundle['extractRules']
>['replacement'][number];

function sequenceFromSuggestedRule(rule: SuggestedEvalRule): string[] {
  if (Array.isArray(rule.sequence)) {
    return rule.sequence.map((toolName) => toolName.trim()).filter(Boolean);
  }
  const value = typeof rule.value === 'string' ? rule.value.trim() : '';
  if (!value || value.toLowerCase() === 'tool sequence') return [];
  return value
    .split(/\s*(?:->|,|\n)\s*/)
    .map((toolName) => toolName.trim())
    .filter(Boolean);
}

function normalizeSuggestedEvalRules(rules: SuggestedEvalRule[]): {
  rules: EvalRule[];
  skippedToolSequences: number;
} {
  const normalized: EvalRule[] = [];
  let skippedToolSequences = 0;
  for (const rule of rules) {
    if (rule.type === 'tool_sequence') {
      const sequence = sequenceFromSuggestedRule(rule);
      if (sequence.length > 0) {
        normalized.push({ type: 'tool_sequence', sequence });
      } else {
        skippedToolSequences += 1;
      }
      continue;
    }
    normalized.push(rule);
  }
  return { rules: normalized, skippedToolSequences };
}

function formatSuggestedEvalRuleLabel(rule: SuggestedEvalRule): string {
  if (rule.type === 'tool_sequence') {
    const sequence = sequenceFromSuggestedRule(rule);
    return sequence.length > 0
      ? `Tool sequence · ${formatToolSequenceText(sequence)}`
      : 'Tool sequence · No tool steps';
  }
  return formatEvalRuleLabel(rule);
}

type SuggestionKey = 'prompt' | 'evalRules' | 'extractRules';
const LABEL_BY_KEY: Record<SuggestionKey, string> = {
  prompt: 'Prompt',
  evalRules: 'Checks',
  extractRules: 'Value Capture Rules'
};

/** Structured suggestions attached to one assistant message, with their Apply actions. */
export function ScenarioSuggestions({
  messageId,
  suggestions,
  scenario,
  onApplyPatch,
  appliedKeys,
  onApplied
}: {
  messageId?: string;
  suggestions: ScenarioAssistantSuggestionBundle;
  scenario: Pick<Scenario, 'evalRules' | 'extractRules'>;
  onApplyPatch: (patch: ScenarioPatch) => void;
  /** Keys of the form `${messageId}:${field}` that were already applied. */
  appliedKeys: ReadonlySet<string>;
  onApplied: (key: string) => void;
}) {
  const isApplied = (key: SuggestionKey) => appliedKeys.has(`${messageId}:${key}`);
  const markApplied = (key: SuggestionKey) => {
    if (messageId) onApplied(`${messageId}:${key}`);
    toast({ title: 'Applied suggestion', description: `Updated ${LABEL_BY_KEY[key]}` });
  };

  const applyPrompt = () => {
    if (!suggestions.prompt) return;
    onApplyPatch({ prompt: suggestions.prompt.replacement });
    markApplied('prompt');
  };

  const applyEvalRules = (selected: SuggestedEvalRule[], mode: 'replace' | 'append') => {
    const normalized = normalizeSuggestedEvalRules(selected);
    onApplyPatch({
      evalRules: mode === 'append' ? [...scenario.evalRules, ...normalized.rules] : normalized.rules
    });
    if (normalized.skippedToolSequences > 0) {
      toast({
        title: 'Skipped invalid tool sequence',
        description: 'The assistant suggested a sequence check without any tool steps.',
        variant: 'destructive'
      });
    }
    markApplied('evalRules');
  };

  const applyExtractRules = (selected: SuggestedExtractRule[], mode: 'replace' | 'append') => {
    onApplyPatch({
      extractRules: mode === 'append' ? [...scenario.extractRules, ...selected] : selected
    });
    markApplied('extractRules');
  };

  const rawNotes: unknown = suggestions.notes;
  const notes = Array.isArray(rawNotes)
    ? (rawNotes as string[])
    : typeof rawNotes === 'string'
      ? [rawNotes]
      : [];

  return (
    <div className="ml-0 space-y-3 rounded-md border border-dashed bg-muted/10 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Structured Suggestions
      </div>
      {suggestions.prompt && (
        <SuggestionCard
          title="Prompt"
          rationale={suggestions.prompt.rationale}
          preview={suggestions.prompt.replacement}
          applied={isApplied('prompt')}
          onApply={applyPrompt}
        />
      )}
      {suggestions.evalRules && (
        <EvalRulesSuggestionCard
          rationale={suggestions.evalRules.rationale}
          rules={suggestions.evalRules.replacement}
          applied={isApplied('evalRules')}
          onApply={(selected) => applyEvalRules(selected, 'append')}
          onReplace={(selected) => applyEvalRules(selected, 'replace')}
        />
      )}
      {suggestions.extractRules && (
        <ExtractRulesSuggestionCard
          rationale={suggestions.extractRules.rationale}
          rules={suggestions.extractRules.replacement}
          applied={isApplied('extractRules')}
          onApply={(selected) => applyExtractRules(selected, 'append')}
          onReplace={(selected) => applyExtractRules(selected, 'replace')}
        />
      )}
      {notes.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <h5 className="text-sm font-medium">Notes</h5>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {notes.map((note, index) => (
              <li key={`${messageId}-note-${index}`}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  title,
  rationale,
  preview,
  applied = false,
  onApply
}: {
  title: string;
  rationale?: string;
  preview: string;
  applied?: boolean;
  onApply: () => void;
}) {
  return (
    <div
      className={`space-y-2 rounded-md border p-3 ${
        applied ? 'border-emerald-300 bg-emerald-50/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-medium">{title}</h5>
      </div>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
        {preview}
      </pre>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="h-8"
          variant={applied ? 'secondary' : 'default'}
          onClick={onApply}
          disabled={applied}
        >
          {applied ? (
            <>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Applied
            </>
          ) : (
            'Apply'
          )}
        </Button>
      </div>
    </div>
  );
}

function EvalRulesSuggestionCard({
  rationale,
  rules,
  applied = false,
  onApply,
  onReplace
}: {
  rationale?: string;
  rules: SuggestedEvalRule[];
  applied?: boolean;
  onApply: (selectedRules: SuggestedEvalRule[]) => void;
  onReplace: (selectedRules: SuggestedEvalRule[]) => void;
}) {
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(
    () => new Set(rules.map((_, index) => index))
  );
  const selectedCount = selectedIndexes.size;
  const selectedRules = rules.filter((_, index) => selectedIndexes.has(index));
  const allSelected = selectedCount === rules.length;

  const toggleRule = (index: number, checked: boolean) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  return (
    <div
      className={`space-y-2 rounded-md border p-3 ${
        applied ? 'border-emerald-300 bg-emerald-50/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-medium">Checks</h5>
      </div>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <div className="space-y-2 rounded bg-muted/60 p-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] text-muted-foreground">
            {selectedCount} of {rules.length} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={applied || rules.length === 0}
            onClick={() =>
              setSelectedIndexes(allSelected ? new Set() : new Set(rules.map((_, index) => index)))
            }
          >
            {allSelected ? 'Unselect all' : 'Select all'}
          </Button>
        </div>
        {rules.map((rule, index) => {
          const label = formatSuggestedEvalRuleLabel(rule);
          const checkboxId = `scenario-assistant-check-${index}-${rule.type}`;
          return (
            <div
              key={`${rule.type}-${index}`}
              className="flex items-start gap-2 rounded bg-background p-2"
            >
              <Checkbox
                id={checkboxId}
                checked={selectedIndexes.has(index)}
                disabled={applied}
                onCheckedChange={(checked) => toggleRule(index, checked === true)}
                aria-label={`Select ${label}`}
              />
              <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer space-y-1">
                <span className="block text-xs font-medium">{label}</span>
                <code className="block wrap-break-word rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
                  {JSON.stringify(rule)}
                </code>
              </label>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {applied ? (
          <Button type="button" size="sm" variant="secondary" disabled>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Applied
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8"
              variant="outline"
              onClick={() => onReplace(selectedRules)}
              disabled={selectedCount === 0}
            >
              Replace all
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => onApply(selectedRules)}
              disabled={selectedCount === 0}
            >
              Add selected
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ExtractRulesSuggestionCard({
  rationale,
  rules,
  applied = false,
  onApply,
  onReplace
}: {
  rationale?: string;
  rules: SuggestedExtractRule[];
  applied?: boolean;
  onApply: (selectedRules: SuggestedExtractRule[]) => void;
  onReplace: (selectedRules: SuggestedExtractRule[]) => void;
}) {
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(
    () => new Set(rules.map((_, index) => index))
  );
  const selectedCount = selectedIndexes.size;
  const selectedRules = rules.filter((_, index) => selectedIndexes.has(index));
  const allSelected = selectedCount === rules.length;

  const toggleRule = (index: number, checked: boolean) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  return (
    <div
      className={`space-y-2 rounded-md border p-3 ${
        applied ? 'border-emerald-300 bg-emerald-50/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-medium">Value Capture Rules</h5>
      </div>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <div className="space-y-2 rounded bg-muted/60 p-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] text-muted-foreground">
            {selectedCount} of {rules.length} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={applied || rules.length === 0}
            onClick={() =>
              setSelectedIndexes(allSelected ? new Set() : new Set(rules.map((_, index) => index)))
            }
          >
            {allSelected ? 'Unselect all' : 'Select all'}
          </Button>
        </div>
        {rules.map((rule, index) => {
          const label = `${rule.name} · ${rule.pattern}`;
          const checkboxId = `scenario-assistant-extract-${index}-${rule.name}`;
          return (
            <div
              key={`${rule.name}-${index}`}
              className="flex items-start gap-2 rounded bg-background p-2"
            >
              <Checkbox
                id={checkboxId}
                checked={selectedIndexes.has(index)}
                disabled={applied}
                onCheckedChange={(checked) => toggleRule(index, checked === true)}
                aria-label={`Select ${label}`}
              />
              <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer space-y-1">
                <span className="block text-xs font-medium">{label}</span>
                <code className="block wrap-break-word rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
                  {JSON.stringify(rule)}
                </code>
              </label>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {applied ? (
          <Button type="button" size="sm" variant="secondary" disabled>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Applied
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8"
              variant="outline"
              onClick={() => onReplace(selectedRules)}
              disabled={selectedCount === 0}
            >
              Replace all
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => onApply(selectedRules)}
              disabled={selectedCount === 0}
            >
              Add selected
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
