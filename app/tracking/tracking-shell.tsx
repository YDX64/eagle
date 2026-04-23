'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Brain,
  LineChart as LineChartIcon,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
  Ticket,
  Trophy,
  TrendingUp,
  UserCircle2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SportFilter } from '@/components/tracking/sport-filter';
import { TrackingDateRangePicker } from '@/components/tracking/date-range-picker';
import {
  filtersToQueryString,
  useTrackingFilters,
} from '@/lib/hooks/tracking/useTrackingFilters';

const TABS: Array<{
  label: string;
  href: string;
  match: (pathname: string) => boolean;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    label: 'Özet',
    href: '/tracking',
    match: p => p === '/tracking' || p === '/tracking/',
    icon: BarChart3,
  },
  {
    label: 'Maç Tahminleri',
    href: '/tracking/fixtures',
    match: p => p.startsWith('/tracking/fixtures'),
    icon: ListChecks,
  },
  {
    label: 'Performans',
    href: '/tracking/performance',
    match: p => p.startsWith('/tracking/performance'),
    icon: TrendingUp,
  },
  {
    label: 'Lider Tablosu',
    href: '/tracking/leaderboard',
    match: p => p.startsWith('/tracking/leaderboard'),
    icon: Trophy,
  },
  {
    label: 'Değer Bahisleri',
    href: '/tracking/value-bets',
    match: p => p.startsWith('/tracking/value-bets'),
    icon: Sparkles,
  },
  {
    label: 'Yüksek Oran',
    href: '/tracking/high-odds',
    match: p => p.startsWith('/tracking/high-odds'),
    icon: Zap,
  },
  {
    label: 'Kuponlarım',
    href: '/tracking/coupons',
    match: p => p.startsWith('/tracking/coupons'),
    icon: Ticket,
  },
  {
    label: 'Oyuncu Marketleri',
    href: '/tracking/player-props',
    match: p => p.startsWith('/tracking/player-props'),
    icon: UserCircle2,
  },
  {
    label: 'Oran Hareketi',
    href: '/tracking/odds-movement',
    match: p => p.startsWith('/tracking/odds-movement'),
    icon: LineChartIcon,
  },
  {
    label: 'Motor Karşılaştırması',
    href: '/tracking/engines',
    match: p => p.startsWith('/tracking/engines'),
    icon: Brain,
  },
];

export function TrackingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/tracking';
  const { filters, setFilters, resetFilters } = useTrackingFilters();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    // Bumping the query string triggers invalidation via React Query's keying.
    const qs = filtersToQueryString(filters);
    if (typeof window !== 'undefined') {
      window.location.href = `${pathname}?${qs}`;
    }
    setTimeout(() => setRefreshing(false), 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Target className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <div>
                <h1 className="text-lg font-bold leading-none">
                  Tahmin Takip Paneli
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  Çok sporlu ROI, isabet ve değer analizi
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="hidden sm:inline-flex"
              >
                Filtreleri sıfırla
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={cn(
                    'mr-1.5 h-3.5 w-3.5',
                    refreshing && 'animate-spin'
                  )}
                />
                Yenile
              </Button>
            </div>
          </div>

          <Separator className="my-3" />

          <nav className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 pb-1">
            {TABS.map(tab => {
              const active = tab.match(pathname);
              const Icon = tab.icon;
              // Preserve filters on tab switch
              const href = `${tab.href}?${filtersToQueryString(filters)}`;
              return (
                <Link
                  key={tab.href}
                  href={href}
                  scroll={false}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <aside className="lg:w-64 shrink-0">
            <div className="sticky top-[148px] rounded-lg border bg-card p-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Tarih Aralığı
                </div>
                <TrackingDateRangePicker
                  value={{
                    date_from: filters.date_from,
                    date_to: filters.date_to,
                  }}
                  onChange={next =>
                    setFilters({
                      date_from: next.date_from,
                      date_to: next.date_to,
                    })
                  }
                  className="w-full"
                />
              </div>
              <Separator />
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Sporlar
                </div>
                <div className="flex flex-col">
                  <SportFilter
                    value={filters.sports}
                    onChange={sports => setFilters({ sports })}
                    className="flex-wrap"
                  />
                </div>
              </div>
              <Separator />
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Hızlı Linkler
                </div>
                <div className="space-y-1 text-sm">
                  <Link
                    href={`/tracking/value-bets?${filtersToQueryString({ ...filters, only_high_confidence: true })}`}
                    className="block rounded px-2 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    ✨ Yüksek güvenli değer bahisleri
                  </Link>
                  <Link
                    href={`/tracking/performance?${filtersToQueryString(filters)}`}
                    className="block rounded px-2 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    📊 Market performansı
                  </Link>
                  <Link
                    href={`/tracking/leaderboard?${filtersToQueryString(filters)}`}
                    className="block rounded px-2 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    🏆 Lider tablosu
                  </Link>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1 space-y-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
