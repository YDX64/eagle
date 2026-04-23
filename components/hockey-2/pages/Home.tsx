/**
 * Home Page - Günlük Maç Listesi
 * Arctic Futurism Theme - i18n destekli
 */
import { useState, useEffect, useMemo } from "react";
import Link from 'next/link';
import { PredictionResultBadge, PredictionResultBadgeProvider } from '@/components/tracking/prediction-result-badge';
import {
  getGames,
  getLiveGames,
  getTodayDate,
  formatTime,
  getGameStatusText,
  isLiveGame,
  isFinishedGame,
  isUpcomingGame,
  type Game,
} from "@/lib/hockey-2/api";
import { useLocale } from "@/components/hockey-2/contexts/LocaleContext";
import {
  ChevronRight,
  Clock,
  Zap,
  TrendingUp,
  Calendar,
  ChevronLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/hero-banner-cAvoYmzafSTHSonnd88HXv.webp";

export default function Home() {
  const { t } = useLocale();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [filterLeague, setFilterLeague] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    const fetchGames = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getGames({ date: selectedDate });
        setGames(res.response || []);
      } catch (err) {
        setError(t('common_error'));
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
    const interval = setInterval(fetchGames, 60000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  const leagues = useMemo(() => {
    const leagueMap = new Map<number, { id: number; name: string; logo: string; country: string }>();
    games.forEach((g) => {
      if (!leagueMap.has(g.league.id)) {
        leagueMap.set(g.league.id, {
          id: g.league.id,
          name: g.league.name,
          logo: g.league.logo,
          country: g.country.name,
        });
      }
    });
    return Array.from(leagueMap.values());
  }, [games]);

  const filteredGames = useMemo(() => {
    let filtered = games;
    if (filterLeague !== "all") {
      filtered = filtered.filter((g) => g.league.id === parseInt(filterLeague));
    }
    if (filterStatus === "live") {
      filtered = filtered.filter((g) => isLiveGame(g.status));
    } else if (filterStatus === "finished") {
      filtered = filtered.filter((g) => isFinishedGame(g.status));
    } else if (filterStatus === "upcoming") {
      filtered = filtered.filter((g) => isUpcomingGame(g.status));
    }
    return filtered;
  }, [games, filterLeague, filterStatus]);

  const groupedGames = useMemo(() => {
    const groups = new Map<string, { league: any; country: any; games: Game[] }>();
    filteredGames.forEach((g) => {
      const key = `${g.league.id}`;
      if (!groups.has(key)) {
        groups.set(key, { league: g.league, country: g.country, games: [] });
      }
      groups.get(key)!.games.push(g);
    });
    return Array.from(groups.values());
  }, [filteredGames]);

  const liveGames = games.filter((g) => isLiveGame(g.status));
  const finishedGames = games.filter((g) => isFinishedGame(g.status));
  const upcomingGames = games.filter((g) => isUpcomingGame(g.status));

  const changeDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div
        className="relative rounded-xl overflow-hidden h-40 sm:h-48"
        style={{ backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/60 to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-center px-6 sm:px-8">
          <h1 className="font-bold text-2xl sm:text-3xl font-bold tracking-wider text-cyan-600 dark:text-cyan-400 font-bold">
            {t('home_title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            {t('home_subtitle')}
          </p>
          <div className="flex gap-4 mt-3">
            <StatBadge icon={<Zap className="w-3.5 h-3.5" />} label={t('home_live')} value={liveGames.length} color="text-destructive" />
            <StatBadge icon={<Clock className="w-3.5 h-3.5" />} label={t('home_upcoming')} value={upcomingGames.length} color="text-cyan-600 dark:text-cyan-400" />
            <StatBadge icon={<TrendingUp className="w-3.5 h-3.5" />} label={t('home_finished')} value={finishedGames.length} color="text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Date Selector & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-2 bg-card border border-border rounded-xl backdrop-blur-sm rounded-lg px-1 py-1">
          <button onClick={() => changeDate(-1)} className="p-2 rounded-md hover:bg-accent transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 px-3">
            <Calendar className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-mono focus:outline-none"
            />
          </div>
          <button onClick={() => changeDate(1)} className="p-2 rounded-md hover:bg-accent transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-lg px-3 py-2 text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-ice/50"
          >
            <option value="all">{t('home_all_statuses')}</option>
            <option value="live">{t('home_live')}</option>
            <option value="upcoming">{t('home_upcoming')}</option>
            <option value="finished">{t('home_finished')}</option>
          </select>

          <select
            value={filterLeague}
            onChange={(e) => setFilterLeague(e.target.value)}
            className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-lg px-3 py-2 text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-ice/50"
          >
            <option value="all">{t('home_all_leagues')} ({leagues.length})</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.country})
              </option>
            ))}
          </select>
        </div>

        <div className="sm:ml-auto text-xs text-muted-foreground font-mono">
          {filteredGames.length} {t('home_matches')}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-600 dark:text-cyan-400" />
          <span className="ml-3 text-muted-foreground">{t('common_loading')}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-6 border border-destructive/30 text-center">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {/* Games List */}
      {!loading && !error && (
        <div className="space-y-6">
          {groupedGames.length === 0 ? (
            <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-10 text-center">
              <p className="text-muted-foreground">{t('home_no_matches')}</p>
            </div>
          ) : (
            groupedGames.map((group) => (
              <div key={group.league.id} className="space-y-2">
                <div className="flex items-center gap-3 px-2">
                  <img src={group.league.logo} alt={group.league.name} className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div className="flex items-center gap-2">
                    {group.country.flag && <img src={group.country.flag} alt="" className="w-4 h-3 object-contain" />}
                    <span className="text-xs text-muted-foreground">{group.country.name}</span>
                    <span className="text-xs text-muted-foreground">/</span>
                    <span className="text-sm font-semibold text-foreground">{group.league.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                    {group.games.length} {t('home_matches')}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <PredictionResultBadgeProvider sport="hockey">
                    {group.games.map((game, idx) => (
                      <GameCard key={game.id} game={game} delay={idx * 50} />
                    ))}
                  </PredictionResultBadgeProvider>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GameCard({ game, delay }: { game: Game; delay: number }) {
  const { t } = useLocale();
  const live = isLiveGame(game.status);
  const finished = isFinishedGame(game.status);

  return (
    <div className="relative">
    <Link
      href={`/hockey-2/match/${game.id}`}
      className={`block bg-card border border-border rounded-xl backdrop-blur-sm hover:bg-accent/60 transition-all rounded-lg p-3 sm:p-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 ${live ? "border-l-2 border-l-destructive" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Kazandı/Kaybetti/Bekliyor badge — absolute positioned so it doesn't break the Link */}
      <span className="absolute top-1 right-1 z-10 pointer-events-none">
        <PredictionResultBadge fixtureId={game.id as any} sport="hockey" size="xs" />
      </span>
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-16 sm:w-20 text-center shrink-0">
          {live ? (
            <div>
              <span className="text-xs font-bold text-destructive animate-pulse">{getGameStatusText(game.status)}</span>
              {game.timer && <p className="text-[10px] text-muted-foreground font-mono">{game.timer}'</p>}
            </div>
          ) : finished ? (
            <span className="text-xs text-muted-foreground">{t('home_finished')}</span>
          ) : (
            <span className="text-sm font-mono text-cyan-600 dark:text-cyan-400">{formatTime(game.date)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <img src={game.teams.home.logo} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span className="text-sm font-medium truncate">{game.teams.home.name}</span>
            </div>
            <span className={`text-lg font-bold font-mono w-8 text-center ${live ? "text-cyan-600 dark:text-cyan-400 font-bold" : finished ? "text-foreground" : "text-muted-foreground"}`}>
              {game.scores.home !== null ? game.scores.home : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <img src={game.teams.away.logo} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span className="text-sm font-medium truncate">{game.teams.away.name}</span>
            </div>
            <span className={`text-lg font-bold font-mono w-8 text-center ${live ? "text-cyan-600 dark:text-cyan-400 font-bold" : finished ? "text-foreground" : "text-muted-foreground"}`}>
              {game.scores.away !== null ? game.scores.away : "-"}
            </span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground font-mono shrink-0">
          {game.periods.first && <span>P1: {game.periods.first}</span>}
          {game.periods.second && <span>P2: {game.periods.second}</span>}
          {game.periods.third && <span>P3: {game.periods.third}</span>}
          {game.periods.overtime && <span>OT: {game.periods.overtime}</span>}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
    </div>
  );
}

function StatBadge({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={color}>{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-bold font-mono ${color}`}>{value}</span>
    </div>
  );
}
