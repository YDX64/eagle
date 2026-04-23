'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Brain, TrendingUp, TrendingDown } from 'lucide-react';

interface EnginePerf {
  sport: string;
  engine: string;
  family: string;
  total: number;
  hit: number;
  win_rate: number;
  avg_probability: number;
  avg_odds: number;
  profit: number | null;
  roi: number | null;
  picks_with_odds: number;
}

const SPORT_ICONS: Record<string, string> = {
  football: '⚽', basketball: '🏀', nba: '🏆',
  hockey: '🏒', handball: '🤾', volleyball: '🏐', baseball: '⚾',
};

const FAMILY_LABELS_TR: Record<string, string> = {
  match_winner: 'Maç Sonucu',
  totals: 'Üst/Alt',
  handicap: 'Handikap',
  btts: 'Karşılıklı Gol',
  double_chance: 'Çifte Şans',
  cards: 'Kart',
  corners: 'Korner',
  first_half: 'İlk Yarı',
  ht_ft: 'İY/MS',
  other: 'Diğer',
};

export default function EnginePerformancePage() {
  const [minSample, setMinSample] = React.useState(10);
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<EnginePerf[]>([]);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/tracking/engine-performance?min_sample=${minSample}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => j?.success && setData(j.data))
      .finally(() => setLoading(false));
  }, [minSample]);

  // Group by engine for overview cards
  const byEngine = React.useMemo(() => {
    const map = new Map<string, { total: number; hit: number; profit: number; withOdds: number }>();
    for (const row of data) {
      const cur = map.get(row.engine) ?? { total: 0, hit: 0, profit: 0, withOdds: 0 };
      cur.total += row.total;
      cur.hit += row.hit;
      cur.profit += row.profit ?? 0;
      cur.withOdds += row.picks_with_odds;
      map.set(row.engine, cur);
    }
    return Array.from(map.entries())
      .map(([engine, v]) => ({
        engine,
        total: v.total,
        hit: v.hit,
        win_rate: v.total > 0 ? v.hit / v.total : 0,
        profit: v.profit,
        roi: v.withOdds > 0 ? v.profit / v.withOdds : null,
      }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  // Best engine per (sport, family) for "master recommendation"
  const bestBySportFamily = React.useMemo(() => {
    const buckets = new Map<string, EnginePerf[]>();
    for (const row of data) {
      const key = `${row.sport}|${row.family}`;
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .map(([key, list]) => {
        const [sport, family] = key.split('|');
        // Rank by ROI if available else win_rate
        const sorted = [...list].sort((a, b) => {
          if (a.roi != null && b.roi != null) return b.roi - a.roi;
          return b.win_rate - a.win_rate;
        });
        return { sport, family, best: sorted[0], alternatives: sorted.slice(1) };
      })
      .sort((a, b) => b.best.total - a.best.total);
  }, [data]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Motor Karşılaştırması
        </h2>
        <p className="text-sm text-muted-foreground">
          Her tahmin motorunun (engine) spor × market ailesi bazında performansı. Master Ensemble buradan beslenir.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filtre</CardTitle>
        </CardHeader>
        <CardContent>
          <Label className="text-xs text-muted-foreground uppercase">
            Minimum örnek sayısı: {minSample}
          </Label>
          <Slider value={[minSample]} min={1} max={200} step={1} onValueChange={v => setMinSample(v[0])} />
        </CardContent>
      </Card>

      {/* Per-engine summary cards */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Motor Özeti
        </h3>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {byEngine.map(e => (
              <Card key={e.engine} className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{e.engine}</span>
                    <Badge variant="outline">{e.total.toLocaleString('tr-TR')}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">İsabet</div>
                      <div className="font-bold text-emerald-600">
                        %{(e.win_rate * 100).toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Kâr</div>
                      <div className={`font-bold ${e.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {e.profit >= 0 ? '+' : ''}{e.profit.toFixed(0)} ₺
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">ROI</div>
                      <div className={`font-bold ${e.roi != null && e.roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {e.roi != null ? `${e.roi >= 0 ? '+' : ''}%${(e.roi * 100).toFixed(1)}` : '—'}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Best engine per sport × family */}
      <Card>
        <CardHeader><CardTitle className="text-base">En İyi Motor Seçimi (Master)</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : bestBySportFamily.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Örnek eşiği yüksek. Filtreyi düşür.
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>Spor</TableHead>
                    <TableHead>Market Ailesi</TableHead>
                    <TableHead>🏆 En İyi Motor</TableHead>
                    <TableHead className="text-right">İsabet</TableHead>
                    <TableHead className="text-right">ROI</TableHead>
                    <TableHead className="text-right">Örnek</TableHead>
                    <TableHead>Alternatifler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bestBySportFamily.map(b => {
                    const isProfit = (b.best.roi ?? 0) > 0;
                    return (
                      <TableRow key={`${b.sport}-${b.family}`}>
                        <TableCell>
                          {SPORT_ICONS[b.sport] ?? '🎯'} <span className="capitalize">{b.sport}</span>
                        </TableCell>
                        <TableCell>{FAMILY_LABELS_TR[b.family] ?? b.family}</TableCell>
                        <TableCell>
                          <Badge className="bg-amber-500/20 text-amber-700 border-amber-500/40 border">
                            {b.best.engine}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          %{(b.best.win_rate * 100).toFixed(1)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {b.best.roi != null ? (
                            <span className="inline-flex items-center gap-1">
                              {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {b.best.roi >= 0 ? '+' : ''}%{(b.best.roi * 100).toFixed(1)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.best.total}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {b.alternatives.slice(0, 2).map(a => `${a.engine} (%${(a.win_rate * 100).toFixed(0)})`).join(' · ') || '—'}
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
    </div>
  );
}
