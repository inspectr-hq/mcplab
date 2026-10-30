import type { EvalRule } from '@/types/eval';
import { ToolAlternativesDisplay } from '@/components/ToolAlternativesDisplay';
import { ToolSequenceDisplay } from './ToolAlternativesEditor';
import { isToolAssertionRuleType } from './scenario-rule-preview';

const ruleTypeLabel: Record<EvalRule['type'], string> = {
  required_tool: 'Required',
  forbidden_tool: 'Forbidden',
  tool_sequence: 'Sequence',
  tool_input_contains: 'Input Contains',
  tool_input_regex: 'Input Regex',
  tool_input_jsonpath: 'Input JSONPath',
  tool_output_contains: 'Output Contains',
  tool_output_regex: 'Output Regex',
  tool_output_jsonpath: 'Output JSONPath',
  response_contains: 'Contains',
  response_not_contains: 'Not Contains',
  response_starts_with: 'Starts With',
  response_ends_with: 'Ends With',
  response_equals: 'Equals',
  response_regex: 'Regex',
  response_jsonpath: 'JSONPath',
  response_jsonpath_exists: 'JSONPath Exists',
  response_jsonpath_not_exists: 'JSONPath Not Exists',
  agent_check: 'Agent'
};

const ruleTypeBadgeColor: Record<EvalRule['type'], string> = {
  required_tool: 'border-sky-300/60 bg-sky-500/10 text-sky-700',
  forbidden_tool: 'border-rose-300/60 bg-rose-500/10 text-rose-700',
  tool_sequence: 'border-teal-300/60 bg-teal-500/10 text-teal-700',
  tool_input_contains: 'border-blue-300/60 bg-blue-500/10 text-blue-700',
  tool_input_regex: 'border-blue-300/60 bg-blue-500/10 text-blue-700',
  tool_input_jsonpath: 'border-blue-300/60 bg-blue-500/10 text-blue-700',
  tool_output_contains: 'border-blue-400/60 bg-blue-600/10 text-blue-800',
  tool_output_regex: 'border-blue-400/60 bg-blue-600/10 text-blue-800',
  tool_output_jsonpath: 'border-blue-400/60 bg-blue-600/10 text-blue-800',
  response_contains: 'border-violet-300/60 bg-violet-500/10 text-violet-700',
  response_not_contains: 'border-amber-300/60 bg-amber-500/10 text-amber-700',
  response_starts_with: 'border-cyan-300/60 bg-cyan-500/10 text-cyan-700',
  response_ends_with: 'border-indigo-300/60 bg-indigo-500/10 text-indigo-700',
  response_equals: 'border-lime-300/60 bg-lime-500/10 text-lime-700',
  response_regex: 'border-fuchsia-300/60 bg-fuchsia-500/10 text-fuchsia-700',
  response_jsonpath: 'border-emerald-300/60 bg-emerald-500/10 text-emerald-700',
  response_jsonpath_exists: 'border-green-300/60 bg-green-500/10 text-green-700',
  response_jsonpath_not_exists: 'border-orange-300/60 bg-orange-500/10 text-orange-700',
  agent_check: 'border-teal-300/60 bg-teal-500/10 text-teal-700'
};

function CheckValue({ rule }: { rule: EvalRule }) {
  if (rule.type === 'agent_check') {
    return (
      <div className="min-w-0">
        <div className="font-medium leading-tight">{rule.label || 'Unnamed check'}</div>
        {rule.prompt && (
          <div className="mt-0.5 wrap-break-word text-[11px] leading-snug text-muted-foreground">
            {rule.prompt}
          </div>
        )}
      </div>
    );
  }
  if (rule.type === 'tool_sequence') {
    return rule.sequence?.length ? (
      <ToolSequenceDisplay sequence={rule.sequence} />
    ) : (
      <span>No tool steps</span>
    );
  }
  if (isToolAssertionRuleType(rule.type)) {
    const toolName = <span className="font-mono">{rule.tool}</span>;
    if (rule.type.endsWith('_contains'))
      return (
        <span className="break-all">
          {toolName} contains {String(rule.value)}
        </span>
      );
    if (rule.type.endsWith('_regex'))
      return (
        <span className="break-all">
          {toolName} matches {String(rule.value)}
        </span>
      );
    return (
      <span className="break-all">
        {toolName} · {rule.path} ·{' '}
        {rule.equals !== undefined ? `== ${String(rule.equals)}` : 'exists'}
      </span>
    );
  }
  if (rule.type === 'required_tool')
    return (
      <span className="font-mono break-all">
        <ToolAlternativesDisplay value={String(rule.value ?? '')} />
      </span>
    );
  const value =
    rule.path && rule.equals !== undefined
      ? `${rule.path} == ${String(rule.equals)}`
      : rule.path || rule.value;
  return <span className="font-mono break-all">{value}</span>;
}

export function CheckDisplay({ rule }: { rule: EvalRule }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rule.type === 'agent_check' ? 'self-start' : ''} ${ruleTypeBadgeColor[rule.type]}`}
        >
          {ruleTypeLabel[rule.type]}
        </span>
        <CheckValue rule={rule} />
      </div>
    </div>
  );
}
