/**
 * SportHome - Per-sport match list page
 * Reads sportId from URL, uses getSport(sportId), displays matches grouped by league.
 */
import { useState, useEffect, useMemo } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  ChevronRight,
  ChevronLeft,
  Clock,
  Zap,
  Calendar,
  Loader2,
  AlertCircle,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";
import { getSport } from "@/sports/registry";
import { useSport } from "@/contexts/SportContext";
import { useLocale } from "@/contexts/LocaleContext";
import type { NormalizedGame, SportId } from "@/sports/_core/types";

export default function SportHome() {
  const { sportId } = useParams<{ sportId: string }>();
  const [, setLocation] = useLocation();
  const { setCurrentSport } = useSport();
  const { locale } = useLocale();

  const plugin = useMemo(() => {
    try {
      return getSport(sportId as SportId);
    } catch {
      return null;
    }
  }, [sportId]);

  const [games, setGames] = useState<NormalizedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [filterStatus, setFilterStatus] = useState<"all" | "live" | "upcoming" | "finished">(
    "all"
  );
  const [filterLeague, setFilterLeague] = useState<string>("all");

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        allStatuses: "Tüm Durumlar",
        allLeagues: "Tüm Ligler",
        live: "Canlı",
        upcoming: "Yaklaşan",
        finished: "Bitmiş",
        matches: "maç",
        backToDashboard: "Ana Panele Dön",
        noMatches: "Seçilen tarih ve filtrelere uygun maç bulunamadı",
        errorTitle: "Hata",
        unknownSport: "Bilinmeyen spor",
        notStarted: "Başlamadı",
        loading: "Yükleniyor...",
      };
    }
    if (locale === "sv") {
      return {
        allStatuses: "Alla Statusar",
        allLeagues: "Alla Ligor",
        live: "Live",
        upcoming: "Kommande",
        finished: "Avslutade",
        matches: "matcher",
        backToDashboard: "Tillbaka till Dashboard",
        noMatches: "Inga matcher hittades",
        errorTitle: "Fel",
        unknownSport: "Okänd sport",
        notStarted: "Ej startad",
        loading: "Laddar...",
      };
    }
    return {
      allStatuses: "All Statuses",
      allLeagues: "All Leagues",
      live: "Live",
      upcoming: "Upcoming",
      finished: "Finished",
      matches: "matches",
      backToDashboard: "Back to Dashboard",
      noMatches: "No matches found",
      errorTitle: "Error",
      unknownSport: "Unknown sport",
      notStarted: "Not Started",
      loading: "Loading...",
    };
  }, [locale]);

  useEffect(() => {
    if (plugin) {
      setCurrentSport(plugin.config.id);
    }
  }, [plugin, setCurrentSport]);

  useEffect(() => {
    if (!plugin) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetched = await plugin.getGamesByDate(selectedDate);
        if (!cancelled) {
          setGames(fetched);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load games");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [plugin, selectedDate]);

  const leagues = useMemo(() => {
    const map = new Map<number, { id: number; name: string; logo?: string; country?: string }>();
    games.forEach((g) => {
      if (!map.has(g.league.id)) {
        map.set(g.league.id, {
          id: g.league.id,
          name: g.league.name,
          logo: g.league.logo,
          country: g.league.country,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [games]);

  const filteredGames = useMemo(() => {
    let result = games;
    if (filterLeague !== "all") {
      result = result.filter((g) => g.league.id === parseInt(filterLeague));
    }
    if (filterStatus === "live") result = result.filter((g) => g.status.live);
    else if (filterStatus === "upcoming") result = result.filter((g) => g.status.upcoming);
    else if (filterStatus === "finished") result = result.filter((g) => g.status.finished);
    return result;
  }, [games, filterLeague, filterStatus]);

  const grouped = useMemo(() => {
    const map = new Map<number, { league: NormalizedGame["league"]; games: NormalizedGame[] }>();
    filteredGames.forEach((g) => {
      if (!map.has(g.league.id)) {
        map.set(g.league.id, { league: g.league, games: [] });
      }
      map.get(g.league.id)!.games.push(g);
    });
    return Array.from(map.values());
  }, [filteredGames]);

  const liveCount = games.filter((g) => g.status.live).length;
  const upcomingCount = games.filter((g) => g.status.upcoming).length;
  const finishedCount = games.filter((g) => g.status.finished).length;

  const changeDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  if (!plugin) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="font-semibold">{labels.unknownSport}: {sportId}</p>
        <button
          onClick={() => setLocation("/")}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ice text-background text-sm font-bold"
        >
          <ArrowLeft className="w-4 h-4" /> {labels.backToDashboard}
        </button>
      </div>
    );
  }

  const sportName =
    locale === "tr" ? plugin.config.displayNameTR : plugin.config.displayName;

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> {labels.backToDashboard}
      </Link>

      <div className="glass-card rounded-xl p-6 border border-ice/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-black neon-text tracking-wider">
              {sportName}
            </h1>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-mono">
              {plugin.config.iddaaCategory} • {plugin.config.apiBase.replace("https://", "")}
            </p>
          </div>
          <div className="flex gap-3 text-xs">
            <StatBadge
              icon={<Zap className="w-3.5 h-3.5" />}
              label={labels.live}
              value={liveCount}
              color="text-destructive"
            />
            <StatBadge
              icon={<Clock className="w-3.5 h-3.5" />}
              label={labels.upcoming}
              value={upcomingCount}
              color="text-ice"
            />
            <StatBadge
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              label={labels.finished}
              value={finishedCount}
              color="text-aurora"
            />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-2 glass-card rounded-lg px-1 py-1">
          <button
            onClick={() => changeDate(-1)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 px-3">
            <Calendar className="w-4 h-4 text-ice" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-mono focus:outline-none"
            />
          </div>
          <button
            onClick={() => changeDate(1)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="glass-card rounded-lg px-3 py-2 text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-ice/50"
        >
          <option value="all">{labels.allStatuses}</option>
          <option value="live">{labels.live}</option>
          <option value="upcoming">{labels.upcoming}</option>
          <option value="finished">{labels.finished}</option>
        </select>

        <select
          value={filterLeague}
          onChange={(e) => setFilterLeague(e.target.value)}
          className="glass-card rounded-lg px-3 py-2 text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-ice/50 max-w-[260px]"
        >
          <option value="all">
            {labels.allLeagues} ({leagues.length})
          </option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.country ? ` (${l.country})` : ""}
            </option>
          ))}
        </select>

        <div className="sm:ml-auto text-xs text-muted-foreground font-mono">
          {filteredGames.length} {labels.matches}
        </div>
      </div>

      {loading && games.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-ice" />
          <span className="ml-3 text-muted-foreground">{labels.loading}</span>
        </div>
      )}

      {error && (
        <div className="glass-card rounded-xl p-6 border border-destructive/30 text-center">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-destructive font-semibold">{labels.errorTitle}</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="glass-card rounded-xl p-10 text-center">
          <p className="text-muted-foreground">{labels.noMatches}</p>
        </div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.league.id} className="space-y-2">
              <div className="flex items-center gap-3 px-2">
                {group.league.logo && (
                  <img
                    src={group.league.logo}
                    alt={group.league.name}
                    className="w-6 h-6 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="flex items-center gap-2">
                  {group.league.country && (
                    <span className="text-xs text-muted-foreground">
                      {group.league.country}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">/</span>
                  <span className="text-sm font-semibold text-foreground">
                    {group.league.name}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                  {group.games.length} {labels.matches}
                </span>
              </div>
              <div className="space-y-1.5">
                {group.games.map((g, i) => (
                  <GameRow
                    key={g.id}
                    game={g}
                    sportId={plugin.config.id}
                    delay={i * 30}
                    locale={locale}
                    notStartedLabel={labels.notStarted}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GameRow({
  game,
  sportId,
  delay,
  locale,
  notStartedLabel,
}: {
  game: NormalizedGame;
  sportId: SportId;
  delay: number;
  locale: string;
  notStartedLabel: string;
}) {
  const live = game.status.live;
  const finished = game.status.finished;
  const timeLoc = locale === "tr" ? "tr-TR" : locale === "sv" ? "sv-SE" : "en-GB";
  const timeStr = new Date(game.date).toLocaleTimeString(timeLoc, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/match/${sportId}/${game.id}`}
      className={`block glass-card glass-card-hover rounded-lg p-3 sm:p-4 transition-all duration-300 animate-fade-in-up ${
        live ? "border-l-2 border-l-destructive" : ""
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-20 text-center shrink-0">
          {live ? (
            <span className="text-xs font-bold text-destructive animate-pulse">
              {game.status.short}
            </span>
          ) : finished ? (
            <span className="text-xs text-muted-foreground">{game.status.short}</span>
          ) : (
            <span className="text-sm font-mono text-ice">{timeStr}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {game.teams.home.logo && (
                <img
                  src={game.teams.home.logo}
                  alt=""
                  className="w-5 h-5 object-contain shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="text-sm font-medium truncate">{game.teams.home.name}</span>
            </div>
            <span
              className={`text-lg font-bold font-mono w-8 text-center ${
                live ? "neon-text" : finished ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {game.scores.home !== null ? game.scores.home : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {game.teams.away.logo && (
                <img
                  src={game.teams.away.logo}
                  alt=""
                  className="w-5 h-5 object-contain shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="text-sm font-medium truncate">{game.teams.away.name}</span>
            </div>
            <span
              className={`text-lg font-bold font-mono w-8 text-center ${
                live ? "neon-text" : finished ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {game.scores.away !== null ? game.scores.away : "-"}
            </span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

function StatBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={color}>{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-bold font-mono ${color}`}>{value}</span>
    </div>
  );
}
