import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getRunFailureSignal } from '@/lib/run-failure-signal';
import type { EvalResult } from '@/types/eval';

function classNameForKind(kind: 'auth' | 'rate_limit' | 'infra'): string {
  if (kind === 'auth') return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
  if (kind === 'rate_limit') return 'border-orange-500/30 bg-orange-500/10 text-orange-700';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-700';
}

export function RunFailureSignalBadge({ run }: { run: EvalResult }) {
  const signal = getRunFailureSignal(run);
  if (!signal) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`h-5 text-[10px] ${classNameForKind(signal.kind)}`}>
            {signal.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs">
          <p>{signal.detail}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
