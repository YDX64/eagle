'use client';


export const dynamic = 'force-dynamic';
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { PerformanceTable } from '@/components/tracking/performance-table';
import { MarketHeatmap } from '@/components/tracking/market-heatmap';
import { PicksDrawer } from '@/components/tracking/picks-drawer';
import { QueryError } from '@/components/tracking/query-state';
import { useTrackingFilters } from '@/lib/hooks/tracking/useTrackingFilters';
import { useMarketPerformance } from '@/lib/hooks/tracking/useMarketPerformance';
import { useFamilyPerformance } from '@/lib/hooks/tracking/useFamilyPerformance';
import {
  FAMILY_LABELS_TR,
  type MarketFamily,
  type MarketPerformanceRow,
} from '@/lib/hooks/tracking/types';

const FAMILY_OPTIONS: Array<{ value: MarketFamily | 'all'; label: string }> = [
  { value: 'all', label: 'Tüm kategoriler' },
  { value: 'match_winner', label: FAMILY_LABELS_TR.match_winner },
  { value: 'double_chance', label: FAMILY_LABELS_TR.double_chance },
  { value: 'draw_no_bet', label: FAMILY_LABELS_TR.draw_no_bet },
  { value: 'handicap', label: FAMILY_LABELS_TR.handicap },
  { value: 'totals', label: FAMILY_LABELS_TR.totals },
  { value: 'team_totals', label: FAMILY_LABELS_TR.team_totals },
  { value: 'btts', label: FAMILY_LABELS_TR.btts },
  { value: 'corners', label: FAMILY_LABELS_TR.corners },
  { value: 'cards', label: FAMILY_LABELS_TR.cards },
  { value: 'first_half', label: FAMILY_LABELS_TR.first_half },
  { value: 'correct_score', label: FAMILY_LABELS_TR.correct_score },
  { value: 'ht_ft', label: FAMILY_LABELS_TR.ht_ft },
  { value: 'player_props', label: FAMILY_LABELS_TR.player_props },
];

export default function PerformancePage() {
  const { filters, setFilters } = useTrackingFilters();
  const [selectedRow, setSelectedRow] = React.useState<MarketPerformanceRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const performance = useMarketPerformance(filters, { limit: 500 });
  const families = useFamilyPerformance(filters);

  const minSample = filters.min_sample ?? 10;

  const handleRowClick = (row: MarketPerformanceRow) => {
    setSelectedRow(row);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Market Performansı</h2>
        <p className="text-sm text-muted-foreground">
          Tüm sporlarda market bazlı ROI, isabet oranı ve kâr detayları.
        </p>
      </div>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Kategori
              </Label>
              <Select
                value={filters.family ?? 'all'}
                onValueChange={v =>
                  setFilters({
                    family: v === 'all' ? undefined : (v as MarketFamily),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FAMILY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Minimum örnek: {minSample}
              </Label>
              <Slider
                value={[minSample]}
                min={3}
                max={200}
                step={1}
                onValueChange={v => setFilters({ min_sample: v[0] })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Minimum olasılık: {((filters.min_probability ?? 0) * 100).toFixed(0)}%
              </Label>
              <Slider
                value={[(filters.min_probability ?? 0) * 100]}
                min={0}
                max={90}
                step={5}
                onValueChange={v => setFilters({ min_probability: v[0] / 100 })}
              />
            </div>

            <div className="flex items-end gap-2">
              <Checkbox
                id="perf-hc"
                checked={filters.only_high_confidence ?? false}
                onCheckedChange={c => setFilters({ only_high_confidence: !!c || undefined })}
              />
              <Label htmlFor="perf-hc" className="text-sm font-normal">
                Sadece yüksek güvenli seçimler
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {performance.isError ? <QueryError error={performance.error} /> : null}

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader>
          <CardTitle className="text-base">Spor × Kategori ROI Haritası</CardTitle>
        </CardHeader>
        <CardContent>
          <MarketHeatmap rows={families.data ?? []} loading={families.isLoading} />
        </CardContent>
      </Card>

      <div>
        <PerformanceTable
          rows={(performance.data ?? []).filter(r => r.total >= (filters.min_sample ?? 10))}
          loading={performance.isLoading}
          initialSortKey="roi"
          onRowClick={handleRowClick}
          emptyMessage="Seçilen filtrelerde sonuçlanmış market yok."
          maxHeight={720}
        />
      </div>

      <PicksDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        market={selectedRow}
        filters={filters}
      />
    </div>
  );
}
