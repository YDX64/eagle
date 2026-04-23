
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { SportType } from '@/lib/sports/base/types';

interface GamesDashboardProps {
  sport: SportType;
  apiPath: string;       // e.g., "/api/basketball/games/today"
  predictionPath: string; // e.g., "/basketball/predictions"
  title: string;
  icon: string;
  accentColor: string;   // tailwind color name
  renderScore: (game: any) => React.ReactNode;
  transformGame?: (game: any) => any; // Transform API response to standard format
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
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState({ totalGames: 0, liveGames: 0, upcomingGames: 0, finishedGames: 0 });
  const ITEMS_PER_PAGE = 25;

  const fetchGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date, limit: '100' });
      if (search) params.set('search', search);
      const res = await fetch(`${apiPath}?${params}`);
      const data = await res.json();
      if (data.success) {
        // Support sport API format (data.games), football format (data.matches), or raw array
        let rawGames = data.data?.games || data.data?.matches || (Array.isArray(data.data) ? data.data : []);
        if (transformGame) {
          rawGames = rawGames.map(transformGame);
        }
        setTotalPages(Math.max(1, Math.ceil(rawGames.length / ITEMS_PER_PAGE)));
        setGames(rawGames);
        setStats(data.data?.stats || {
          totalGames: rawGames.length,
          liveGames: rawGames.filter((g: any) => {
            const s = g.status?.short || '';
            return ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'S4', 'S5', 'IN'].some(st => s.includes(st));
          }).length,
          upcomingGames: rawGames.filter((g: any) => g.status?.short === 'NS' || g.status?.short === 'TBD').length,
          finishedGames: rawGames.filter((g: any) => ['FT', 'AET', 'PEN', 'AOT', 'AP'].includes(g.status?.short || '')).length,
        });
      } else {
        setError(data.error || 'Maclar yuklenemedi');
      }
    } catch (err) {
      setError('Baglanti hatasi');
    } finally {
      setLoading(false);
    }
  }, [apiPath, date, search, transformGame]);

  useEffect(() => { setPage(1); fetchGames(); }, [fetchGames]);

  const getStatusBadge = (status: string) => {
    const liveStatuses = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT', '1H', '2H', 'P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'S4', 'S5', 'LIVE', 'IN'];
    if (liveStatuses.some(s => status.includes(s))) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white animate-pulse">CANLI</span>;
    }
    if (status === 'NS') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Baslamadi</span>;
    if (['FT', 'AET', 'AOT', 'AP'].includes(status)) return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Bitti</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">{status}</span>;
  };

  const colorClasses: Record<string, { bg: string; border: string; text: string; gradientFrom: string; gradientTo: string }> = {
    orange: { bg: 'from-orange-50 via-amber-50 to-yellow-50 dark:from-slate-800 dark:via-orange-900/20 dark:to-slate-800', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-400', gradientFrom: 'from-orange-500', gradientTo: 'to-amber-500' },
    blue: { bg: 'from-blue-50 via-cyan-50 to-sky-50 dark:from-slate-800 dark:via-blue-900/20 dark:to-slate-800', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-400', gradientFrom: 'from-blue-500', gradientTo: 'to-cyan-500' },
    purple: { bg: 'from-purple-50 via-violet-50 to-fuchsia-50 dark:from-slate-800 dark:via-purple-900/20 dark:to-slate-800', border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-400', gradientFrom: 'from-purple-500', gradientTo: 'to-violet-500' },
    pink: { bg: 'from-pink-50 via-rose-50 to-red-50 dark:from-slate-800 dark:via-pink-900/20 dark:to-slate-800', border: 'border-pink-200 dark:border-pink-800', text: 'text-pink-700 dark:text-pink-400', gradientFrom: 'from-pink-500', gradientTo: 'to-rose-500' },
    green: { bg: 'from-green-50 via-emerald-50 to-teal-50 dark:from-slate-800 dark:via-emerald-900/20 dark:to-slate-800', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-400', gradientFrom: 'from-emerald-500', gradientTo: 'to-teal-500' },
  };

  const colors = colorClasses[accentColor] || colorClasses.orange;

  return (
    <div className={`min-h-screen bg-gradient-to-br ${colors.bg} transition-colors duration-300`}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{icon}</span>
            <div>
              <h1 className={`text-2xl font-bold ${colors.text}`}>{title}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {stats.totalGames} mac | {stats.liveGames} canli | {stats.upcomingGames} yaklasan
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 text-sm"
            />
            <input
              type="text"
              placeholder="Takim ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 text-sm w-48"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className={`w-12 h-12 border-4 border-gray-200 border-t-current rounded-full animate-spin ${colors.text}`}></div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Games List */}
        {!loading && !error && (
          <div className="space-y-3">
            {games.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                <span className="text-6xl block mb-4">{icon}</span>
                <p>Bu tarihte mac bulunamadi</p>
              </div>
            ) : (
              games.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map((game: any) => {
                const leagueName = game.league?.name || 'Bilinmiyor';
                const countryName = game.country?.name || '';
                const statusShort = game.status?.short || 'NS';
                const gameTime = game.time || new Date(game.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                return (
                  <div
                    key={game.id}
                    className={`bg-white dark:bg-slate-800/80 rounded-xl border ${colors.border} p-4 hover:shadow-lg transition-all duration-200`}
                  >
                    {/* League Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {game.league?.logo && (
                          <img src={game.league.logo} alt="" className="w-5 h-5 object-contain" />
                        )}
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {countryName && `${countryName} - `}{leagueName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(statusShort)}
                        <span className="text-xs text-gray-400">{gameTime}</span>
                      </div>
                    </div>

                    {/* Teams & Score */}
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          {game.teams?.home?.logo && (
                            <img src={game.teams.home.logo} alt="" className="w-8 h-8 object-contain" />
                          )}
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {game.teams?.home?.name || 'Ev Sahibi'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {game.teams?.away?.logo && (
                            <img src={game.teams.away.logo} alt="" className="w-8 h-8 object-contain" />
                          )}
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {game.teams?.away?.name || 'Deplasman'}
                          </span>
                        </div>
                      </div>

                      {/* Score */}
                      <div className="text-center mx-4">
                        {renderScore(game)}
                      </div>

                      {/* Prediction Link */}
                      <Link
                        href={`${predictionPath}/${game.id}`}
                        className={`px-4 py-2 rounded-lg bg-gradient-to-r ${colors.gradientFrom} ${colors.gradientTo} text-white text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap`}
                      >
                        Tahmin
                      </Link>
                    </div>
                  </div>
                );
              })
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Onceki
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 7) {
                    pageNum = i + 1;
                  } else if (page <= 4) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = page - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        page === pageNum
                          ? `bg-gradient-to-r ${colors.gradientFrom} ${colors.gradientTo} text-white shadow-md`
                          : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Sonraki
                </button>
                <span className="text-xs text-gray-400 ml-2">
                  {(page-1)*ITEMS_PER_PAGE+1}-{Math.min(page*ITEMS_PER_PAGE, games.length)} / {games.length}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
