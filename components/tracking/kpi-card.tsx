'use client';

import * as React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  /** Signed number indicating movement vs previous period. */
  trend?: number | null;
  /** When true, the trend delta is treated as a percentage already. */
  trendIsPercent?: boolean;
  accent?: 'default' | 'positive' | 'negative' | 'warning' | 'info';
  icon?: React.ReactNode;
  loading?: boolean;
}

const accentMap: Record<NonNullable<KpiCardProps['accent']>, string> = {
  default:
    'from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950 border-zinc-200 dark:border-zinc-800',
  positive:
    'from-emerald-50 to-white dark:from-emerald-950/30 dark:to-zinc-950 border-emerald-200 dark:border-emerald-900/50',
  negative:
    'from-red-50 to-white dark:from-red-950/30 dark:to-zinc-950 border-red-200 dark:border-red-900/50',
  warning:
    'from-amber-50 to-white dark:from-amber-950/30 dark:to-zinc-950 border-amber-200 dark:border-amber-900/50',
  info:
    'from-sky-50 to-white dark:from-sky-950/30 dark:to-zinc-950 border-sky-200 dark:border-sky-900/50',
};

export function KpiCard({
  label,
  value,
  hint,
  trend,
  trendIsPercent,
  accent = 'default',
  icon,
  loading,
}: KpiCardProps) {
  if (loading) {
    return (
      <Card className={cn('bg-gradient-to-br', accentMap[accent])}>
        <CardContent className="p-5">
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  const trendMeta = React.useMemo(() => {
    if (trend == null || !Number.isFinite(trend)) return null;
    const positive = trend > 0;
    const neutral = trend === 0;
    const pct = trendIsPercent ? trend : trend * 100;
    const text = `${positive ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`;
    return {
      text,
      Icon: neutral ? ArrowRight : positive ? ArrowUpRight : ArrowDownRight,
      className: neutral
        ? 'text-muted-foreground'
        : positive
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400',
    };
  }, [trend, trendIsPercent]);

  return (
    <Card
      className={cn(
        'bg-gradient-to-br border shadow-sm hover:shadow-md transition-shadow',
        accentMap[accent]
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </div>
          {icon ? (
            <div className="text-muted-foreground/70">{icon}</div>
          ) : null}
        </div>
        <div className="mt-2 text-3xl font-bold tabular-nums text-foreground break-all">
          {value}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          {trendMeta ? (
            <span className={cn('inline-flex items-center gap-1', trendMeta.className)}>
              <trendMeta.Icon className="h-3.5 w-3.5" />
              {trendMeta.text}
            </span>
          ) : null}
          {hint ? (
            <span className="text-muted-foreground">{hint}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
