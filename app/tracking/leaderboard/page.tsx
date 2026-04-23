'use client';


export const dynamic = 'force-dynamic';
import * as React from 'react';
import { Award, Medal, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PerformanceTable } from '@/components/tracking/performance-table';
import { PicksDrawer } from '@/components/tracking/picks-drawer';
import { QueryError } from '@/components/tracking/query-state';
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRoi,
  roiClass,
} from '@/components/tracking/format';
import { cn } from '@/lib/utils';
import { useTrackingFilters } from '@/lib/hooks/tracking/useTrackingFilters';
import { useLeaderboard } from '@/lib/hooks/tracking/useLeaderboard';
import {
  FAMILY_LABELS_TR,
  SPORT_META,
  type MarketPerformanceRow,
} from '@/lib/hooks/tracking/types';

const PODIUM_ICONS = [Trophy, Medal, Award];
const PODIUM_COLORS = [
  'from-amber-300/70 to-yellow-200/70 dark:from-amber-500/30 dark:to-yellow-500/20 border-amber-400/60',
  'from-zinc-200/70 to-zinc-100/70 dark:from-zinc-500/30 dark:to-zinc-400/20 border-zinc-400/60',
  'from-orange-300/70 to-amber-200/70 dark:from-orange-700/40 dark:to-amber-700/30 border-orange-400/60',
];

export default function LeaderboardPage() {
  const { filters } = useTrackingFilters();
  const [selected, setSelected] = React.useState<MarketPerformanceRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const leaderboard = useLeaderboard(filters, { limit: 50 });

  const rows = leaderboard.data ?? [];

  const top5 = rows.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Lider Tablosu</h2>
        <p className="text-sm text-muted-foreground">
          Tüm sporlar arasında en yüksek ROI üreten market kombinasyonları.
        </p>
      </div>

      {leaderboard.isError ? <QueryError error={leaderboard.error} /> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {leaderboard.isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))
          : top5.map((row, idx) => {
              const Icon = PODIUM_ICONS[Math.min(idx, 2)];
              const sportMeta = SPORT_META[row.sport];
              return (
                <button
                  key={`${row.sport}-${row.market}`}
                  type="button"
                  onClick={() => {
                    setSelected(row);
                    setDrawerOpen(true);
                  }}
                  className={cn(
                    'group rounded-lg border bg-gradient-to-br p-4 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring',
                    idx < 3 ? PODIUM_COLORS[idx] : 'from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="text-[11px] uppercase tracking-wider font-bold">
                      {idx + 1}. Sıra
                    </div>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-2 text-sm font-semibold leading-tight">
                    <span className="mr-1">{sportMeta?.icon}</span>
                    {row.market_label ?? row.market}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {sportMeta?.label} · {row.family ? FAMILY_LABELS_TR[row.family] : ''}
                  </div>
                  <div
                    className={cn(
                      'mt-3 text-2xl font-bold tabular-nums',
                      roiClass(row.roi)
                    )}
                  >
                    {formatRoi(row.roi)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatNumber(row.total)} adet · İsabet {formatPercent(row.win_rate)}
                  </div>
                </button>
              );
            })}
      </div>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">En çok kazandıran marketler</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {leaderboard.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Seçilen filtrelerde yeterli örneğe sahip market yok.
            </p>
          ) : (
            rows.map((row, idx) => {
              const sportMeta = SPORT_META[row.sport];
              const maxRoi = Math.max(...rows.map(r => Math.abs(r.roi)), 0.01);
              const barWidth = Math.max(4, (Math.abs(row.roi) / maxRoi) * 100);
              return (
                <button
                  type="button"
                  key={`${row.sport}-${row.market}`}
                  className="w-full text-left rounded-md border hover:bg-muted/50 transition-colors p-3 focus:outline-none focus:ring-2 focus:ring-ring"
                  onClick={() => {
                    setSelected(row);
                    setDrawerOpen(true);
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-xs font-mono tabular-nums text-muted-foreground w-7 text-right">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          <span className="mr-1.5">{sportMeta?.icon}</span>
                          {row.market_label ?? row.market}
                          <span className="ml-2 text-xs text-muted-foreground font-mono">
                            {row.market}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded bg-muted overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded transition-all',
                              row.roi >= 0 ? 'bg-emerald-500' : 'bg-red-500'
                            )}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          roiClass(row.roi)
                        )}
                      >
                        {formatRoi(row.roi)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatNumber(row.total)} adet · {formatMoney(row.profit)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Tüm Sıralama</CardTitle>
        </CardHeader>
        <CardContent>
          <PerformanceTable
            rows={rows}
            loading={leaderboard.isLoading}
            initialSortKey="roi"
            onRowClick={row => {
              setSelected(row);
              setDrawerOpen(true);
            }}
          />
        </CardContent>
      </Card>

      <PicksDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        market={selected}
        filters={filters}
      />
    </div>
  );
}
