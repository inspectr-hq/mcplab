import { useState } from 'react';
import { AssistantToolCallCard } from '@/components/assistant/AssistantChat';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { invokeGlobalCopilotAction } from '@/lib/global-copilot-actions';
import { formatEvalRuleLabel } from '@/lib/check-presentation';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';
import type { EvalRule } from '@/types/eval';

type Respond = (result: unknown) => Promise<void>;

export function FrontendApprovalCard({
  name,
  args,
  respond
}: {
  name: Parameters<typeof invokeGlobalCopilotAction>[0];
  args: Record<string, unknown>;
  respond?: Respond;
}) {
  const decide = async (approved: boolean) => {
    if (!respond) return;
    if (!approved) return respond({ approved: false, reason: 'Denied by user.' });
    try {
      const result = await invokeGlobalCopilotAction(name, args);
      await respond({ approved: true, result });
    } catch (error: unknown) {
      await respond({
        approved: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
  return (
    <AssistantToolCallCard
      call={{
        id: `frontend-${name}`,
        server: 'mcplab',
        tool: name.replaceAll('_', ' '),
        publicToolName: name,
        arguments: args,
        status: respond ? 'pending' : 'approved',
        createdAt: new Date().toISOString()
      }}
      description="This action uses the current page state and requires confirmation."
      onApprove={() => void decide(true)}
      onDeny={() => void decide(false)}
    />
  );
}

export function ScenarioSuggestionCard({
  args,
  respond
}: {
  args: Record<string, unknown>;
  respond?: Respond;
}) {
  const [applied, setApplied] = useState<string[]>([]);
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const scenarioId = typeof args.scenarioId === 'string' ? args.scenarioId : '';
  const prompt = typeof args.prompt === 'string' ? args.prompt : undefined;
  const evalRules = Array.isArray(args.evalRules) ? args.evalRules.filter(isRecord) : undefined;
  const extractRules = Array.isArray(args.extractRules)
    ? args.extractRules.filter(isRecord)
    : undefined;
  const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;
  const apply = async (field: 'prompt' | 'evalRules' | 'extractRules', value: unknown) => {
    if (inFlight.has(field)) return;
    setInFlight((current) => new Set(current).add(field));
    try {
      await invokeGlobalCopilotAction('apply_scenario_patch', { scenarioId, [field]: value });
      setApplied((current) => (current.includes(field) ? current : [...current, field]));
    } catch (error: unknown) {
      toast({
        title: 'Could not apply suggestion',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setInFlight((current) => {
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    }
  };
  const applyRules = async (
    field: 'evalRules' | 'extractRules',
    rules: Record<string, unknown>[],
    mode: 'append' | 'replace',
    key?: string
  ) => {
    const actionKey = key ?? field;
    if (inFlight.has(actionKey)) return false;
    setInFlight((current) => new Set(current).add(actionKey));
    try {
      await invokeGlobalCopilotAction('apply_scenario_patch', {
        scenarioId,
        [field]: rules,
        [field === 'evalRules' ? 'evalRuleMode' : 'extractRuleMode']: mode
      });
      if (key) setApplied((current) => (current.includes(key) ? current : [...current, key]));
      else setApplied((current) => (current.includes(field) ? current : [...current, field]));
      return true;
    } catch (error: unknown) {
      toast({
        title: 'Could not apply suggestion',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
      return false;
    } finally {
      setInFlight((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  };
  return (
    <div className="rounded-md border border-sky-400/40 bg-sky-50 p-3 text-sm">
      <p className="font-medium">Scenario suggestions{scenarioId ? ` · ${scenarioId}` : ''}</p>
      {rationale && <p className="mt-1 text-xs text-muted-foreground">{rationale}</p>}
      <div className="mt-3 space-y-2">
        {prompt && (
          <SuggestionSection
            label="Prompt"
            value={prompt}
            applied={applied.includes('prompt')}
            onApply={() => void apply('prompt', prompt)}
          />
        )}
        {evalRules && (
          <RuleSuggestionSection
            label="Checks"
            rules={evalRules}
            applied={applied.includes('evalRules')}
            onApplySelected={(rules) => void applyRules('evalRules', rules, 'append')}
            onReplaceSelected={(rules) => void applyRules('evalRules', rules, 'replace')}
            onApplyOne={(rule, index) =>
              applyRules('evalRules', [rule], 'append', `evalRules:add:${index}`)
            }
            onReplaceOne={(rule, index) =>
              applyRules('evalRules', [rule], 'replace', `evalRules:replace:${index}`)
            }
          />
        )}
        {extractRules && (
          <RuleSuggestionSection
            label="Value Capture Rules"
            rules={extractRules}
            applied={applied.includes('extractRules')}
            onApplySelected={(rules) => void applyRules('extractRules', rules, 'append')}
            onReplaceSelected={(rules) => void applyRules('extractRules', rules, 'replace')}
            onApplyOne={(rule, index) =>
              applyRules('extractRules', [rule], 'append', `extractRules:add:${index}`)
            }
            onReplaceOne={(rule, index) =>
              applyRules('extractRules', [rule], 'replace', `extractRules:replace:${index}`)
            }
          />
        )}
      </div>
      {respond && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => void respond({ approved: true, applied, scenarioId })}>
            Done
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void respond({ approved: false, reason: 'No suggestions applied.' })}
          >
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function formatCopilotRuleLabel(rule: Record<string, unknown>, label: string) {
  if (label === 'Checks') return formatEvalRuleLabel(rule as EvalRule);
  const name = typeof rule.name === 'string' ? rule.name : 'Value capture rule';
  const pattern = typeof rule.pattern === 'string' ? rule.pattern : rule.regex;
  return `${name} · ${typeof pattern === 'string' ? pattern : 'Pattern not specified'}`;
}

function RuleSuggestionSection({
  label,
  rules,
  applied,
  onApplySelected,
  onReplaceSelected,
  onApplyOne,
  onReplaceOne
}: {
  label: string;
  rules: Record<string, unknown>[];
  applied: boolean;
  onApplySelected: (rules: Record<string, unknown>[]) => void;
  onReplaceSelected: (rules: Record<string, unknown>[]) => void;
  onApplyOne: (rule: Record<string, unknown>, index: number) => Promise<boolean> | void;
  onReplaceOne: (rule: Record<string, unknown>, index: number) => Promise<boolean> | void;
}) {
  const [selectedIndexes, setSelectedIndexes] = useState(
    () => new Set(rules.map((_, index) => index))
  );
  const [itemActions, setItemActions] = useState<Set<string>>(new Set());
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const selectedRules = rules.filter((_, index) => selectedIndexes.has(index));
  const allSelected = selectedIndexes.size === rules.length;
  return (
    <div className="rounded border bg-background p-2">
      <span className="text-sm font-semibold">{label}</span>
      <p className="mt-1 text-xs text-muted-foreground">Suggested {label} update</p>
      <div className="mt-2 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-muted-foreground">
            {selectedIndexes.size} of {rules.length} selected
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
          const item = label === 'Checks' ? 'check' : 'value capture rule';
          const addKey = `add-${index}`;
          const replaceKey = `replace-${index}`;
          return (
            <div
              key={`${label}-${index}`}
              className="flex items-start gap-2 rounded bg-muted/50 p-2"
            >
              <Checkbox
                checked={selectedIndexes.has(index)}
                disabled={applied}
                onCheckedChange={(checked) =>
                  setSelectedIndexes((current) => {
                    const next = new Set(current);
                    checked === true ? next.add(index) : next.delete(index);
                    return next;
                  })
                }
                aria-label={`Select ${item} ${index + 1}`}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <span className="block text-xs font-medium">
                  {formatCopilotRuleLabel(rule, label)}
                </span>
                <code className="block break-words rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
                  {JSON.stringify(rule)}
                </code>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={applied || itemActions.has(addKey) || pendingActions.has(addKey)}
                  aria-label={`Add ${item} ${index + 1}`}
                  onClick={() => {
                    setPendingActions((current) => new Set(current).add(addKey));
                    void Promise.resolve(onApplyOne(rule, index))
                      .then((succeeded) => {
                        if (succeeded !== false)
                          setItemActions((current) => new Set(current).add(addKey));
                      })
                      .finally(() =>
                        setPendingActions((current) => {
                          const next = new Set(current);
                          next.delete(addKey);
                          return next;
                        })
                      );
                  }}
                >
                  {itemActions.has(addKey) ? 'Added' : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={
                    applied || itemActions.has(replaceKey) || pendingActions.has(replaceKey)
                  }
                  aria-label={`Replace with ${item} ${index + 1}`}
                  onClick={() => {
                    setPendingActions((current) => new Set(current).add(replaceKey));
                    void Promise.resolve(onReplaceOne(rule, index))
                      .then((succeeded) => {
                        if (succeeded !== false)
                          setItemActions((current) => new Set(current).add(replaceKey));
                      })
                      .finally(() =>
                        setPendingActions((current) => {
                          const next = new Set(current);
                          next.delete(replaceKey);
                          return next;
                        })
                      );
                  }}
                >
                  {itemActions.has(replaceKey) ? 'Replaced' : 'Replace'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {applied ? (
          <Button type="button" size="sm" variant="secondary" disabled>
            Applied
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedRules.length === 0}
              onClick={() => onReplaceSelected(selectedRules)}
            >
              Replace all
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selectedRules.length === 0}
              onClick={() => onApplySelected(selectedRules)}
            >
              Add selected
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionSection({
  label,
  value,
  applied,
  onApply
}: {
  label: string;
  value: string;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <div className="rounded border bg-background p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <Button
          size="sm"
          variant={applied ? 'secondary' : 'outline'}
          disabled={applied}
          onClick={onApply}
        >
          {applied ? 'Applied' : 'Apply'}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Suggested {label.toLowerCase()} update</p>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
        {value}
      </pre>
    </div>
  );
}

export function ScenarioDraftCard({
  args,
  respond
}: {
  args: Record<string, unknown>;
  respond?: Respond;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState({ evalRules: true, extractRules: true });
  const id = typeof args.id === 'string' ? args.id : '';
  const prompt = typeof args.prompt === 'string' ? args.prompt : '';
  const servers = Array.isArray(args.servers) ? args.servers : [];
  const evalRules = Array.isArray(args.evalRules) ? args.evalRules : [];
  const extractRules = Array.isArray(args.extractRules) ? args.extractRules : [];
  const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;
  const create = async () => {
    if (!respond || creating) return;
    setCreating(true);
    try {
      const result = await invokeGlobalCopilotAction('create_test_case_from_draft', {
        ...args,
        evalRules: selected.evalRules ? evalRules : [],
        extractRules: selected.extractRules ? extractRules : []
      });
      await respond({ approved: true, result });
    } catch (error: unknown) {
      toast({
        title: 'Could not create Test Case',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setCreating(false);
    }
  };
  return (
    <div className="rounded-md border border-violet-400/40 bg-violet-50 p-3 text-sm">
      <p className="font-medium">New Test Case draft{id ? ` · ${id}` : ''}</p>
      {rationale && <p className="mt-1 text-xs text-muted-foreground">{rationale}</p>}
      <div className="mt-2 rounded border bg-background p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Prompt</span>
          <Button size="sm" variant="secondary" disabled>
            Included
          </Button>
        </div>
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
          {prompt}
        </pre>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Servers: {servers.join(', ') || 'none'}</p>
      <DraftToggle
        label={`Checks (${evalRules.length})`}
        selected={selected.evalRules}
        onToggle={() => setSelected((current) => ({ ...current, evalRules: !current.evalRules }))}
      />
      <DraftToggle
        label={`Value Capture Rules (${extractRules.length})`}
        selected={selected.extractRules}
        onToggle={() =>
          setSelected((current) => ({ ...current, extractRules: !current.extractRules }))
        }
      />
      {respond && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={creating || !id || !prompt} onClick={() => void create()}>
            {creating ? 'Creating...' : 'Create Test Case'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={creating}
            onClick={() => void respond({ approved: false, reason: 'Draft creation denied.' })}
          >
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}
function DraftToggle({
  label,
  selected,
  onToggle
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? 'secondary' : 'outline'}
      className="mt-2 w-full justify-start text-xs"
      onClick={onToggle}
    >
      {selected ? '✓' : '○'}&nbsp; {selected ? 'Include' : 'Exclude'} {label}
    </Button>
  );
}

export function NativeInterruptCard({
  message,
  onDecision
}: {
  message: GlobalCopilotMessage;
  onDecision: (approved: boolean) => void;
}) {
  const action = message.action;
  if (!action) return null;
  if (action.kind === 'continue_reading')
    return (
      <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm">
        <p>
          Allow up to {action.batchSize} additional read-only MCPLab tool calls to continue this
          investigation?
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onDecision(true)}>
            Continue
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecision(false)}>
            Stop here
          </Button>
        </div>
      </div>
    );
  if (action.kind !== 'external_mcp_tool') return null;
  return (
    <AssistantToolCallCard
      call={{
        id: message.id,
        server: action.serverName,
        tool: action.toolName,
        publicToolName: `${action.serverName}__${action.toolName}`,
        arguments: action.arguments,
        status: 'pending',
        createdAt: message.createdAt
      }}
      description={`MCP call on ${action.serverName}.`}
      onApprove={() => onDecision(true)}
      onDeny={() => onDecision(false)}
    />
  );
}

export function globalCopilotInterruptMessage(interrupt: {
  id: string;
  metadata?: Record<string, any>;
}): GlobalCopilotMessage {
  const mastra = interrupt.metadata?.mastra as
    | {
        toolName?: string;
        suspendPayload?: Record<string, unknown>;
        args?: Record<string, unknown>;
      }
    | undefined;
  return globalCopilotInterruptMessageFromMastra(interrupt.id, mastra);
}

export function globalCopilotInterruptMessageFromMastra(
  id: string,
  mastra?: {
    toolName?: string;
    suspendPayload?: Record<string, unknown>;
    args?: Record<string, unknown>;
  }
): GlobalCopilotMessage {
  const payload = mastra?.suspendPayload ?? {};
  if (payload.kind === 'continue_reading')
    return {
      id,
      role: 'system',
      content: `Additional MCPLab read-tool batch requested (${Number(
        payload.batchSize ?? 5
      )} calls).`,
      createdAt: new Date().toISOString(),
      action: {
        kind: 'continue_reading',
        batchSize: Number(payload.batchSize ?? 5),
        status: 'pending'
      }
    };
  return {
    id,
    role: 'system',
    content: `MCP call requested: ${String(payload.serverName ?? 'mcplab')}/${String(
      payload.toolName ?? mastra?.toolName ?? 'tool'
    )}`,
    createdAt: new Date().toISOString(),
    action: {
      kind: 'external_mcp_tool',
      serverName: String(payload.serverName ?? 'mcplab'),
      toolName: String(payload.toolName ?? mastra?.toolName ?? 'tool'),
      arguments: (payload.arguments ?? mastra?.args ?? {}) as Record<string, unknown>,
      status: 'pending'
    }
  };
}
