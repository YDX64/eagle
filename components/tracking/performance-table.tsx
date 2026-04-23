'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
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
import {
  FAMILY_LABELS_TR,
  SPORT_META,
  type MarketPerformanceRow,
} from '@/lib/hooks/tracking/types';
import {
  formatDecimal,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRoi,
  roiClass,
  winRateClass,
} from './format';

type SortKey =
  | 'market'
  | 'sport'
  | 'family'
  | 'total'
  | 'hit'
  | 'win_rate'
  | 'avg_odds'
  | 'avg_probability'
  | 'roi'
  | 'profit';

export interface PerformanceTableProps {
  rows: MarketPerformanceRow[] | undefined;
  loading?: boolean;
  emptyMessage?: string;
  initialSortKey?: SortKey;
  initialSortDir?: 'asc' | 'desc';
  onRowClick?: (row: MarketPerformanceRow) => void;
  maxHeight?: number;
  showFamily?: boolean;
  showSport?: boolean;
}

export function PerformanceTable({
  rows,
  loading,
  emptyMessage = 'Veri yok',
  initialSortKey = 'roi',
  initialSortDir = 'desc',
  onRowClick,
  maxHeight,
  showFamily = true,
  showSport = true,
}: PerformanceTableProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>(initialSortKey);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>(initialSortDir);

  const sorted = React.useMemo(() => {
    if (!rows) return [];
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av ?? '');
      const bs = String(bv ?? '');
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'market' || k === 'sport' ? 'asc' : 'desc');
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
          'cursor-pointer select-none hover:bg-muted/50 transition-colors',
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

  if (loading) {
    return (
      <div className="rounded-md border p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border bg-card overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            {showSport ? <Header k="sport" label="Spor" /> : null}
            <Header k="market" label="Market" />
            {showFamily ? <Header k="family" label="Kategori" /> : null}
            <Header k="total" label="Toplam" align="right" />
            <Header k="hit" label="İsabet" align="right" />
            <Header k="win_rate" label="İsabet %" align="right" />
            <Header k="avg_odds" label="Ort. Oran" align="right" />
            <Header k="avg_probability" label="Ort. Olasılık" align="right" />
            <Header k="roi" label="ROI" align="right" />
            <Header k="profit" label="Kâr" align="right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(r => {
            const sportMeta = SPORT_META[r.sport];
            return (
              <TableRow
                key={`${r.sport}-${r.market}`}
                className={cn(onRowClick && 'cursor-pointer')}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {showSport ? (
                  <TableCell className="whitespace-nowrap">
                    <span className="mr-1">{sportMeta?.icon}</span>
                    {sportMeta?.label ?? r.sport}
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">
                  {r.market_label ?? r.market}
                  <span className="block text-xs text-muted-foreground font-mono">
                    {r.market}
                  </span>
                </TableCell>
                {showFamily ? (
                  <TableCell className="text-sm">
                    {r.family ? FAMILY_LABELS_TR[r.family] ?? r.family : '-'}
                  </TableCell>
                ) : null}
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
                <TableCell className="text-right tabular-nums">
                  {formatDecimal(r.avg_odds)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatPercent(r.avg_probability)}
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
