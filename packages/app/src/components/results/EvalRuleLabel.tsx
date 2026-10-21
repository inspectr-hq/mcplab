import { ToolAlternativesDisplay } from '@/components/ToolAlternativesDisplay';
import { formatEvalRuleLabel } from '@/lib/check-presentation';
import type { EvalRule } from '@/types/eval';

export function EvalRuleLabel({ rule, className }: { rule: EvalRule; className?: string }) {
  if (rule.type === 'required_tool') {
    return (
      <span className={`inline-flex flex-wrap items-center gap-x-1 ${className ?? ''}`}>
        Required tool ·{' '}
        <ToolAlternativesDisplay value={String(rule.value ?? '')} />
      </span>
    );
  }

  return <span className={className}>{formatEvalRuleLabel(rule)}</span>;
}
