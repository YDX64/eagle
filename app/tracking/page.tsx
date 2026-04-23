'use client';


export const dynamic = 'force-dynamic';
import * as React from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Coins,
  ListChecks,
  PieChart,
  Timer,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { KpiCard } from '@/components/tracking/kpi-card';
import { RoiBarChart, type RoiBarDatum } from '@/components/tracking/roi-bar-chart';
import { DailyVolumeChart } from '@/components/tracking/daily-volume-chart';
import { QueryError } from '@/components/tracking/query-state';
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRoi,
  roiClass,
  winRateClass,
} from '@/components/tracking/format';
import { useTrackingFilters } from '@/lib/hooks/tracking/useTrackingFilters';
import { useKpis } from '@/lib/hooks/tracking/useKpis';
import { useSportRoi } from '@/lib/hooks/tracking/useSportRoi';
import { useDailyVolume } from '@/lib/hooks/tracking/useDailyVolume';
import {
  SPORT_META,
  type SportCode,
} from '@/lib/hooks/tracking/types';

export default function TrackingOverviewPage() {
  const { filters } = useTrackingFilters();
  const kpis = useKpis(filters);
  const sportRoi = useSportRoi(filters);
  const daily = useDailyVolume(filters);

  const totalPicksSettled = React.useMemo(() => {
    if (!sportRoi.data) return 0;
    return sportRoi.data.reduce((s, r) => s + r.total, 0);
  }, [sportRoi.data]);

  const totalProfit = React.useMemo(() => {
    if (!sportRoi.data) return 0;
    return sportRoi.data.reduce((s, r) => s + r.profit, 0);
  }, [sportRoi.data]);

  const overallRoi = totalPicksSettled > 0 ? totalProfit / totalPicksSettled : 0;

  const chartData: RoiBarDatum[] = React.useMemo(() => {
    if (!sportRoi.data) return [];
    return sportRoi.data
      .slice()
      .sort((a, b) => b.roi - a.roi)
      .map(r => ({
        label: SPORT_META[r.sport]?.label ?? r.sport,
        icon: SPORT_META[r.sport]?.icon,
        roi: r.roi,
        total: r.total,
      }));
  }, [sportRoi.data]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Özet</h2>
        <p className="text-sm text-muted-foreground">
          Seçilen tarih aralığı ve sporlar için toplu tahmin istatistikleri.
        </p>
      </div>

      {kpis.isError ? <QueryError error={kpis.error} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Toplam Tahmin"
          value={formatNumber(kpis.data?.total_predictions)}
          loading={kpis.isLoading}
          accent="info"
          icon={<ListChecks className="h-4 w-4" />}
          trend={kpis.data?.trend_total}
        />
        <KpiCard
          label="Bekleyen"
          value={formatNumber(kpis.data?.pending)}
          loading={kpis.isLoading}
          accent="warning"
          icon={<Timer className="h-4 w-4" />}
          hint="Sonuç bekliyor"
        />
        <KpiCard
          label="Sonuçlanan"
          value={formatNumber(kpis.data?.settled)}
          loading={kpis.isLoading}
          accent="default"
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={`${formatNumber(kpis.data?.total_picks_won)} isabet`}
        />
        <KpiCard
          label="Kâr (TL)"
          value={formatMoney(totalProfit)}
          loading={kpis.isLoading || sportRoi.isLoading}
          accent={totalProfit >= 0 ? 'positive' : 'negative'}
          icon={<Coins className="h-4 w-4" />}
          hint={`Genel ROI ${formatRoi(overallRoi)}`}
          trend={kpis.data?.trend_profit ?? overallRoi}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart className="h-4 w-4" />
              Spora Göre ROI
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sportRoi.isLoading ? (
              <Skeleton className="h-[320px] w-full" />
            ) : sportRoi.isError ? (
              <QueryError error={sportRoi.error} />
            ) : (
              <RoiBarChart data={chartData} layout="vertical" height={320} />
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
          <CardHeader>
            <CardTitle className="text-base">En yüksek ROI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sportRoi.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sonuçlanmış tahmin yok.
              </p>
            ) : (
              chartData.slice(0, 5).map(d => (
                <div
                  key={d.label}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span>{d.icon}</span>
                    <span className="text-sm font-medium">{d.label}</span>
                  </div>
                  <div className="text-right">
                    <div
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        roiClass(d.roi)
                      )}
                    >
                      {formatRoi(d.roi)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {d.total} adet
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Spora Göre Detay</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href="/tracking/performance">Tümünü gör</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {sportRoi.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sportRoi.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Seçilen filtrelerde veri yok.
            </p>
          ) : (
            <SportRoiTable rows={sportRoi.data ?? []} />
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Günlük Tahmin Hacmi</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : daily.isError ? (
            <QueryError error={daily.error} />
          ) : (
            <DailyVolumeChart rows={daily.data ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SportRoiTable({
  rows,
}: {
  rows: Array<{
    sport: SportCode;
    total: number;
    hit: number;
    win_rate: number;
    roi: number;
    profit: number;
  }>;
}) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Spor</TableHead>
            <TableHead className="text-right">Toplam</TableHead>
            <TableHead className="text-right">İsabet</TableHead>
            <TableHead className="text-right">İsabet %</TableHead>
            <TableHead className="text-right">ROI</TableHead>
            <TableHead className="text-right">Kâr</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => {
            const meta = SPORT_META[r.sport];
            return (
              <TableRow key={r.sport}>
                <TableCell className="font-medium">
                  <span className="mr-1">{meta?.icon}</span>
                  {meta?.label ?? r.sport}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(r.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(r.hit)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    winRateClass(r.win_rate)
                  )}
                >
                  {formatPercent(r.win_rate)}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', roiClass(r.roi))}
                >
                  {formatRoi(r.roi)}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', roiClass(r.profit))}
                >
                  {formatMoney(r.profit)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
