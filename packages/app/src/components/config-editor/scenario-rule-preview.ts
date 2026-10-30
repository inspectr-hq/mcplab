import type { EvalRule } from '@/types/eval';
import { formatToolSequenceLabel } from '@/lib/data-sources/types';

function formatToolSequenceText(sequence: string[]): string {
  return formatToolSequenceLabel(sequence).replace(/^Tool sequence · /, '');
}

export function isToolAssertionRuleType(type: EvalRule['type']): boolean {
  return type.startsWith('tool_input_') || type.startsWith('tool_output_');
}

export function renderEvalRulePreview(rule: EvalRule): string {
  if (rule.type === 'agent_check') {
    return `${rule.type}: ${rule.label ?? ''} — ${rule.prompt ?? ''}`;
  }
  if (rule.type === 'tool_sequence') {
    return `${rule.type}: ${formatToolSequenceText(rule.sequence ?? [])}`;
  }
  if (isToolAssertionRuleType(rule.type)) {
    return `${rule.type}: ${rule.tool ?? ''}: ${renderEvalRuleValue(rule)}`;
  }
  if (rule.path) {
    return `${rule.type}: ${renderEvalRuleValue(rule)}`;
  }
  return `${rule.type}: ${rule.value ?? ''}`;
}

function renderEvalRuleValue(rule: EvalRule): string {
  return rule.path
    ? rule.equals !== undefined
      ? `${rule.path} == ${String(rule.equals)}`
      : rule.path
    : String(rule.value ?? '');
}
