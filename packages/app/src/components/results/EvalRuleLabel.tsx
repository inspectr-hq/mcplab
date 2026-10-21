import { ToolAlternativesDisplay } from '@/components/ToolAlternativesDisplay';
import { formatEvalRuleLabel } from '@/lib/check-presentation';
import type { EvalRule } from '@/types/eval';

export function EvalRuleLabel({
  rule,
  className
}: {
  rule: EvalRule;
  className?: string;
}) {
  return (
    <span className={className}>
      {rule.type === 'required_tool' ? (
        <span className="inline-flex flex-wrap items-center gap-x-1">
          <span>Required tool ·</span>
          <ToolAlternativesDisplay value={String(rule.value ?? '')} />
        </span>
      ) : (
        formatEvalRuleLabel(rule)
      )}
    </span>
  );
}
