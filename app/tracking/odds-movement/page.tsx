'use client';


export const dynamic = 'force-dynamic';
import * as React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LineChart as LineChartIcon, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError, QueryEmpty } from '@/components/tracking/query-state';
import { useOddsMovement } from '@/lib/hooks/tracking/useOddsMovement';
import { useTrackingFilters } from '@/lib/hooks/tracking/useTrackingFilters';
import {
  SPORT_META,
  type OddsSnapshotRow,
  type SportCode,
} from '@/lib/hooks/tracking/types';
import { cn } from '@/lib/utils';

const SPORT_OPTIONS: SportCode[] = [
  'football',
  'basketball',
  'hockey',
  'handball',
  'volleyball',
  'baseball',
];

/** Stable palette for distinct bookmakers. */
const PALETTE = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#0ea5e9',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#84cc16',
  '#f97316',
];

export default function OddsMovementPage() {
  const { filters } = useTrackingFilters();
  const defaultSport = filters.sports[0] ?? 'football';

  const [sport, setSport] = React.useState<SportCode>(defaultSport);
  const [gameIdText, setGameIdText] = React.useState('');
  const [queriedGameId, setQueriedGameId] = React.useState<number | undefined>();
  const [market, setMarket] = React.useState<string>('');

  const odds = useOddsMovement({
    sport,
    api_game_id: queriedGameId,
    market: market || undefined,
  });

  const handleSearch = () => {
    const parsed = Number(gameIdText);
    if (Number.isFinite(parsed) && parsed > 0) {
      setQueriedGameId(parsed);
    }
  };

  // Pivot per (bookmaker, selection) series by timestamp.
  const { chartData, seriesKeys } = React.useMemo(() => {
    const raw = odds.data ?? [];
    const byTime = new Map<string, Record<string, number | string>>();
    const keys = new Set<string>();
    for (const r of raw) {
      const t = new Date(r.snapshot_at).getTime();
      const key = `${r.bookmaker} · ${r.selection}`;
      keys.add(key);
      const existing = byTime.get(String(t)) ?? { ts: t };
      existing[key] = r.odds_value;
      byTime.set(String(t), existing);
    }
    const data = Array.from(byTime.values()).sort(
      (a, b) => (a.ts as number) - (b.ts as number)
    );
    return { chartData: data, seriesKeys: Array.from(keys) };
  }, [odds.data]);

  const uniqueMarkets = React.useMemo(() => {
    const set = new Set<string>();
    (odds.data ?? []).forEach(r => set.add(r.market));
    return Array.from(set);
  }, [odds.data]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <LineChartIcon className="h-5 w-5" />
          Oran Hareketi
        </h2>
        <p className="text-sm text-muted-foreground">
          Bir maçın oranlarının bahis şirketleri arasında zaman içinde nasıl değiştiğini izleyin.
        </p>
      </div>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Maç Ara</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Spor
              </Label>
              <Select
                value={sport}
                onValueChange={v => setSport(v as SportCode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPORT_OPTIONS.map(s => {
                    const meta = SPORT_META[s];
                    return (
                      <SelectItem key={s} value={s}>
                        <span className="mr-1">{meta?.icon}</span>
                        {meta?.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Maç ID (api_game_id)
              </Label>
              <Input
                value={gameIdText}
                onChange={e => setGameIdText(e.target.value)}
                placeholder="Örn: 1234567"
                inputMode="numeric"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSearch();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Market (opsiyonel)
              </Label>
              <Select
                value={market || 'all'}
                onValueChange={v => setMarket(v === 'all' ? '' : v)}
                disabled={uniqueMarkets.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tüm marketler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm marketler</SelectItem>
                  {uniqueMarkets.map(m => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={handleSearch} className="w-full">
                <Search className="mr-1.5 h-4 w-4" /> Ara
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {odds.isError ? <QueryError error={odds.error} /> : null}

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">
            Zaman içinde oran hareketi
            {queriedGameId ? ` · Maç #${queriedGameId}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!queriedGameId ? (
            <QueryEmpty label="Grafiği görmek için bir maç ID girin ve Ara'ya basın." />
          ) : odds.isLoading ? (
            <Skeleton className="h-[360px] w-full" />
          ) : chartData.length === 0 ? (
            <QueryEmpty label="Bu maç için oran anlık görüntüsü bulunamadı." />
          ) : (
            <div style={{ width: '100%', height: 360 }}>
              <ResponsiveContainer>
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={ts =>
                      new Date(ts).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    }
                    fontSize={11}
                    minTickGap={40}
                  />
                  <YAxis
                    fontSize={11}
                    domain={['auto', 'auto']}
                    allowDecimals
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelFormatter={ts =>
                      new Date(ts as number).toLocaleString('tr-TR')
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {seriesKeys.map((key, idx) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={PALETTE[idx % PALETTE.length]}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Anlık Görüntüler</CardTitle>
        </CardHeader>
        <CardContent>
          {!queriedGameId ? (
            <QueryEmpty label="Maç seçilmedi." />
          ) : odds.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !odds.data?.length ? (
            <QueryEmpty label="Kayıt yok." />
          ) : (
            <OddsSnapshotTable rows={odds.data} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OddsSnapshotTable({ rows }: { rows: OddsSnapshotRow[] }) {
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(b.snapshot_at).getTime() - new Date(a.snapshot_at).getTime()
  );
  return (
    <div className="rounded-md border overflow-auto max-h-96">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card border-b">
          <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="p-2">Zaman</th>
            <th className="p-2">Bahis Şirketi</th>
            <th className="p-2">Market</th>
            <th className="p-2">Seçim</th>
            <th className="p-2 text-right">Oran</th>
            <th className="p-2 text-right">Line</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 100).map((r, idx) => (
            <tr
              key={`${r.snapshot_at}-${r.bookmaker}-${r.selection}-${idx}`}
              className={cn('border-b last:border-b-0 hover:bg-muted/40')}
            >
              <td className="p-2 whitespace-nowrap">
                {new Date(r.snapshot_at).toLocaleString('tr-TR')}
              </td>
              <td className="p-2">{r.bookmaker}</td>
              <td className="p-2 font-mono text-xs">{r.market}</td>
              <td className="p-2">{r.selection ?? '—'}</td>
              <td className="p-2 text-right tabular-nums font-semibold">
                {r.odds_value.toFixed(2)}
              </td>
              <td className="p-2 text-right tabular-nums text-muted-foreground">
                {r.line ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
