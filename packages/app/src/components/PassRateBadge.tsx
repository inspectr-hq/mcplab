import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PassRateBadgeProps {
  rate: number;
  className?: string;
  ungraded?: boolean;
}

export function PassRateBadge({ rate, className, ungraded }: PassRateBadgeProps) {
  if (ungraded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className={`font-mono text-xs border-0 bg-[rgba(245,158,11,0.18)] text-[rgb(245,158,11)] hover:bg-[rgba(245,158,11,0.22)] ${className ?? ""}`}
          >
            Ungraded
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="text-xs">Checks were skipped for this run</TooltipContent>
      </Tooltip>
    );
  }

  const pct = Math.round(rate * 100);
  const variant = pct >= 80 ? "default" : pct >= 50 ? "secondary" : "destructive";

  return (
    <Badge
      variant={variant}
      className={`font-mono text-xs ${
        pct >= 80
          ? "bg-success/15 text-success hover:bg-success/20 border-0"
          : pct >= 50
          ? "bg-warning/15 text-warning hover:bg-warning/20 border-0"
          : "bg-destructive/15 text-destructive hover:bg-destructive/20 border-0"
      } ${className ?? ""}`}
    >
      {pct}%
    </Badge>
  );
}
