'use client';

import * as React from 'react';
import { CheckCircle2, XCircle, Circle } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ConfidenceTierBadge } from './confidence-tier-badge';
import {
  formatDateTime,
  formatDecimal,
  formatPercent,
  formatRoi,
  roiClass,
} from './format';
import { usePredictions } from '@/lib/hooks/tracking/usePredictions';
import {
  SPORT_META,
  type MarketPerformanceRow,
  type TrackingFilters,
} from '@/lib/hooks/tracking/types';
import { cn } from '@/lib/utils';

export interface PicksDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Context that scopes the pick list (e.g. "UNDER_25 — football"). */
  market?: MarketPerformanceRow | null;
  filters: TrackingFilters;
}

export function PicksDrawer({
  open,
  onOpenChange,
  market,
  filters,
}: PicksDrawerProps) {
  // Scope predictions to selected sport via filter narrowing.
  const scopedFilters: TrackingFilters = React.useMemo(
    () => ({
      ...filters,
      sports: market ? [market.sport] : filters.sports,
    }),
    [filters, market]
  );

  const { data, isLoading, isError, error } = usePredictions(scopedFilters, {
    status: 'resolved',
    sport: market?.sport,
    limit: 25,
    market: market?.market,
  });

  const sportMeta = market ? SPORT_META[market.sport] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl overflow-hidden p-0 flex flex-col"
      >
        <SheetHeader className="p-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            {sportMeta ? <span>{sportMeta.icon}</span> : null}
            <span>{market?.market_label ?? market?.market ?? 'Tahmin geçmişi'}</span>
          </SheetTitle>
          <SheetDescription>
            {market
              ? `Son 25 sonuçlanan tahmin · ROI ${formatRoi(market.roi)} · ${market.total} adet`
              : 'Sonuçlanan tahminler'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 pt-4 space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : isError ? (
              <div className="text-sm text-red-600 dark:text-red-400">
                Tahminler yüklenemedi: {error instanceof Error ? error.message : ''}
              </div>
            ) : !data?.data?.length ? (
              <div className="text-sm text-muted-foreground">
                Bu markette sonuçlanan tahmin bulunamadı.
              </div>
            ) : (
              data.data.map(p => {
                const pick = market
                  ? p.picks.find(pk => pk.market === market.market)
                  : p.picks[0];
                if (!pick) return null;
                return (
                  <div
                    key={p.prediction_id}
                    className="rounded-lg border bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950 p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {p.home_team ?? 'Ev sahibi'}{' '}
                          <span className="text-muted-foreground">vs</span>{' '}
                          {p.away_team ?? 'Deplasman'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                          <span>{formatDateTime(p.match_date)}</span>
                          {p.league ? <span>· {p.league}</span> : null}
                        </div>
                      </div>
                      <PickHitIcon hit={pick.hit} />
                    </div>

                    <Separator className="my-3" />

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Seçim</div>
                        <div className="font-medium truncate">
                          {pick.pick_label ?? pick.market_label ?? pick.market}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Olasılık</div>
                        <div className="font-medium tabular-nums">
                          {formatPercent(pick.probability)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Oran</div>
                        <div className="font-medium tabular-nums">
                          {formatDecimal(pick.market_odds)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Edge</div>
                        <div
                          className={cn(
                            'font-medium tabular-nums',
                            roiClass(pick.expected_value)
                          )}
                        >
                          {formatRoi(pick.expected_value)}
                        </div>
                      </div>
                    </div>

                    {p.home_score != null && p.away_score != null ? (
                      <div className="mt-3 flex items-center gap-2">
                        <Badge variant="secondary" className="tabular-nums">
                          {p.home_score} - {p.away_score}
                        </Badge>
                        {pick.confidence_tier ? (
                          <ConfidenceTierBadge tier={pick.confidence_tier} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function PickHitIcon({ hit }: { hit: boolean | null }) {
  if (hit === true) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
        <CheckCircle2 className="h-4 w-4" />
        İsabet
      </span>
    );
  }
  if (hit === false) {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-semibold">
        <XCircle className="h-4 w-4" />
        Kaçtı
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
      <Circle className="h-4 w-4" />
      Beklemede
    </span>
  );
}
