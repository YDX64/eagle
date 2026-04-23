'use client';


export const dynamic = 'force-dynamic';
import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { ConfidenceTierBadge } from '@/components/tracking/confidence-tier-badge';
import { QueryError } from '@/components/tracking/query-state';
import {
  formatDateTime,
  formatDecimal,
  formatPercent,
  formatRoi,
  roiClass,
} from '@/components/tracking/format';
import { useTrackingFilters } from '@/lib/hooks/tracking/useTrackingFilters';
import { useValueBets } from '@/lib/hooks/tracking/useValueBets';
import { SPORT_META, type ValueBetRow } from '@/lib/hooks/tracking/types';

type SortKey =
  | 'expected_value'
  | 'probability'
  | 'market_odds'
  | 'match_date'
  | 'sport';

export default function ValueBetsPage() {
  const { filters, setFilters } = useTrackingFilters();
  const [sortKey, setSortKey] = React.useState<SortKey>('expected_value');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  // Value bets API expects min_expected_value — default 5%
  const minEv = filters.min_expected_value ?? 0.05;
  const minProb = filters.min_probability ?? 0.55;

  const valueBets = useValueBets(
    {
      ...filters,
      min_expected_value: minEv,
      min_probability: minProb,
    },
    { limit: 200 }
  );

  const rows = React.useMemo(() => {
    if (!valueBets.data) return [];
    const copy = [...valueBets.data];
    copy.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (sortKey === 'match_date') {
        const at = a.match_date ? new Date(a.match_date).getTime() : 0;
        const bt = b.match_date ? new Date(b.match_date).getTime() : 0;
        return sortDir === 'asc' ? at - bt : bt - at;
      }
      const as = String(av ?? '');
      const bs = String(bv ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return copy;
  }, [valueBets.data, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const Header = ({
    k,
    label,
    align = 'left',
  }: {
    k: SortKey;
    label: string;
    align?: 'left' | 'right';
  }) => {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <TableHead
        className={cn(
          'cursor-pointer select-none hover:bg-muted/50',
          align === 'right' && 'text-right'
        )}
        onClick={() => toggleSort(k)}
      >
        <span
          className={cn(
            'inline-flex items-center gap-1',
            align === 'right' && 'flex-row-reverse'
          )}
        >
          {label}
          <Icon className="h-3 w-3 opacity-60" />
        </span>
      </TableHead>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          Değer Bahisleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Algoritmanın pozitif edge tespit ettiği, henüz sonuçlanmamış maçlar.
        </p>
      </div>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Minimum edge: {(minEv * 100).toFixed(0)}%
              </Label>
              <Slider
                value={[minEv * 100]}
                min={1}
                max={50}
                step={1}
                onValueChange={v =>
                  setFilters({ min_expected_value: v[0] / 100 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Minimum olasılık: {(minProb * 100).toFixed(0)}%
              </Label>
              <Slider
                value={[minProb * 100]}
                min={40}
                max={90}
                step={1}
                onValueChange={v =>
                  setFilters({ min_probability: v[0] / 100 })
                }
              />
            </div>
            <div className="flex items-end gap-2">
              <Checkbox
                id="vb-hc"
                checked={filters.only_high_confidence ?? false}
                onCheckedChange={c =>
                  setFilters({ only_high_confidence: !!c || undefined })
                }
              />
              <Label htmlFor="vb-hc" className="text-sm font-normal">
                Sadece yüksek güvenli fırsatlar
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {valueBets.isError ? <QueryError error={valueBets.error} /> : null}

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Değer Bahisleri · {rows.length} adet
          </CardTitle>
        </CardHeader>
        <CardContent>
          {valueBets.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Filtrelere uyan aktif değer bahsi yok. Minimum edge/olasılığı düşürmeyi deneyin.
            </p>
          ) : (
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <Header k="match_date" label="Maç" />
                    <Header k="sport" label="Spor" />
                    <TableHead>Market</TableHead>
                    <Header k="probability" label="Olasılık" align="right" />
                    <Header k="market_odds" label="Oran" align="right" />
                    <Header k="expected_value" label="Edge" align="right" />
                    <TableHead>Güven</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <ValueBetRowView key={`${row.prediction_id}-${row.market}`} row={row} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValueBetRowView({ row }: { row: ValueBetRow }) {
  const sportMeta = SPORT_META[row.sport];
  return (
    <TableRow>
      <TableCell className="min-w-[240px]">
        <div className="text-sm font-medium">
          {row.home_team ?? 'Ev sahibi'}{' '}
          <span className="text-muted-foreground">vs</span>{' '}
          {row.away_team ?? 'Deplasman'}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatDateTime(row.match_date)}
          {row.league ? ` · ${row.league}` : ''}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="mr-1">{sportMeta?.icon}</span>
        {sportMeta?.label ?? row.sport}
      </TableCell>
      <TableCell className="min-w-[160px]">
        <div className="text-sm font-medium">
          {row.pick_label ?? row.market_label ?? row.market}
        </div>
        <div className="text-xs text-muted-foreground font-mono">{row.market}</div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPercent(row.probability)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatDecimal(row.market_odds)}
      </TableCell>
      <TableCell
        className={cn('text-right tabular-nums', roiClass(row.expected_value))}
      >
        {formatRoi(row.expected_value)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {row.confidence_tier ? (
            <ConfidenceTierBadge tier={row.confidence_tier} />
          ) : null}
          {row.is_high_confidence ? (
            <Badge variant="secondary" className="text-[10px]">
              YG
            </Badge>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
