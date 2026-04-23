'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { SportType } from '@/lib/sports/base/types';
import {
  PredictionResultBadge,
  PredictionResultBadgeProvider,
} from '@/components/tracking/prediction-result-badge';

interface GamesDashboardProps {
  sport: SportType;
  apiPath: string;
  predictionPath: string;
  title: string;
  icon: string;
  accentColor: string;
  renderScore?: (game: any) => React.ReactNode;
  transformGame?: (game: any) => any;
}

type StatusFilter = 'all' | 'live' | 'upcoming' | 'finished';

const ITEMS_PER_PAGE = 100;

const LIVE_STATUSES = ['Q1','Q2','Q3','Q4','OT','HT','BT','1H','2H','P1','P2','P3','S1','S2','S3','S4','S5','LIVE','IN'];
const FINISHED_STATUSES = ['FT','AOT','AP','AET','PEN'];
const NOT_STARTED_STATUSES = ['NS','TBD','PST','CANC'];

function isLive(game: any): boolean {
  const short = game.status?.short || '';
  const long = (game.status?.long || '').toLowerCase();
  return LIVE_STATUSES.some(s => short.includes(s)) || long.includes('live') || long.includes('in play');
}

function isFinished(game: any): boolean {
  const short = game.status?.short || '';
  const long = (game.status?.long || '').toLowerCase();
  return FINISHED_STATUSES.includes(short) || long.includes('finished') || long.includes('after');
}

function isNotStarted(game: any): boolean {
  const short = game.status?.short || '';
  return NOT_STARTED_STATUSES.includes(short) || (!isLive({ status: game.status }) && !isFinished({ status: game.status }));
}

export function GamesDashboard({
  sport,
  apiPath,
  predictionPath,
  title,
  icon,
  accentColor,
  renderScore,
  transformGame,
}: GamesDashboardProps) {
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date, limit: '500' });
      if (search) params.set('search', search);
      const res = await fetch(`${apiPath}?${params}`);
      const data = await res.json();
      if (data.success) {
        let rawGames = data.data?.games || data.data?.matches || (Array.isArray(data.data) ? data.data : []);
        if (transformGame) {
          rawGames = rawGames.map(transformGame);
        }
        setGames(rawGames);
      } else {
        setError(data.error || 'Maclar yuklenemedi');
      }
    } catch {
      setError('Baglanti hatasi');
    } finally {
      setLoading(false);
    }
  }, [apiPath, date, search, transformGame]);

  useEffect(() => { setPage(1); fetchGames(); }, [fetchGames]);

  // Counts
  const counts = useMemo(() => {
    const live = games.filter(isLive).length;
    const finished = games.filter(isFinished).length;
    const upcoming = games.length - live - finished;
    return { total: games.length, live, finished, upcoming };
  }, [games]);

  // Filtered games
  const filtered = useMemo(() => {
    let list = games;
    if (statusFilter === 'live') list = list.filter(isLive);
    else if (statusFilter === 'finished') list = list.filter(isFinished);
    else if (statusFilter === 'upcoming') list = list.filter(g => !isLive(g) && !isFinished(g));
    return list;
  }, [games, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [statusFilter]);

  const getStatusBadge = (game: any) => {
    const short = game.status?.short || 'NS';
    if (isLive(game)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          {short}
        </span>
      );
    }
    if (isFinished(game)) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          Bitti
        </span>
      );
    }
    if (short === 'NS') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          Baslamadi
        </span>
      );
    }
    if (short === 'PST') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          Ertelendi
        </span>
      );
    }
    if (short === 'CANC') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20">
          Iptal
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
        {short}
      </span>
    );
  };

  const filterButtons: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'Tümü', count: counts.total },
    { key: 'live', label: 'Canlı', count: counts.live },
    { key: 'upcoming', label: 'Yaklaşan', count: counts.upcoming },
    { key: 'finished', label: 'Biten', count: counts.finished },
  ];

  return (
    <PredictionResultBadgeProvider sport={sport as any}>
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Compact Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>{icon}</span>
            <span>{title}</span>
            <span className="text-sm font-normal text-muted-foreground">· {counts.total} Maç</span>
          </h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {counts.live > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {counts.live} Canlı
              </span>
            )}
            <span>⏰ {counts.upcoming} Yaklaşan</span>
            <span>✅ {counts.finished} Biten</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
            {filterButtons.map(fb => (
              <button
                key={fb.key}
                onClick={() => setStatusFilter(fb.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === fb.key
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {fb.label} ({fb.count})
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Takım ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Date */}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
          />

          {/* Refresh */}
          <button
            onClick={() => fetchGames()}
            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Yenile
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-[3px] border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-400">Maçlar yükleniyor...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg p-4">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
          </div>
        )}

        {/* Games List */}
        {!loading && !error && (
          <>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <span className="text-5xl mb-3">{icon}</span>
                <p className="text-sm">Bu tarihte maç bulunamadı</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {/* List Header */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span className="w-12 shrink-0">Saat</span>
                  <span className="w-32 shrink-0 hidden sm:block">Lig</span>
                  <span className="flex-1 text-right">Ev Sahibi</span>
                  <span className="w-16 text-center">Skor</span>
                  <span className="flex-1">Deplasman</span>
                  <span className="w-20 shrink-0">Durum</span>
                  <span className="w-14 shrink-0" />
                </div>

                {/* Rows */}
                {paged.map((game: any) => {
                  const leagueName = game.league?.name || '';
                  const gameTime = game.time || (() => { try { return new Date(game.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); } catch { return '--:--'; } })();
                  const live = isLive(game);
                  const finished = isFinished(game);
                  const homeName = game.teams?.home?.name || 'Ev Sahibi';
                  const awayName = game.teams?.away?.name || 'Deplasman';

                  return (
                    <div
                      key={game.id}
                      className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-sm ${
                        live
                          ? 'bg-red-50/50 dark:bg-red-950/20 border-l-2 border-l-red-500'
                          : finished
                            ? 'text-muted-foreground'
                            : ''
                      }`}
                    >
                      {/* Time */}
                      <span className="w-12 text-xs font-mono text-muted-foreground shrink-0">{gameTime}</span>

                      {/* League - hidden on mobile */}
                      <span className="w-32 text-xs text-muted-foreground truncate shrink-0 hidden sm:block">{leagueName}</span>

                      {/* Home Team */}
                      <span className={`flex-1 text-right font-medium truncate ${finished ? 'text-muted-foreground' : ''}`}>
                        {homeName}
                      </span>

                      {/* Score */}
                      <span className="w-16 text-center font-bold font-mono text-base shrink-0">
                        {renderScore
                          ? renderScore(game)
                          : (game.scores?.home?.total ?? game.goals?.home ?? '-') + ' - ' + (game.scores?.away?.total ?? game.goals?.away ?? '-')
                        }
                      </span>

                      {/* Away Team */}
                      <span className={`flex-1 font-medium truncate ${finished ? 'text-muted-foreground' : ''}`}>
                        {awayName}
                      </span>

                      {/* Status Badge */}
                      <span className="w-20 shrink-0">
                        {getStatusBadge(game)}
                      </span>

                      {/* Tracking: Kazandı/Kaybetti/Bekliyor */}
                      <PredictionResultBadge
                        fixtureId={game.id}
                        sport={sport as any}
                        size="xs"
                        className="shrink-0 hidden sm:inline-flex"
                      />

                      {/* Analysis Link */}
                      <Link
                        href={`${predictionPath}/${game.id}`}
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        Analiz →
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm text-slate-600 dark:text-slate-300 font-medium tabular-nums">
                  Sayfa {page}/{totalPages} · {filtered.length} maç
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </PredictionResultBadgeProvider>
  );
}
