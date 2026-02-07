import { Badge } from "@/components/ui/badge";

interface PassRateBadgeProps {
  rate: number;
  className?: string;
}

export function PassRateBadge({ rate, className }: PassRateBadgeProps) {
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
