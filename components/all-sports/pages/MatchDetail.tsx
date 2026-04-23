/**
 * MatchDetail - Multi-sport match detail page
 * Reads sportId and match id from URL, uses getSport(sportId) plugin.
 * Tabs: Analysis, Odds, Markets (filtered high-quality), H2H, Players (if applicable)
 */
import { useState, useEffect, useMemo } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft,
  Loader2,
  BarChart3,
  Target,
  TrendingUp,
  Zap,
  AlertCircle,
  Star,
  CheckCircle2,
  XCircle,
  Filter,
} from "lucide-react";
import { getSport } from "@/lib/all-sports/sports/registry";
import { useLocale } from "@/components/all-sports/contexts/LocaleContext";
import { useSport } from "@/components/all-sports/contexts/SportContext";
import { analyzeGameMarkets, DEFAULT_FILTERS } from "@/lib/all-sports/couponEngine";
import { saveCoupon } from "@/lib/all-sports/couponStorage";
import { calculateEdge, rateValueBet } from "@/lib/all-sports/sports/_core/kelly";
import type {
  NormalizedGame,
  Prediction,
  NormalizedOdds,
  SportId,
  ValueBet,
} from "@/lib/all-sports/sports/_core/types";
import { toast } from "sonner";

type TabId = "analysis" | "odds" | "markets" | "h2h" | "players";

export default function MatchDetail() {
  const params = useParams<{ sportId: string; id: string }>();
  const [, setLocation] = useLocation();
  const { setCurrentSport } = useSport();
  const { locale } = useLocale();
  const sportId = params.sportId as SportId;
  const matchId = parseInt(params.id || "0");

  const plugin = useMemo(() => {
    try {
      return getSport(sportId);
    } catch {
      return null;
    }
  }, [sportId]);

  const [loading, setLoading] = useState(true);
  const [game, setGame] = useState<NormalizedGame | null>(null);
  const [odds, setOdds] = useState<NormalizedOdds | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [valueBets, setValueBets] = useState<ValueBet[]>([]);
  const [h2h, setH2h] = useState<NormalizedGame[]>([]);
  const [homeStats, setHomeStats] = useState<any>(null);
  const [awayStats, setAwayStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabId>("analysis");
  const [minOdds, setMinOdds] = useState(1.6);
  const [minProb, setMinProb] = useState(70);
  const [error, setError] = useState<string | null>(null);

  const labels = useMemo(() => {
    if (locale === "tr") {
      return {
        back: "Maç Listesine Dön",
        loading: "Analiz yapılıyor...",
        notFound: "Maç bulunamadı",
        invalidSport: "Geçersiz spor",
        analysis: "Analiz",
        odds: "Oranlar",
        markets: "Pazarlar",
        h2h: "H2H",
        players: "Oyuncular",
        winProbs: "KAZANMA OLASILIKLARI",
        expectedGoals: "BEKLENEN SAYI/GOL",
        overUnder: "ALT/ÜST",
        likelyScores: "EN OLASI SKORLAR",
        home: "Ev Sahibi",
        away: "Deplasman",
        draw: "Beraberlik",
        total: "Toplam",
        confidence: "Güven Skoru",
        btts: "Karşılıklı Gol",
        bttsYes: "Var",
        bttsNo: "Yok",
        filters: "Filtreler",
        minOdds: "Min Oran",
        minProb: "Min Olasılık",
        market: "Pazar",
        selection: "Seçim",
        oddsCol: "Oran",
        trueProb: "Gerçek Olasılık",
        edge: "Edge",
        rating: "Değerlendirme",
        save: "Kaydet",
        saveBet: "Tek Bahsi Kaydet",
        marketsEmpty: "Filtrelere uygun pazar bulunamadı. Filtreleri gevşetin.",
        h2hEmpty: "Karşılıklı maç verisi bulunamadı",
        h2hLast: "SON MAÇLAR",
        homeWins: "Ev Galibiyet",
        awayWins: "Deplasman Galibiyet",
        draws: "Beraberlik",
        statsCompare: "İSTATİSTİK KARŞILAŞTIRMA",
        form: "Form Skoru",
        noOdds: "Bu maç için oran verisi yok",
        noPrediction: "Tahmin yapılamadı",
        oddsTable: "ORAN TABLOSU",
        bookmaker: "Bahisçi",
        saveAsBet: "Bahis Olarak Kaydet",
        savedOk: "Kupon kaydedildi",
        excellent: "Mükemmel",
        good: "İyi",
        moderate: "Orta",
        low: "Düşük",
        finishedResult: "Bitti",
      };
    }
    if (locale === "sv") {
      return {
        back: "Tillbaka till matcher",
        loading: "Analyserar...",
        notFound: "Match hittades inte",
        invalidSport: "Ogiltig sport",
        analysis: "Analys",
        odds: "Odds",
        markets: "Marknader",
        h2h: "H2H",
        players: "Spelare",
        winProbs: "VINSTSANNOLIKHET",
        expectedGoals: "FÖRVÄNTADE MÅL",
        overUnder: "ÖVER/UNDER",
        likelyScores: "TROLIGA RESULTAT",
        home: "Hemma",
        away: "Borta",
        draw: "Oavgjort",
        total: "Totalt",
        confidence: "Konfidens",
        btts: "Båda Gör Mål",
        bttsYes: "Ja",
        bttsNo: "Nej",
        filters: "Filter",
        minOdds: "Min Odds",
        minProb: "Min Sannolikhet",
        market: "Marknad",
        selection: "Val",
        oddsCol: "Odds",
        trueProb: "Verklig Sannolikhet",
        edge: "Edge",
        rating: "Betyg",
        save: "Spara",
        saveBet: "Spara Spel",
        marketsEmpty: "Inga marknader matchar filtren. Släpp på filtren.",
        h2hEmpty: "Ingen H2H-data",
        h2hLast: "SENASTE MATCHER",
        homeWins: "Hemmavinster",
        awayWins: "Bortavinster",
        draws: "Oavgjorda",
        statsCompare: "STATISTIKJÄMFÖRELSE",
        form: "Form",
        noOdds: "Inga odds för denna match",
        noPrediction: "Prognos ej tillgänglig",
        oddsTable: "ODDSTABELL",
        bookmaker: "Bookmaker",
        saveAsBet: "Spara som spel",
        savedOk: "Kupong sparad",
        excellent: "Utmärkt",
        good: "Bra",
        moderate: "Medel",
        low: "Låg",
        finishedResult: "Avslutad",
      };
    }
    return {
      back: "Back to Matches",
      loading: "Analyzing...",
      notFound: "Match not found",
      invalidSport: "Invalid sport",
      analysis: "Analysis",
      odds: "Odds",
      markets: "Markets",
      h2h: "H2H",
      players: "Players",
      winProbs: "WIN PROBABILITIES",
      expectedGoals: "EXPECTED SCORE",
      overUnder: "OVER/UNDER",
      likelyScores: "LIKELY SCORES",
      home: "Home",
      away: "Away",
      draw: "Draw",
      total: "Total",
      confidence: "Confidence",
      btts: "Both Teams Score",
      bttsYes: "Yes",
      bttsNo: "No",
      filters: "Filters",
      minOdds: "Min Odds",
      minProb: "Min Probability",
      market: "Market",
      selection: "Selection",
      oddsCol: "Odds",
      trueProb: "True Prob",
      edge: "Edge",
      rating: "Rating",
      save: "Save",
      saveBet: "Save Bet",
      marketsEmpty: "No markets match the filters. Relax them.",
      h2hEmpty: "No H2H data available",
      h2hLast: "RECENT MATCHES",
      homeWins: "Home Wins",
      awayWins: "Away Wins",
      draws: "Draws",
      statsCompare: "STATISTICS COMPARISON",
      form: "Form Score",
      noOdds: "No odds for this match",
      noPrediction: "Prediction not available",
      oddsTable: "ODDS TABLE",
      bookmaker: "Bookmaker",
      saveAsBet: "Save as bet",
      savedOk: "Coupon saved",
      excellent: "Excellent",
      good: "Good",
      moderate: "Moderate",
      low: "Low",
      finishedResult: "Finished",
    };
  }, [locale]);

  useEffect(() => {
    if (plugin) setCurrentSport(plugin.config.id);
  }, [plugin, setCurrentSport]);

  useEffect(() => {
    if (!plugin || !matchId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const g = await plugin.getGameById(matchId);
        if (cancelled) return;
        if (!g) {
          setError(labels.notFound);
          setLoading(false);
          return;
        }
        setGame(g);

        // Parallel fetch
        const [oddsData, h2hData, homeStatsData, awayStatsData] = await Promise.all([
          plugin.getOddsForGame(matchId).catch(() => null),
          plugin.getH2H(g.teams.home.id, g.teams.away.id).catch(() => []),
          plugin.getTeamStatistics && typeof g.league.season === "number"
            ? plugin
                .getTeamStatistics(g.teams.home.id, g.league.id, g.league.season as number)
                .catch(() => null)
            : Promise.resolve(null),
          plugin.getTeamStatistics && typeof g.league.season === "number"
            ? plugin
                .getTeamStatistics(g.teams.away.id, g.league.id, g.league.season as number)
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;
        setOdds(oddsData);
        setH2h(h2hData);
        setHomeStats(homeStatsData);
        setAwayStats(awayStatsData);

        const pred = plugin.predict({
          game: g,
          homeStats: homeStatsData,
          awayStats: awayStatsData,
          h2h: h2hData,
        });
        setPrediction(pred);

        // Value bets from odds
        if (oddsData) {
          const vbs = await analyzeGameMarkets(plugin, g, {
            ...DEFAULT_FILTERS,
            minOdds: 1.01,
            minProbability: 0,
            minEdge: -100,
          });
          setValueBets(vbs);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
  }, [plugin, matchId, labels.notFound]);

  if (!plugin) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="font-semibold">{labels.invalidSport}: {sportId}</p>
        <button
          onClick={() => setLocation("/")}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ice text-background text-sm font-bold"
        >
          <ArrowLeft className="w-4 h-4" /> {labels.back}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ice" />
        <span className="ml-3 text-muted-foreground">{labels.loading}</span>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="font-semibold">{error || labels.notFound}</p>
        <button
          onClick={() => setLocation(`/sport/${sportId}`)}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ice text-background text-sm font-bold"
        >
          <ArrowLeft className="w-4 h-4" /> {labels.back}
        </button>
      </div>
    );
  }

  const live = game.status.live;
  const finished = game.status.finished;
  const sportName =
    locale === "tr" ? plugin.config.displayNameTR : plugin.config.displayName;

  // Filtered markets
  const filteredMarkets = valueBets.filter(
    (vb) => vb.odds >= minOdds && vb.trueProbability * 100 >= minProb
  );

  // Markets tab data directly from odds (all with true probability)
  const allOddsRows = (() => {
    if (!odds || !prediction) return [] as {
      bookmaker: string;
      market: string;
      iddaaName: string;
      selection: string;
      odds: number;
      trueProb: number;
      edge: number;
      rating: "excellent" | "good" | "moderate" | "low";
    }[];

    const rows: {
      bookmaker: string;
      market: string;
      iddaaName: string;
      selection: string;
      odds: number;
      trueProb: number;
      edge: number;
      rating: "excellent" | "good" | "moderate" | "low";
    }[] = [];
    for (const bm of odds.bookmakers) {
      for (const bet of bm.bets) {
        const iddaa = plugin.config.marketNameMapping[bet.name] || bet.name;
        for (const v of bet.values) {
          const trueProb = plugin.evaluateMarket({
            prediction,
            betName: bet.name,
            selection: v.value,
            game,
          });
          if (trueProb <= 0) continue;
          const edge = calculateEdge(trueProb, v.odd);
          rows.push({
            bookmaker: bm.name,
            market: bet.name,
            iddaaName: iddaa,
            selection: v.value,
            odds: v.odd,
            trueProb: trueProb * 100,
            edge: edge * 100,
            rating: rateValueBet(edge),
          });
        }
      }
    }
    // Deduplicate: best odds per (market, selection)
    const best = new Map<string, (typeof rows)[0]>();
    rows.forEach((r) => {
      const key = `${r.market}-${r.selection}`;
      const ex = best.get(key);
      if (!ex || r.odds > ex.odds) best.set(key, r);
    });
    return Array.from(best.values()).sort((a, b) => b.edge - a.edge);
  })();

  const filteredMarketRows = allOddsRows.filter(
    (r) => r.odds >= minOdds && r.trueProb >= minProb
  );

  const saveSingleBet = (row: (typeof allOddsRows)[0]) => {
    saveCoupon({
      name: `${game.teams.home.name} vs ${game.teams.away.name}`,
      strategyName: "Single Bet",
      totalOdds: row.odds,
      stake: 10,
      potentialReturn: row.odds * 10,
      riskLevel: row.edge > 15 ? "low" : row.edge > 8 ? "medium" : "high",
      bets: [
        {
          gameId: game.id,
          sport: sportId,
          sportDisplay: sportName,
          homeTeam: game.teams.home.name,
          awayTeam: game.teams.away.name,
          league: game.league.name,
          matchDate: game.date,
          betType: row.market,
          iddaaName: row.iddaaName,
          selection: row.selection,
          odds: row.odds,
          trueProbability: row.trueProb / 100,
          edge: row.edge / 100,
          confidence: prediction?.confidence ?? 50,
          result: "pending",
        },
      ],
    });
    toast.success(labels.savedOk);
  };

  const tabs: { id: TabId; label: string; icon: React.ComponentType<any>; count?: number }[] = [
    { id: "analysis", label: labels.analysis, icon: BarChart3 },
    { id: "markets", label: labels.markets, icon: Target, count: filteredMarketRows.length },
    { id: "odds", label: labels.odds, icon: Zap, count: odds?.bookmakers.length ?? 0 },
    { id: "h2h", label: labels.h2h, icon: TrendingUp, count: h2h.length },
  ];

  return (
    <div className="space-y-5">
      <Link
        href={`/sport/${sportId}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> {labels.back}
      </Link>

      {/* Header */}
      <div className="glass-card rounded-xl p-5 sm:p-6 border border-ice/20">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-3">
          {sportName} • {game.league.name}
          {game.league.country ? ` • ${game.league.country}` : ""}
        </p>
        <div className="grid grid-cols-3 items-center gap-4">
          <div className="text-center">
            {game.teams.home.logo && (
              <img
                src={game.teams.home.logo}
                alt=""
                className="w-14 h-14 sm:w-20 sm:h-20 object-contain mx-auto"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <h2 className="font-display font-bold text-sm sm:text-base mt-2">
              {game.teams.home.name}
            </h2>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
              {labels.home}
            </p>
          </div>
          <div className="text-center">
            {live ? (
              <span className="inline-block text-[10px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full border border-destructive/30 animate-pulse mb-2">
                LIVE
              </span>
            ) : finished ? (
              <span className="text-[10px] text-muted-foreground mb-2 block">
                {labels.finishedResult}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground mb-2 block font-mono">
                {new Date(game.date).toLocaleString(
                  locale === "tr" ? "tr-TR" : locale === "sv" ? "sv-SE" : "en-GB"
                )}
              </span>
            )}
            {game.scores.home !== null && game.scores.away !== null ? (
              <p className="text-3xl sm:text-5xl font-display font-black neon-text font-mono">
                {game.scores.home} - {game.scores.away}
              </p>
            ) : (
              <p className="text-3xl sm:text-5xl font-display font-black text-muted-foreground font-mono">
                - : -
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">{game.status.long}</p>
          </div>
          <div className="text-center">
            {game.teams.away.logo && (
              <img
                src={game.teams.away.logo}
                alt=""
                className="w-14 h-14 sm:w-20 sm:h-20 object-contain mx-auto"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <h2 className="font-display font-bold text-sm sm:text-base mt-2">
              {game.teams.away.name}
            </h2>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
              {labels.away}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-thin">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                active
                  ? "glass-card neon-border text-ice"
                  : "text-muted-foreground hover:bg-accent/30"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="text-[10px] bg-accent/50 px-1.5 py-0.5 rounded-full font-mono">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Analysis Tab */}
      {activeTab === "analysis" && prediction && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="glass-card rounded-xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                {labels.winProbs}
              </p>
              <div className="space-y-2">
                <ProbRow
                  label={labels.home}
                  value={prediction.homeWinProb}
                  color="text-ice"
                />
                {plugin.config.allowsDraw && (
                  <ProbRow
                    label={labels.draw}
                    value={prediction.drawProb}
                    color="text-warning"
                  />
                )}
                <ProbRow
                  label={labels.away}
                  value={prediction.awayWinProb}
                  color="text-aurora"
                />
              </div>
              <div className="mt-3 pt-3 border-t border-border/30">
                <p className="text-[10px] text-muted-foreground">{labels.confidence}</p>
                <p className="text-lg font-display font-black neon-text font-mono">
                  {prediction.confidence.toFixed(0)}%
                </p>
              </div>
            </div>

            <div className="glass-card rounded-xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                {labels.expectedGoals}
              </p>
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">{labels.home}</p>
                  <p className="text-2xl font-mono font-bold text-ice">
                    {prediction.expectedHomeScore.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{labels.away}</p>
                  <p className="text-2xl font-mono font-bold text-aurora">
                    {prediction.expectedAwayScore.toFixed(2)}
                  </p>
                </div>
                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs text-muted-foreground">{labels.total}</p>
                  <p className="text-2xl font-mono font-bold neon-text">
                    {prediction.expectedTotalScore.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {prediction.btts && (
              <div className="glass-card rounded-xl p-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                  {labels.btts}
                </p>
                <div className="space-y-2">
                  <ProbRow label={labels.bttsYes} value={prediction.btts.yes} color="text-aurora" />
                  <ProbRow label={labels.bttsNo} value={prediction.btts.no} color="text-ice" />
                </div>
                <div className="mt-3 pt-3 border-t border-border/30">
                  <p className="text-[10px] text-muted-foreground">{labels.form}</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-ice font-mono">
                      {labels.home}: {prediction.homeForm.toFixed(2)}
                    </span>
                    <span className="text-aurora font-mono">
                      {labels.away}: {prediction.awayForm.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Over/Under */}
          {Object.keys(prediction.overUnder).length > 0 && (
            <div className="glass-card rounded-xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                {labels.overUnder}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {Object.entries(prediction.overUnder).map(([line, probs]) => (
                  <div
                    key={line}
                    className="bg-accent/30 rounded-lg p-2 text-center"
                  >
                    <p className="text-xs font-mono text-muted-foreground">{line}</p>
                    <div className="flex justify-between mt-1 text-[11px]">
                      <span>
                        <span className="text-muted-foreground">O:</span>{" "}
                        <span className="text-ice font-mono font-bold">
                          {(probs.over * 100).toFixed(0)}
                        </span>
                      </span>
                      <span>
                        <span className="text-muted-foreground">U:</span>{" "}
                        <span className="text-aurora font-mono font-bold">
                          {(probs.under * 100).toFixed(0)}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Likely scores */}
          {prediction.mostLikelyScores.length > 0 && (
            <div className="glass-card rounded-xl p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                {labels.likelyScores}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {prediction.mostLikelyScores.slice(0, 10).map((s, i) => (
                  <div
                    key={i}
                    className="bg-accent/30 rounded-lg p-3 text-center"
                  >
                    <p className="text-lg font-display font-black font-mono text-ice">
                      {s.home}-{s.away}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {(s.probability * 100).toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Markets Tab */}
      {activeTab === "markets" && (
        <div className="space-y-3">
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-ice" />
              <h3 className="text-sm font-semibold">{labels.filters}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {labels.minOdds}: <span className="font-mono font-bold text-ice">{minOdds.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min={1.01}
                  max={5}
                  step={0.05}
                  value={minOdds}
                  onChange={(e) => setMinOdds(parseFloat(e.target.value))}
                  className="w-full mt-1 accent-ice"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {labels.minProb}: <span className="font-mono font-bold text-aurora">{minProb}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={minProb}
                  onChange={(e) => setMinProb(parseInt(e.target.value))}
                  className="w-full mt-1 accent-aurora"
                />
              </div>
            </div>
          </div>

          {filteredMarketRows.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-muted-foreground text-sm">{labels.marketsEmpty}</p>
            </div>
          ) : (
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 text-muted-foreground">
                      <th className="text-left px-3 py-2 uppercase text-[10px] tracking-wider font-semibold">
                        {labels.market}
                      </th>
                      <th className="text-left px-3 py-2 uppercase text-[10px] tracking-wider font-semibold">
                        {labels.selection}
                      </th>
                      <th className="text-right px-3 py-2 uppercase text-[10px] tracking-wider font-semibold">
                        {labels.oddsCol}
                      </th>
                      <th className="text-right px-3 py-2 uppercase text-[10px] tracking-wider font-semibold">
                        {labels.trueProb}
                      </th>
                      <th className="text-right px-3 py-2 uppercase text-[10px] tracking-wider font-semibold">
                        {labels.edge}
                      </th>
                      <th className="text-right px-3 py-2 uppercase text-[10px] tracking-wider font-semibold">
                        {labels.rating}
                      </th>
                      <th className="text-right px-3 py-2 uppercase text-[10px] tracking-wider font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMarketRows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/10 hover:bg-accent/20 transition-colors"
                      >
                        <td className="px-3 py-2">
                          <p className="font-semibold text-foreground">{row.iddaaName}</p>
                          <p className="text-[10px] text-muted-foreground">{row.market}</p>
                        </td>
                        <td className="px-3 py-2 font-medium">{row.selection}</td>
                        <td className="text-right px-3 py-2 font-mono font-bold text-ice">
                          {row.odds.toFixed(2)}
                        </td>
                        <td className="text-right px-3 py-2 font-mono font-bold text-aurora">
                          {row.trueProb.toFixed(1)}%
                        </td>
                        <td
                          className={`text-right px-3 py-2 font-mono font-bold ${
                            row.edge > 0 ? "text-aurora" : "text-destructive"
                          }`}
                        >
                          {row.edge > 0 ? "+" : ""}
                          {row.edge.toFixed(1)}%
                        </td>
                        <td className="text-right px-3 py-2">
                          <RatingBadge rating={row.rating} labels={labels} />
                        </td>
                        <td className="text-right px-3 py-2">
                          <button
                            onClick={() => saveSingleBet(row)}
                            className="text-[10px] px-2 py-1 rounded-md bg-ice/20 text-ice border border-ice/40 hover:bg-ice/30 font-semibold"
                          >
                            {labels.save}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Odds Tab */}
      {activeTab === "odds" && (
        <div className="space-y-3">
          {!odds || odds.bookmakers.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-muted-foreground text-sm">{labels.noOdds}</p>
            </div>
          ) : (
            odds.bookmakers.slice(0, 5).map((bm) => (
              <div key={bm.id} className="glass-card rounded-xl p-4">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-ice" />
                  {bm.name}
                </h3>
                <div className="grid gap-3">
                  {bm.bets.slice(0, 8).map((bet) => (
                    <div key={bet.id} className="bg-accent/20 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
                        {plugin.config.marketNameMapping[bet.name] || bet.name}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {bet.values.slice(0, 12).map((v, i) => (
                          <div
                            key={i}
                            className="bg-background/50 px-3 py-1.5 rounded-md border border-border/30 text-xs"
                          >
                            <span className="text-muted-foreground mr-1">{v.value}</span>
                            <span className="font-mono font-bold text-ice">
                              {v.odd.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* H2H Tab */}
      {activeTab === "h2h" && (
        <div className="space-y-4">
          {h2h.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-muted-foreground text-sm">{labels.h2hEmpty}</p>
            </div>
          ) : (
            <>
              <H2HSummary
                games={h2h}
                homeTeamId={game.teams.home.id}
                labels={labels}
              />
              <div className="glass-card rounded-xl p-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                  {labels.h2hLast}
                </p>
                <div className="space-y-2">
                  {h2h.slice(0, 10).map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-2 bg-accent/20 rounded-lg text-xs"
                    >
                      <span className="text-muted-foreground font-mono">
                        {new Date(m.date).toLocaleDateString(
                          locale === "tr" ? "tr-TR" : locale === "sv" ? "sv-SE" : "en-GB"
                        )}
                      </span>
                      <span className="font-semibold flex-1 text-center">
                        {m.teams.home.name} {m.scores.home ?? "-"} : {m.scores.away ?? "-"}{" "}
                        {m.teams.away.name}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {m.league.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProbRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono font-bold ${color}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-accent/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            color === "text-ice"
              ? "bg-ice"
              : color === "text-aurora"
              ? "bg-aurora"
              : color === "text-warning"
              ? "bg-warning"
              : "bg-primary"
          }`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function RatingBadge({
  rating,
  labels,
}: {
  rating: "excellent" | "good" | "moderate" | "low";
  labels: any;
}) {
  const config = {
    excellent: { label: labels.excellent, cls: "bg-aurora/20 text-aurora border-aurora/40" },
    good: { label: labels.good, cls: "bg-ice/20 text-ice border-ice/40" },
    moderate: { label: labels.moderate, cls: "bg-warning/20 text-warning border-warning/40" },
    low: { label: labels.low, cls: "bg-muted/20 text-muted-foreground border-muted/40" },
  }[rating];
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${config.cls}`}
    >
      <Star className="w-2.5 h-2.5 inline mr-0.5" />
      {config.label}
    </span>
  );
}

function H2HSummary({
  games,
  homeTeamId,
  labels,
}: {
  games: NormalizedGame[];
  homeTeamId: number;
  labels: any;
}) {
  let hw = 0;
  let d = 0;
  let aw = 0;
  games.forEach((m) => {
    if (m.scores.home === null || m.scores.away === null) return;
    const homeIsA = m.teams.home.id === homeTeamId;
    const aScore = homeIsA ? m.scores.home : m.scores.away;
    const bScore = homeIsA ? m.scores.away : m.scores.home;
    if (aScore > bScore) hw++;
    else if (aScore < bScore) aw++;
    else d++;
  });
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="glass-card rounded-xl p-4 text-center border border-ice/20">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {labels.homeWins}
        </p>
        <p className="text-2xl font-display font-black text-ice font-mono">{hw}</p>
      </div>
      <div className="glass-card rounded-xl p-4 text-center border border-warning/20">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {labels.draws}
        </p>
        <p className="text-2xl font-display font-black text-warning font-mono">{d}</p>
      </div>
      <div className="glass-card rounded-xl p-4 text-center border border-aurora/20">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {labels.awayWins}
        </p>
        <p className="text-2xl font-display font-black text-aurora font-mono">{aw}</p>
      </div>
    </div>
  );
}
