import { Badge } from '@/components/ui/badge';
import { formatToolAnalysisTokenCount } from '@/lib/tool-analysis-token-estimates';
import { cn } from '@/lib/utils';

export function ToolTokenEstimateBadge({
  total,
  title = 'Estimated tokens for this tool definition and its schemas',
  className
}: {
  total?: number;
  title?: string;
  className?: string;
}) {
  if (typeof total !== 'number') return null;

  return (
    <Badge
      variant="outline"
      className={cn('bg-background font-mono text-xs font-normal', className)}
      title={title}
    >
      ~{formatToolAnalysisTokenCount(total)}tok
    </Badge>
  );
}
