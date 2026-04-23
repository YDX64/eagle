'use client';

/**
 * ProBet Match List
 *
 * Browse-and-pick UI: shows ALL fixtures for the selected date as a compact
 * list with team names, league, and start time. Click any row to expand it
 * and run the full ProBet pipeline (GoalFlux + BGS + NeuroStack + extras +
 * value bets) on that single fixture. Predictions are cached in component
 * state so re-clicking is instant.
 *
 * This is what you use when you don't want the system to pre-analyze every
 * match — you browse the day's full schedule and pick which ones to analyze.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  RefreshCw,
  Calendar,
  Search,
  ChevronDown,
  ChevronUp,
  Clock,
  Trophy,
  Sparkles,
  Activity,
  Loader2,
  Target,
} from 'lucide-react';

interface FixtureLite {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  leagueId: number;
  date: string;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface MatchListProps {
  /**
   * Render function called when a fixture is expanded.
   * Receives the prediction (or loading state) and returns JSX.
   */
  renderPrediction: (fixtureId: number, prediction: any | null, loading: boolean, error: string | null) => React.ReactNode;
}

const formatTime = (dateStr: string) =>
  new Date(dateStr).toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
  });

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  NS: { label: 'Başlamadı', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  '1H': { label: '1. Yarı', color: 'bg-red-500/15 text-red-700 dark:text-red-300 animate-pulse' },
  '2H': { label: '2. Yarı', color: 'bg-red-500/15 text-red-700 dark:text-red-300 animate-pulse' },
  HT: { label: 'Devre', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  FT: { label: 'Bitti', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  TBD: { label: 'TBD', color: 'bg-slate-500/15 text-slate-700' },
  PST: { label: 'Ertelendi', color: 'bg-orange-500/15 text-orange-700' },
  CANC: { label: 'İptal', color: 'bg-rose-500/15 text-rose-700' },
};

export function ProBetMatchList({ renderPrediction }: MatchListProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [fixtures, setFixtures] = useState<FixtureLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'live' | 'finished'>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [predictions, setPredictions] = useState<Record<number, any>>({});
  const [predictionLoading, setPredictionLoading] = useState<Set<number>>(new Set());
  const [predictionError, setPredictionError] = useState<Record<number, string>>({});

  const fetchFixtures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allMatches: any[] = [];
      let page = 1;
      const PAGE_SIZE = 100;
      const MAX_PAGES = 100; // safety cap — server may impose its own page size
      // Today's default API behavior returns every fixture for "today" without
      // date mismatches — only send the `date` param when the user actually
      // picks a different day.
      const todayISO = new Date().toISOString().split('T')[0];
      while (page <= MAX_PAGES) {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: PAGE_SIZE.toString(),
          status: 'all',
        });
        if (date && date !== todayISO) params.append('date', date);
        const res = await fetch(`/api/matches/today?${params}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Maç listesi alınamadı');
        const matches = json.data?.matches || [];
        const pagination = json.data?.pagination;
        allMatches.push(...matches);
        // Stop when server says no more OR when total already reached.
        const hasNext = pagination?.hasNextPage === true;
        const totalItems = pagination?.totalItems;
        if (!hasNext) break;
        if (matches.length === 0) break;
        if (typeof totalItems === 'number' && allMatches.length >= totalItems) break;
        page++;
      }
      const lite: FixtureLite[] = allMatches.map((m: any) => ({
        fixtureId: m.fixture.id,
        homeTeam: m.teams.home.name,
        awayTeam: m.teams.away.name,
        league: m.league.name,
        leagueId: m.league.id,
        date: m.fixture.date,
        status: m.fixture.status.short,
        homeGoals: m.goals.home,
        awayGoals: m.goals.away,
      }));
      setFixtures(lite);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchFixtures();
  }, [fetchFixtures]);

  // Get unique leagues
  const leagues = useMemo(() => {
    const map = new Map<number, string>();
    fixtures.forEach((f) => map.set(f.leagueId, f.league));
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [fixtures]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = fixtures;
    if (statusFilter === 'upcoming') {
      list = list.filter((f) => ['NS', 'TBD'].includes(f.status));
    } else if (statusFilter === 'live') {
      list = list.filter((f) => ['1H', '2H', 'HT'].includes(f.status));
    } else if (statusFilter === 'finished') {
      list = list.filter((f) => f.status === 'FT');
    }
    if (leagueFilter !== 'all') {
      list = list.filter((f) => f.leagueId.toString() === leagueFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.homeTeam.toLowerCase().includes(s) ||
          f.awayTeam.toLowerCase().includes(s) ||
          f.league.toLowerCase().includes(s)
      );
    }
    // Sort by start time ascending
    list = [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return list;
  }, [fixtures, statusFilter, leagueFilter, search]);

  // Reset to page 1 whenever the filters change — avoid being stuck on page 5
  // with only 3 results.
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, leagueFilter, search, date, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  // Shared pagination controls — rendered both above AND below the list
  const paginationControls = filtered.length > 0 ? (
    <div className="flex items-center justify-between gap-3 flex-wrap py-2 border-y bg-muted/20 rounded-md px-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          Sayfa <strong className="text-foreground">{safePage}</strong> / {totalPages}
          {' '}·{' '}
          {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} / {filtered.length} maç
        </span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
          className="h-7 text-xs border rounded-md px-1.5 bg-background ml-2"
          aria-label="Sayfa başına"
        >
          {[10, 20, 50, 100, 200].map((n) => (
            <option key={n} value={n}>{n}/sayfa</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={safePage === 1}
          onClick={() => setCurrentPage(1)}
          className="h-7 px-2 text-xs"
        >
          « İlk
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={safePage === 1}
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          className="h-7 px-2 text-xs"
        >
          ‹ Önceki
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={safePage >= totalPages}
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          className="h-7 px-2 text-xs"
        >
          Sonraki ›
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={safePage >= totalPages}
          onClick={() => setCurrentPage(totalPages)}
          className="h-7 px-2 text-xs"
        >
          Son »
        </Button>
      </div>
    </div>
  ) : null;

  const fetchPrediction = async (fixtureId: number) => {
    if (predictions[fixtureId]) return; // already cached
    setPredictionLoading((prev) => new Set(prev).add(fixtureId));
    setPredictionError((prev) => {
      const next = { ...prev };
      delete next[fixtureId];
      return next;
    });
    try {
      const res = await fetch(`/api/probet?fixtureId=${fixtureId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Tahmin alınamadı');
      const pred = json.data?.prediction;
      if (pred && 'reason' in pred) {
        throw new Error(pred.reason);
      }
      setPredictions((prev) => ({ ...prev, [fixtureId]: pred }));
    } catch (err) {
      setPredictionError((prev) => ({
        ...prev,
        [fixtureId]: err instanceof Error ? err.message : 'Bilinmeyen hata',
      }));
    } finally {
      setPredictionLoading((prev) => {
        const next = new Set(prev);
        next.delete(fixtureId);
        return next;
      });
    }
  };

  const toggleExpand = (fixtureId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fixtureId)) {
        next.delete(fixtureId);
      } else {
        next.add(fixtureId);
        // Fire prediction fetch (cached if already fetched)
        fetchPrediction(fixtureId);
      }
      return next;
    });
  };

  return (
    <Card className="border-2">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <h3 className="text-base font-bold">Tüm Maçlar Listesi</h3>
            <Badge variant="outline" className="text-xs">
              {filtered.length} / {fixtures.length} maç
            </Badge>
          </div>
          <Button onClick={fetchFixtures} disabled={loading} size="sm" variant="outline" className="gap-2">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-3">
            <div className="relative">
              <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-7 h-9 text-xs"
              />
            </div>
          </div>
          <div className="sm:col-span-4">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Takım veya lig ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-9 text-xs"
              />
            </div>
          </div>
          <div className="sm:col-span-3">
            <select
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
              className="h-9 w-full text-xs border rounded-md px-2 bg-background"
            >
              <option value="all">Tüm Ligler</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id.toString()}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-9 w-full text-xs border rounded-md px-2 bg-background"
            >
              <option value="all">Hepsi</option>
              <option value="upcoming">Yaklaşan</option>
              <option value="live">Canlı</option>
              <option value="finished">Bitmiş</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-sm border border-rose-200 dark:border-rose-800">
            {error}
          </div>
        )}

        {loading && fixtures.length === 0 && (
          <div className="text-center py-8">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary mb-2" />
            <div className="text-sm text-muted-foreground">Maçlar yükleniyor...</div>
          </div>
        )}

        {/* Top pagination */}
        {paginationControls}

        {/* Match list — paginated */}
        <div className="space-y-1.5">
          {filtered.length === 0 && !loading ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Filtre kriterlerine uygun maç yok
            </div>
          ) : (
            paged.map((f) => {
              const isExpanded = expanded.has(f.fixtureId);
              const isPredicting = predictionLoading.has(f.fixtureId);
              const prediction = predictions[f.fixtureId];
              const predErr = predictionError[f.fixtureId];
              const status = STATUS_LABELS[f.status] || { label: f.status, color: 'bg-slate-500/15' };
              return (
                <div
                  key={f.fixtureId}
                  className="rounded-lg border bg-background hover:border-primary/40 transition-colors"
                >
                  {/* Compact row */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(f.fixtureId)}
                    className="w-full p-2 flex items-center gap-2 text-left"
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}

                    {/* Time / Score */}
                    <div className="w-14 shrink-0 text-center">
                      {f.status === 'FT' && f.homeGoals !== null && f.awayGoals !== null ? (
                        <div className="font-mono font-bold text-sm">
                          {f.homeGoals}-{f.awayGoals}
                        </div>
                      ) : (
                        <div className="text-xs font-mono">{formatTime(f.date)}</div>
                      )}
                    </div>

                    {/* Status badge */}
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${status.color}`}>
                      {status.label}
                    </Badge>

                    {/* Teams */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {f.homeTeam} <span className="text-muted-foreground text-xs">vs</span>{' '}
                        {f.awayTeam}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                        <Trophy className="w-3 h-3" />
                        {f.league}
                      </div>
                    </div>

                    {/* Cached badge */}
                    {prediction && (
                      <Badge className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shrink-0">
                        <Sparkles className="w-3 h-3 mr-0.5" />
                        Hazır
                      </Badge>
                    )}
                  </button>

                  {/* Expanded prediction */}
                  {isExpanded && (
                    <div className="border-t p-3 bg-muted/20">
                      {predErr ? (
                        <div className="text-xs text-rose-600">{predErr}</div>
                      ) : (
                        renderPrediction(f.fixtureId, prediction ?? null, isPredicting, predErr ?? null)
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom pagination */}
        {paginationControls}
      </CardContent>
    </Card>
  );
}
