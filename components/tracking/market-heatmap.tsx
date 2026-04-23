'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { FAMILY_LABELS_TR, SPORT_META } from '@/lib/hooks/tracking/types';
import type { FamilyPerformanceRow } from '@/lib/hooks/tracking/types';
import { formatPercent, formatRoi } from './format';

export interface MarketHeatmapProps {
  rows: FamilyPerformanceRow[];
  loading?: boolean;
}

/** Translate ROI into a background color intensity. */
function roiBg(
  roi: number | null | undefined,
  total: number | null | undefined
) {
  if (roi == null || !Number.isFinite(roi) || !total) {
    return 'bg-zinc-100 dark:bg-zinc-800/40 text-muted-foreground';
  }
  const magnitude = Math.min(Math.abs(roi), 0.4); // cap at 40%
  const step = magnitude / 0.4; // 0..1

  if (roi > 0.02) {
    if (step > 0.66)
      return 'bg-emerald-500 text-white dark:bg-emerald-500';
    if (step > 0.33)
      return 'bg-emerald-300 text-emerald-950 dark:bg-emerald-600 dark:text-white';
    return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100';
  }
  if (roi < -0.02) {
    if (step > 0.66) return 'bg-red-500 text-white dark:bg-red-500';
    if (step > 0.33)
      return 'bg-red-300 text-red-950 dark:bg-red-600 dark:text-white';
    return 'bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100';
  }
  return 'bg-zinc-100 dark:bg-zinc-800 text-muted-foreground';
}

export function MarketHeatmap({ rows, loading }: MarketHeatmapProps) {
  // Build pivot: sports (rows) × families (cols)
  const { sports, families, matrix } = React.useMemo(() => {
    const sportSet = new Set<string>();
    const familySet = new Set<string>();
    const map = new Map<string, FamilyPerformanceRow>();
    for (const r of rows) {
      sportSet.add(r.sport);
      familySet.add(r.family);
      map.set(`${r.sport}|${r.family}`, r);
    }
    return {
      sports: Array.from(sportSet),
      families: Array.from(familySet),
      matrix: map,
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="rounded-md border p-4">
        <div className="animate-pulse h-64 bg-muted rounded" />
      </div>
    );
  }

  if (!sports.length || !families.length) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Seçilen filtrelerle eşleşen veri bulunamadı.
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-auto bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 bg-card px-3 py-2 text-left font-medium text-muted-foreground">
              Spor / Market
            </th>
            {families.map(f => (
              <th
                key={f}
                className="px-2 py-2 font-medium text-muted-foreground text-left whitespace-nowrap"
              >
                {FAMILY_LABELS_TR[f] ?? f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sports.map(s => {
            const meta = SPORT_META[s as keyof typeof SPORT_META];
            return (
              <tr key={s} className="border-b last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 bg-card px-3 py-2 text-left font-semibold whitespace-nowrap"
                >
                  <span className="mr-1">{meta?.icon}</span>
                  {meta?.label ?? s}
                </th>
                {families.map(f => {
                  const cell = matrix.get(`${s}|${f}`);
                  return (
                    <td key={f} className="p-1">
                      <div
                        className={cn(
                          'rounded px-2 py-2 text-center min-w-[96px]',
                          roiBg(cell?.roi, cell?.total)
                        )}
                        title={
                          cell
                            ? `ROI ${formatRoi(cell.roi)} · İsabet ${formatPercent(cell.win_rate)} · ${cell.total} adet`
                            : 'Veri yok'
                        }
                      >
                        <div className="text-sm font-semibold tabular-nums">
                          {cell ? formatRoi(cell.roi) : '-'}
                        </div>
                        <div className="text-[10px] opacity-80">
                          {cell ? `${cell.total} adet` : ''}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
