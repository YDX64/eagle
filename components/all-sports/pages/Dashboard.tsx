/**
 * Dashboard - Main Multi-Sport Landing Page
 * Arctic Futurism Theme, Turkish UI default
 *
 * Features:
 * - Hero banner "Tüm Sporlar Analiz Platformu"
 * - 12 sport cards grid with live/upcoming/finished counts (real API data)
 * - Today's value bets preview across sports
 * - Quick links to coupons and system coupons
 */
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  Loader2,
  Ticket,
  Zap,
  TrendingUp,
  Layers,
  ChevronRight,
  Target,
  History,
  Calendar,
  AlertCircle,
  Sparkles,
  BarChart3,
  Trophy,
} from "lucide-react";
import { allSports, popularSports } from "@/lib/all-sports/sports/registry";
import { useSport } from "@/components/all-sports/contexts/SportContext";
import { useLocale } from "@/components/all-sports/contexts/LocaleContext";
import type { SportPlugin, SportId, NormalizedGame } from "@/lib/all-sports/sports/_core/types";
import { analyzeGameMarkets, DEFAULT_FILTERS } from "@/lib/all-sports/couponEngine";
import { getCouponStats } from "@/lib/all-sports/couponStorage";
import { toast } from "sonner";

const HERO_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/hero-banner-cAvoYmzafSTHSonnd88HXv.webp";

const SPORT_ICONS: Record<SportId, string> = {
  football: "⚽",
  basketball: "🏀",
  hockey: "🏒",
  volleyball: "🏐",
  handball: "🤾",
  nba: "🏀",
  americanFootball: "🏈",
  baseball: "⚾",
  rugby: "🏉",
  mma: "🥊",
  afl: "🏉",
  formula1: "🏎️",
};

interface SportCount {
  sport: SportPlugin;
  live: number;
  upcoming: number;
  finished: number;
  total: number;
  loading: boolean;
  error: boolean;
}

interface QuickValueBet {
  sport: SportId;
  sportName: string;
  gameId: number;
  home: string;
  away: string;
  market: string;
  selection: string;
  odds: number;
  trueProb: number;
  edge: number;
}

export default function Dashboard() {
  const { locale } = useLocale();
  const { setCurrentSport } = useSport();
  const [, setLocation] = useLocation();
  const [counts, setCounts] = useState<SportCount[]>([]);
  const [valueBets, setValueBets] = useState<QuickValueBet[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const today = new Date().toISOString().split("T")[0];
  const stats = getCouponStats();

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        title: "Tüm Sporlar Analiz Platformu",
        subtitle: "12 farklı sporda canlı veriye dayalı değer bahisleri, sistem kuponları ve gelişmiş analiz",
        todayBets: "Bugünkü Değer Bahisler",
        generateCoupon: "Kupon Üret",
        systemCoupon: "Sistem Kuponu",
        history: "Kupon Geçmişi",
        live: "Canlı",
        upcoming: "Yaklaşan",
        finished: "Bitmiş",
        total: "Toplam",
        game: "Maç",
        sports: "Sporlar",
        todayFound: "Bugün",
        analyzeNow: "Şimdi Analiz Et",
        analyzingSports: "Sporlar analiz ediliyor",
        noValueBets: "Henüz değer bahis bulunamadı. Analiz başlatmak için tıklayın.",
        selectSport: "Spor Seçin",
        viewMatches: "Maçları Gör",
        quickStats: "Hızlı İstatistikler",
        totalCoupons: "Toplam Kupon",
        winRate: "Kazanma %",
        roi: "ROI",
        profit: "Kar/Zarar",
        edge: "Edge",
        probability: "Olasılık",
      };
    }
    if (locale === "sv") {
      return {
        title: "Multi-Sport Analysplattform",
        subtitle: "Värde-satsningar, systemkuponger och avancerad analys över 12 sporter",
        todayBets: "Dagens Värde-satsningar",
        generateCoupon: "Skapa Kupong",
        systemCoupon: "Systemkupong",
        history: "Kuponghistorik",
        live: "Live",
        upcoming: "Kommande",
        finished: "Avslutade",
        total: "Totalt",
        game: "Match",
        sports: "Sporter",
        todayFound: "Idag",
        analyzeNow: "Analysera Nu",
        analyzingSports: "Analyserar sporter",
        noValueBets: "Inga värde-satsningar hittade. Klicka för att köra analys.",
        selectSport: "Välj Sport",
        viewMatches: "Se Matcher",
        quickStats: "Snabba Statistik",
        totalCoupons: "Totala Kuponger",
        winRate: "Vinstprocent",
        roi: "ROI",
        profit: "Vinst/Förlust",
        edge: "Edge",
        probability: "Sannolikhet",
      };
    }
    return {
      title: "Multi-Sport Analytics Platform",
      subtitle: "Live value bets, system coupons and advanced analysis across 12 sports",
      todayBets: "Today's Value Bets",
      generateCoupon: "Generate Coupon",
      systemCoupon: "System Coupon",
      history: "Coupon History",
      live: "Live",
      upcoming: "Upcoming",
      finished: "Finished",
      total: "Total",
      game: "Match",
      sports: "Sports",
      todayFound: "Today",
      analyzeNow: "Analyze Now",
      analyzingSports: "Analyzing sports",
      noValueBets: "No value bets yet. Click to run analysis.",
      selectSport: "Select Sport",
      viewMatches: "View Matches",
      quickStats: "Quick Stats",
      totalCoupons: "Total Coupons",
      winRate: "Win Rate",
      roi: "ROI",
      profit: "Profit/Loss",
      edge: "Edge",
      probability: "Probability",
    };
  }, [locale]);

  // Fetch counts per sport in parallel
  useEffect(() => {
    const initial: SportCount[] = allSports.map((s) => ({
      sport: s,
      live: 0,
      upcoming: 0,
      finished: 0,
      total: 0,
      loading: true,
      error: false,
    }));
    setCounts(initial);

    allSports.forEach((sport) => {
      sport
        .getGamesByDate(today)
        .then((games) => {
          const live = games.filter((g) => g.status.live).length;
          const upcoming = games.filter((g) => g.status.upcoming).length;
          const finished = games.filter((g) => g.status.finished).length;
          setCounts((prev) =>
            prev.map((c) =>
              c.sport.config.id === sport.config.id
                ? {
                    ...c,
                    live,
                    upcoming,
                    finished,
                    total: games.length,
                    loading: false,
                  }
                : c
            )
          );
        })
        .catch((err) => {
          console.error(`Dashboard error ${sport.config.id}:`, err);
          setCounts((prev) =>
            prev.map((c) =>
              c.sport.config.id === sport.config.id
                ? { ...c, loading: false, error: true }
                : c
            )
          );
        });
    });
  }, [today]);

  const totalLive = counts.reduce((a, c) => a + c.live, 0);
  const totalUpcoming = counts.reduce((a, c) => a + c.upcoming, 0);
  const totalGames = counts.reduce((a, c) => a + c.total, 0);

  const runQuickAnalysis = async () => {
    setAnalyzing(true);
    setAnalyzeProgress(0);
    setValueBets([]);
    const bets: QuickValueBet[] = [];
    try {
      // Analyze only popular sports for the quick dashboard preview
      const sportsToAnalyze = popularSports.slice(0, 5);
      let processed = 0;
      for (const sport of sportsToAnalyze) {
        try {
          const games = await sport.getGamesByDate(today);
          const upcoming = games.filter((g) => g.status.upcoming).slice(0, 3);
          for (const game of upcoming) {
            try {
              const vbs = await analyzeGameMarkets(sport, game, DEFAULT_FILTERS);
              vbs.slice(0, 2).forEach((vb) => {
                bets.push({
                  sport: sport.config.id,
                  sportName:
                    locale === "tr"
                      ? sport.config.displayNameTR
                      : sport.config.displayName,
                  gameId: game.id,
                  home: game.teams.home.name,
                  away: game.teams.away.name,
                  market: vb.iddaaName,
                  selection: vb.selection,
                  odds: vb.odds,
                  trueProb: vb.trueProbability * 100,
                  edge: vb.edge * 100,
                });
              });
            } catch (err) {
              // Skip individual errors
            }
          }
        } catch (err) {
          console.error(`Analysis error ${sport.config.id}:`, err);
        }
        processed += 1;
        setAnalyzeProgress(Math.round((processed / sportsToAnalyze.length) * 100));
        setValueBets(
          bets.sort((a, b) => b.edge - a.edge).slice(0, 12)
        );
      }
      if (bets.length === 0) {
        toast.info(labels.noValueBets);
      } else {
        toast.success(`${bets.length} ${locale === "tr" ? "değer bahis bulundu" : "value bets found"}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div
        className="relative rounded-xl overflow-hidden h-52 sm:h-64"
        style={{
          backgroundImage: `url(${HERO_BG})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-center px-6 sm:px-10 max-w-3xl">
          <h1 className="font-display text-3xl sm:text-5xl font-black tracking-wider neon-text leading-tight">
            {labels.title}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-3 max-w-xl">
            {labels.subtitle}
          </p>
          <div className="flex flex-wrap gap-3 mt-5">
            <Link
              href="/coupons"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ice text-background hover:bg-ice/90 text-sm font-bold transition-all"
            >
              <Ticket className="w-4 h-4" /> {labels.generateCoupon}
            </Link>
            <Link
              href="/system-coupons"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aurora/20 border border-aurora/40 text-aurora hover:bg-aurora/30 text-sm font-bold transition-all"
            >
              <Layers className="w-4 h-4" /> {labels.systemCoupon}
            </Link>
            <Link
              href="/coupon-history"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/40 border border-border hover:bg-accent/60 text-sm font-medium transition-all"
            >
              <History className="w-4 h-4" /> {labels.history}
            </Link>
          </div>
        </div>
      </div>

      {/* Global stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          icon={<Zap className="w-4 h-4" />}
          label={labels.live}
          value={totalLive}
          color="text-destructive"
          ringColor="border-destructive/30"
        />
        <StatTile
          icon={<Calendar className="w-4 h-4" />}
          label={labels.upcoming}
          value={totalUpcoming}
          color="text-ice"
          ringColor="border-ice/30"
        />
        <StatTile
          icon={<BarChart3 className="w-4 h-4" />}
          label={`${labels.total} ${labels.game}`}
          value={totalGames}
          color="text-aurora"
          ringColor="border-aurora/30"
        />
        <StatTile
          icon={<TrendingUp className="w-4 h-4" />}
          label={labels.sports}
          value={allSports.length}
          color="text-warning"
          ringColor="border-warning/30"
        />
      </div>

      {/* Coupon performance */}
      {stats.total > 0 && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-bold tracking-wider neon-text flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> {labels.quickStats}
            </h3>
            <Link
              href="/coupon-history"
              className="text-xs text-ice hover:underline flex items-center gap-1"
            >
              {labels.history} <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStat label={labels.totalCoupons} value={stats.total.toString()} />
            <MiniStat
              label={labels.winRate}
              value={`${stats.winRate.toFixed(1)}%`}
              color={stats.winRate >= 50 ? "text-aurora" : "text-destructive"}
            />
            <MiniStat
              label={labels.roi}
              value={`${stats.roi > 0 ? "+" : ""}${stats.roi.toFixed(1)}%`}
              color={stats.roi > 0 ? "text-aurora" : stats.roi < 0 ? "text-destructive" : "text-foreground"}
            />
            <MiniStat
              label={labels.profit}
              value={`${stats.profit > 0 ? "+" : ""}${stats.profit.toFixed(0)}`}
              color={stats.profit > 0 ? "text-aurora" : stats.profit < 0 ? "text-destructive" : "text-foreground"}
            />
          </div>
        </div>
      )}

      {/* Sport cards grid */}
      <div>
        <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5" /> {labels.sports}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {counts.map(({ sport, live, upcoming, finished, total, loading, error }) => {
            const id = sport.config.id;
            const name = locale === "tr" ? sport.config.displayNameTR : sport.config.displayName;
            return (
              <button
                key={id}
                onClick={() => {
                  setCurrentSport(id);
                  setLocation(`/sport/${id}`);
                }}
                className="glass-card glass-card-hover rounded-xl p-4 text-left transition-all cursor-pointer group relative overflow-hidden"
              >
                {live > 0 && (
                  <span className="absolute top-3 right-3 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                  </span>
                )}
                <div className="flex items-start gap-3">
                  <span className="text-3xl leading-none">{SPORT_ICONS[id]}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate group-hover:text-ice transition-colors">
                      {name}
                    </h3>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                      {sport.config.iddaaCategory}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  {loading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>...</span>
                    </div>
                  ) : error ? (
                    <div className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="w-3 h-3" />
                      <span>Error</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <div className="text-center">
                        <p className="text-destructive font-bold font-mono">{live}</p>
                        <p className="text-[9px] text-muted-foreground uppercase">
                          {labels.live}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-ice font-bold font-mono">{upcoming}</p>
                        <p className="text-[9px] text-muted-foreground uppercase">
                          {labels.upcoming}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-aurora font-bold font-mono">{finished}</p>
                        <p className="text-[9px] text-muted-foreground uppercase">
                          {labels.finished}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-border/20 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {labels.total}: <span className="font-mono font-bold text-foreground">{total}</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-ice transition-all group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Value bets preview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2">
            <Target className="w-5 h-5" /> {labels.todayBets}
          </h2>
          <button
            onClick={runQuickAnalysis}
            disabled={analyzing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-ice text-background hover:bg-ice/90 disabled:opacity-50 disabled:cursor-wait transition-all"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {labels.analyzingSports} {analyzeProgress}%
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" /> {labels.analyzeNow}
              </>
            )}
          </button>
        </div>

        {valueBets.length === 0 && !analyzing && (
          <div className="glass-card rounded-xl p-8 text-center">
            <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-muted-foreground text-sm">{labels.noValueBets}</p>
          </div>
        )}

        {valueBets.length > 0 && (
          <div className="grid gap-2">
            {valueBets.map((vb, i) => (
              <Link
                key={i}
                href={`/match/${vb.sport}/${vb.gameId}`}
                className="glass-card glass-card-hover rounded-lg p-3 flex items-center gap-3"
              >
                <span className="text-2xl leading-none">{SPORT_ICONS[vb.sport]}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {vb.home} vs {vb.away}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {vb.sportName} • {vb.market}: {vb.selection}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-mono font-bold text-ice">
                    {vb.odds.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-aurora font-bold">
                    +{vb.edge.toFixed(1)}% {labels.edge}
                  </p>
                </div>
                <div className="text-right shrink-0 min-w-[60px]">
                  <p className="text-sm font-mono font-bold text-aurora">
                    {vb.trueProb.toFixed(0)}%
                  </p>
                  <p className="text-[9px] text-muted-foreground uppercase">
                    {labels.probability}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  color,
  ringColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  ringColor: string;
}) {
  return (
    <div className={`glass-card rounded-xl p-4 border ${ringColor}`}>
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <p className={`text-2xl font-display font-black ${color} font-mono`}>{value}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color = "text-foreground",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className={`text-lg font-display font-black font-mono ${color}`}>{value}</p>
    </div>
  );
}
