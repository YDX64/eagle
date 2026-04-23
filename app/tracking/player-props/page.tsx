'use client';


export const dynamic = 'force-dynamic';
import * as React from 'react';
import { UserCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { QueryError } from '@/components/tracking/query-state';
import {
  formatDecimal,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRoi,
  roiClass,
  winRateClass,
} from '@/components/tracking/format';
import { useTrackingFilters } from '@/lib/hooks/tracking/useTrackingFilters';
import { usePlayerProps } from '@/lib/hooks/tracking/usePlayerProps';
import {
  SPORT_META,
  type PlayerPropPerformanceRow,
} from '@/lib/hooks/tracking/types';

export default function PlayerPropsPage() {
  const { filters } = useTrackingFilters();
  const playerProps = usePlayerProps(filters);

  const rows = playerProps.data ?? [];

  const top20 = React.useMemo(
    () => [...rows].sort((a, b) => b.roi - a.roi).slice(0, 20),
    [rows]
  );

  const bySport = React.useMemo(() => {
    const map = new Map<string, PlayerPropPerformanceRow[]>();
    for (const r of rows) {
      const arr = map.get(r.sport) ?? [];
      arr.push(r);
      map.set(r.sport, arr);
    }
    return Array.from(map.entries()).map(([sport, items]) => ({
      sport,
      items: items.sort((a, b) => b.roi - a.roi),
    }));
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <UserCircle2 className="h-5 w-5" />
          Oyuncu Marketleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Basketbol, hokey ve beyzbol oyuncu bazlı markert performans analizi.
        </p>
      </div>

      {playerProps.isError ? <QueryError error={playerProps.error} /> : null}

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">
            Top 20 · En kârlı oyuncu marketleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          {playerProps.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : top20.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Sonuçlanmış oyuncu marketi bulunamadı.
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sıra</TableHead>
                    <TableHead>Spor</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead>Yön</TableHead>
                    <TableHead className="text-right">Toplam</TableHead>
                    <TableHead className="text-right">İsabet</TableHead>
                    <TableHead className="text-right">İsabet %</TableHead>
                    <TableHead className="text-right">Ort. Oran</TableHead>
                    <TableHead className="text-right">ROI</TableHead>
                    <TableHead className="text-right">Kâr</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top20.map((row, idx) => {
                    const meta = SPORT_META[row.sport];
                    return (
                      <TableRow key={`${row.sport}-${row.market}-${row.selection}`}>
                        <TableCell className="tabular-nums text-sm font-semibold text-muted-foreground">
                          #{idx + 1}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="mr-1">{meta?.icon}</span>
                          {meta?.label}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.market_label ?? row.market}
                          <div className="text-xs text-muted-foreground font-mono">
                            {row.market}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.selection === 'OVER' || row.selection === 'YES'
                                ? 'default'
                                : 'secondary'
                            }
                            className="text-[11px]"
                          >
                            {row.selection === 'OVER'
                              ? 'ÜST'
                              : row.selection === 'UNDER'
                                ? 'ALT'
                                : row.selection === 'YES'
                                  ? 'EVET'
                                  : 'HAYIR'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(row.total)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(row.hit)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            winRateClass(row.win_rate)
                          )}
                        >
                          {formatPercent(row.win_rate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDecimal(row.avg_odds)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            roiClass(row.roi)
                          )}
                        >
                          {formatRoi(row.roi)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            roiClass(row.profit)
                          )}
                        >
                          {formatMoney(row.profit)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {playerProps.isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-80 w-full" />
            ))
          : bySport.map(group => {
              const meta = SPORT_META[group.sport as keyof typeof SPORT_META];
              return (
                <Card
                  key={group.sport}
                  className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950"
                >
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span>{meta?.icon}</span>
                      {meta?.label ?? group.sport}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-auto max-h-96">
                      <Table>
                        <TableHeader className="sticky top-0 bg-card">
                          <TableRow>
                            <TableHead>Market</TableHead>
                            <TableHead>Yön</TableHead>
                            <TableHead className="text-right">n</TableHead>
                            <TableHead className="text-right">İsabet %</TableHead>
                            <TableHead className="text-right">ROI</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.items.slice(0, 25).map(row => (
                            <TableRow key={`${row.market}-${row.selection}`}>
                              <TableCell className="text-sm font-medium">
                                {row.market_label ?? row.market}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">
                                  {row.selection}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatNumber(row.total)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'text-right tabular-nums',
                                  winRateClass(row.win_rate)
                                )}
                              >
                                {formatPercent(row.win_rate)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'text-right tabular-nums',
                                  roiClass(row.roi)
                                )}
                              >
                                {formatRoi(row.roi)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>
    </div>
  );
}
