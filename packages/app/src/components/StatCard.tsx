import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  compact?: boolean;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  compact = false
}: StatCardProps) {
  return (
    <Card className={compact ? 'h-fit self-start' : undefined}>
      <CardContent className={compact ? 'p-2' : 'p-4'}>
        <div className="flex items-start justify-between">
          <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className={compact ? 'text-lg font-bold' : 'text-2xl font-bold'}>{value}</p>
            {subtitle && (
              <p
                className={`text-xs ${
                  trend === 'up'
                    ? 'text-success'
                    : trend === 'down'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {trend === 'up' && '↑ '}
                {trend === 'down' && '↓ '}
                {subtitle}
              </p>
            )}
          </div>
          <div
            className={compact ? 'rounded-lg bg-primary/10 p-0.5' : 'rounded-lg bg-primary/10 p-2'}
          >
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
