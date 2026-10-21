import { ToolAlternativesDisplay } from '@/components/ToolAlternativesDisplay';
import { formatEvalRuleLabel } from '@/lib/check-presentation';
import type { EvalRule } from '@/types/eval';

export function EvalRuleLabel({ rule, className }: { rule: EvalRule; className?: string }) {
  if (rule.type === 'required_tool' || rule.type === 'forbidden_tool') {
    const label = rule.type === 'required_tool' ? 'Required tool' : 'Forbidden tool';
    return (
      <span className={`inline-flex flex-wrap items-center gap-x-1 ${className ?? ''}`}>
        {label} · <ToolAlternativesDisplay value={String(rule.value ?? '')} />
      </span>
    );
  }

  if (
    rule.type === 'tool_input_contains' ||
    rule.type === 'tool_input_regex' ||
    rule.type === 'tool_input_jsonpath'
  ) {
    const tool = String(rule.tool ?? '');
    const label = formatEvalRuleLabel(rule);
    const prefix = `Tool input · ${tool}`;
    return (
      <span className={className}>
        Tool input · <span className="font-mono">{tool}</span>
        {label.slice(prefix.length)}
      </span>
    );
  }

  return <span className={className}>{formatEvalRuleLabel(rule)}</span>;
}
