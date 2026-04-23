'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, XCircle, Clock, TrendingUp } from 'lucide-react';

interface ActivityRow {
  id: string;
  sport: string;
  fixture_id: number;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
  match_date: string | null;
  status: string;
  best_market: string | null;
  best_pick_label: string | null;
  best_probability: number | null;
  best_pick_hit: boolean | null;
  best_market_odds: number | null;
  actual_home: number | null;
  actual_away: number | null;
  resolved_at: string | null;
}

const SPORT_ICONS: Record<string, string> = {
  football: '⚽',
  basketball: '🏀',
  nba: '🏆',
  hockey: '🏒',
  handball: '🤾',
  volleyball: '🏐',
  baseball: '⚾',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const future = Math.abs(diff);
    if (future < 60_000) return 'şimdi';
    if (future < 3_600_000) return `${Math.round(future / 60_000)} dk sonra`;
    if (future < 86_400_000) return `${Math.round(future / 3_600_000)} saat sonra`;
    return new Date(iso).toLocaleDateString('tr-TR');
  }
  if (diff < 60_000) return 'az önce';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} dk önce`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} saat önce`;
  return new Date(iso).toLocaleDateString('tr-TR');
}

export function ActivityFeed({ limit = 30 }: { limit?: number }) {
  const [data, setData] = React.useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch(`/api/tracking/recent-activity?limit=${limit}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (j?.success) setData(j.data);
      })
      .finally(() => setLoading(false));
  }, [limit]);

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const resolved = (data ?? []).filter(r => r.status === 'resolved');
  const pending = (data ?? []).filter(r => r.status === 'pending');
  const wins = resolved.filter(r => r.best_pick_hit === true);
  const losses = resolved.filter(r => r.best_pick_hit === false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-slate-950">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Son Kazanan Tahminler
            <Badge className="ml-auto bg-emerald-500/15 text-emerald-700 border-emerald-500/30 border">
              {wins.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 max-h-80 overflow-y-auto">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : wins.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">Son 24 saat içinde kazanan yok</p>
          ) : (
            wins.slice(0, 10).map(r => (
              <Link
                key={r.id}
                href={`/tracking/fixtures?sport=${r.sport}`}
                className="block p-2 rounded border border-emerald-500/20 hover:border-emerald-500/50 bg-white/50 dark:bg-slate-900/40 transition-colors"
              >
                <div className="flex items-center gap-1 text-xs font-medium">
                  <span>{SPORT_ICONS[r.sport] ?? '🎯'}</span>
                  <span className="truncate flex-1">{r.home_team} vs {r.away_team}</span>
                  {r.actual_home != null && (
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      {r.actual_home}-{r.actual_away}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {r.best_pick_label ?? r.best_market} · {timeAgo(r.resolved_at)}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-slate-950">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-600" />
            Son Kaybeden Tahminler
            <Badge className="ml-auto bg-rose-500/15 text-rose-700 border-rose-500/30 border">
              {losses.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 max-h-80 overflow-y-auto">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : losses.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">Son 24 saat içinde kaybeden yok</p>
          ) : (
            losses.slice(0, 10).map(r => (
              <Link
                key={r.id}
                href={`/tracking/fixtures?sport=${r.sport}`}
                className="block p-2 rounded border border-rose-500/20 hover:border-rose-500/50 bg-white/50 dark:bg-slate-900/40 transition-colors"
              >
                <div className="flex items-center gap-1 text-xs font-medium">
                  <span>{SPORT_ICONS[r.sport] ?? '🎯'}</span>
                  <span className="truncate flex-1">{r.home_team} vs {r.away_team}</span>
                  {r.actual_home != null && (
                    <span className="font-bold text-rose-700 dark:text-rose-400">
                      {r.actual_home}-{r.actual_away}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {r.best_pick_label ?? r.best_market} · {timeAgo(r.resolved_at)}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/30 dark:to-slate-950">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-600" />
            Yaklaşan Tahminler
            <Badge className="ml-auto bg-sky-500/15 text-sky-700 border-sky-500/30 border">
              {pending.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 max-h-80 overflow-y-auto">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : pending.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">Yaklaşan maç yok</p>
          ) : (
            pending.slice(0, 10).map(r => (
              <Link
                key={r.id}
                href={`/tracking/fixtures?sport=${r.sport}`}
                className="block p-2 rounded border border-sky-500/20 hover:border-sky-500/50 bg-white/50 dark:bg-slate-900/40 transition-colors"
              >
                <div className="flex items-center gap-1 text-xs font-medium">
                  <span>{SPORT_ICONS[r.sport] ?? '🎯'}</span>
                  <span className="truncate flex-1">{r.home_team} vs {r.away_team}</span>
                  {r.best_probability != null && (
                    <span className="font-bold text-sky-700 dark:text-sky-400">
                      %{Math.round(r.best_probability * 100)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {r.best_pick_label ?? r.best_market} · {timeAgo(r.match_date)}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
