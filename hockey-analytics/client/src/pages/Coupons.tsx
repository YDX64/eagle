/**
 * Coupons Page - Kupon Stratejileri & Bahis Önerileri
 * Arctic Futurism Theme - AWA Stats
 * i18n destekli - Türkçe, İsveççe, İngilizce
 * Günlük maçlardan otomatik value bet tespiti ve kupon oluşturma
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import {
  getGames,
  getOdds,
  getStandings,
  getTeamStatistics,
  getH2H,
  getTodayDate,
  isUpcomingGame,
  isLiveGame,
  isFinishedGame,
  type Game,
  type OddsResponse,
} from "@/lib/api";
import {
  predictMatch,
  detectValueBets,
  generateCouponStrategies,
  type ValueBet,
  type CouponStrategy,
  type MatchPrediction,
} from "@/lib/analysis";
import {
  saveCoupon,
  getSavedCoupons,
  evaluateStandaloneBet,
  type SavedBet,
} from "@/lib/couponStore";
import { toast } from "sonner";
import {
  Loader2,
  Ticket,
  Zap,
  Shield,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  Star,
  Target,
  DollarSign,
  Save,
  CheckCircle2,
  XCircle,
  History,
  BookmarkPlus,
} from "lucide-react";

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/hero-banner-cAvoYmzafSTHSonnd88HXv.webp";

interface GameAnalysis {
  game: Game;
  prediction: MatchPrediction;
  valueBets: ValueBet[];
  odds: OddsResponse | null;
}

// Sonuç badge bileşeni
function ResultBadge({ result }: { result: 'won' | 'lost' | 'void' | 'pending' }) {
  const { t } = useLocale();
  if (result === 'pending') return null;
  const config = {
    won: { label: t('result_won'), icon: CheckCircle2, cls: 'bg-aurora/20 text-aurora border-aurora/40' },
    lost: { label: t('result_lost'), icon: XCircle, cls: 'bg-destructive/20 text-destructive border-destructive/40' },
    void: { label: t('result_void'), icon: AlertTriangle, cls: 'bg-muted/20 text-muted-foreground border-muted/40' },
  };
  const c = config[result];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.cls}`}>
      <Icon className="w-3 h-3" />{c.label}
    </span>
  );
}

function RiskBadge({ risk }: { risk: 'very-low' | 'low' | 'medium' | 'high' }) {
  const { t } = useLocale();
  const config = {
    'very-low': { label: t('risk_very_low'), cls: 'bg-aurora/20 text-aurora border-aurora/40' },
    'low': { label: t('risk_low'), cls: 'bg-ice/20 text-ice border-ice/40' },
    'medium': { label: t('risk_medium'), cls: 'bg-warning/20 text-warning border-warning/40' },
    'high': { label: t('risk_high'), cls: 'bg-destructive/20 text-destructive border-destructive/40' },
  };
  const c = config[risk];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.cls}`}>
      <Shield className="w-3 h-3" />{c.label}
    </span>
  );
}

export default function Coupons() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [analyses, setAnalyses] = useState<GameAnalysis[]>([]);
  const [strategies, setStrategies] = useState<CouponStrategy[]>([]);
  const [savedCoupons, setSavedCoupons] = useState<string[]>([]);
  const [includeFinished, setIncludeFinished] = useState(false);

  useEffect(() => {
    const saved = getSavedCoupons();
    setSavedCoupons(saved.map(c => c.id));
  }, []);

  useEffect(() => {
    const analyzeGames = async () => {
      setLoading(true);
      setProgress(0);
      setProgressText(t('coupons_fetching'));

      try {
        const today = getTodayDate();
        const gamesRes = await getGames({ date: today });
        let games = gamesRes.response || [];

        if (includeFinished) {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];
          const yesterdayRes = await getGames({ date: yesterdayStr });
          games = [...games, ...(yesterdayRes.response || [])];
        }

        const upcomingGames = games.filter(g => isUpcomingGame(g.status) || isLiveGame(g.status) || (includeFinished && isFinishedGame(g.status)));
        const total = upcomingGames.length;

        setProgressText(t('coupons_analyzing'));
        const newAnalyses: GameAnalysis[] = [];

        for (let i = 0; i < upcomingGames.length; i++) {
          const game = upcomingGames[i];
          setProgress(Math.round((i / total) * 50));

          try {
            const [oddsRes, homeStatsRes, awayStatsRes, h2hRes, standingsRes] = await Promise.all([
              getOdds({ game: game.id }).catch(() => ({ response: [null] })),
              getTeamStatistics({ season: game.league.season, team: game.teams.home.id, league: game.league.id }).catch(() => ({})),
              getTeamStatistics({ season: game.league.season, team: game.teams.away.id, league: game.league.id }).catch(() => ({})),
              getH2H({ h2h: `${game.teams.home.id}-${game.teams.away.id}` }).catch(() => ({ response: [] })),
              getStandings({ league: game.league.id, season: game.league.season }).catch(() => ({ response: [[]] })),
            ]);

            const odds = oddsRes.response?.[0] || null;
            const homeStats = homeStatsRes as any;
            const awayStats = awayStatsRes as any;
            const h2hGames = h2hRes.response || [];
            const standings = (standingsRes.response || [[]])[0] || [];

            const homeStanding = standings.find((s: any) => s.team.id === game.teams.home.id) || null;
            const awayStanding = standings.find((s: any) => s.team.id === game.teams.away.id) || null;

            const prediction = predictMatch(homeStats, awayStats, h2hGames, homeStanding, awayStanding);
            const valueBets = odds ? detectValueBets(prediction, odds) : [];

            newAnalyses.push({ game, prediction, valueBets, odds });
          } catch (err) {
            console.error(`Error analyzing game ${game.id}:`, err);
          }
        }

        setAnalyses(newAnalyses);
        setProgress(50);
        setProgressText(t('coupons_creating'));

        const strats = generateCouponStrategies(newAnalyses.map(a => ({ gameId: a.game.id, homeTeam: a.game.teams.home.name, awayTeam: a.game.teams.away.name, valueBets: a.valueBets })));
        setStrategies(strats);
        setProgress(100);
      } catch (err) {
        console.error("Error fetching games:", err);
      } finally {
        setLoading(false);
      }
    };

    analyzeGames();
  }, [includeFinished, t]);

  const handleSaveCoupon = (strategy: CouponStrategy) => {
    const couponId = `coupon-${Date.now()}`;
    const bets: SavedBet[] = strategy.bets.map(b => {
      const game = analyses.find(a => a.game.id === b.gameId)?.game;
      return {
        gameId: b.gameId,
        homeTeam: game?.teams.home.name || '',
        awayTeam: game?.teams.away.name || '',
        betType: b.betType,
        selection: b.selection,
        odds: b.odds,
        trueProbability: b.trueProbability,
        edge: b.edge,
        confidence: b.confidence,
      };
    });

    saveCoupon({
      name: strategy.name,
      totalOdds: strategy.totalOdds,
      stake: strategy.suggestedStake,
      potentialReturn: strategy.potentialReturn,
      riskLevel: strategy.riskLevel,
      strategyName: strategy.name,
      bets,
    });

    setSavedCoupons([...savedCoupons, couponId]);
    toast.success(`${t('coupons_save')} ${strategy.name}`);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="relative rounded-xl overflow-hidden p-8 sm:p-12" style={{ backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center" }}>
          <div className="absolute inset-0 bg-background/85 backdrop-blur-sm" />
          <div className="relative z-10">
            <h1 className="font-display text-3xl sm:text-4xl font-black neon-text mb-2">{t('coupons_title')}</h1>
            <p className="text-sm text-muted-foreground">{t('coupons_subtitle')}</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-8">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-ice" />
            <div className="text-center">
              <p className="font-semibold text-foreground">{t('coupons_analyzing')}</p>
              <p className="text-xs text-muted-foreground mt-1">{progressText}</p>
              <div className="w-48 h-2 bg-accent rounded-full overflow-hidden mt-3">
                <div className="h-full bg-ice rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative rounded-xl overflow-hidden p-8 sm:p-12" style={{ backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="absolute inset-0 bg-background/85 backdrop-blur-sm" />
        <div className="relative z-10">
          <h1 className="font-display text-3xl sm:text-4xl font-black neon-text mb-2">{t('coupons_title')}</h1>
          <p className="text-sm text-muted-foreground mb-4">{t('coupons_subtitle')}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/coupon-history" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-aurora/20 text-aurora border border-aurora/40 hover:bg-aurora/30 transition-colors">
              <History className="w-3.5 h-3.5" /> {t('nav_coupon_history')}
            </Link>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={includeFinished} onChange={(e) => setIncludeFinished(e.target.checked)} className="rounded border-border" />
              {t('coupons_analysis')}
            </label>
          </div>
        </div>
      </div>

      {/* Strategies */}
      {strategies.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-2" />
          <p className="font-semibold">{t('coupons_no_strategy')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('coupons_no_strategy_desc')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2">
            <Ticket className="w-5 h-5" /> {t('coupons_recommended')}
          </h2>

          {strategies.map((strategy, idx) => {
            const strategyId = `coupon-${strategy.name}-${idx}`;
            const isSaved = savedCoupons.includes(strategyId);
            const allBets = analyses.flatMap(a => a.valueBets);
            const strategyBets = strategy.bets;
            const wonCount = strategyBets.filter(b => {
              const game = analyses.find(a => a.game.id === b.gameId)?.game;
              return game && evaluateStandaloneBet(b.betType, b.selection, game) === 'won';
            }).length;
            const lostCount = strategyBets.filter(b => {
              const game = analyses.find(a => a.game.id === b.gameId)?.game;
              return game && evaluateStandaloneBet(b.betType, b.selection, game) === 'lost';
            }).length;

            return (
              <div key={idx} className="glass-card rounded-xl p-5 border border-ice/20">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <h3 className="font-display text-base font-bold neon-text">{strategy.name}</h3>
                      <RiskBadge risk={strategy.riskLevel === 'very-high' ? 'high' : strategy.riskLevel} />
                      {isSaved && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-aurora/40 text-aurora bg-aurora/10 font-bold flex items-center gap-1">
                          <BookmarkPlus className="w-3 h-3" /> {t('common_save')}ed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{strategyBets.length} {t('coupons_bets')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-display font-black neon-green">{strategy.totalOdds.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">{t('coupons_total_odds')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 pb-4 border-b border-border/30">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('coupons_expected_prob')}</p>
                    <p className="text-sm font-mono font-bold text-ice">{(strategy.expectedProbability * 100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('coupons_expected_value')}</p>
                    <p className={`text-sm font-mono font-bold ${strategy.expectedValue > 0 ? 'text-aurora' : 'text-destructive'}`}>
                      {strategy.expectedValue > 0 ? '+' : ''}{(strategy.expectedValue * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('coupons_suggested_stake')}</p>
                    <p className="text-sm font-mono font-bold text-foreground">{strategy.suggestedStake.toFixed(0)} {t('coupons_unit')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('coupons_potential_return')}</p>
                    <p className="text-sm font-mono font-bold neon-green">{(strategy.suggestedStake * strategy.totalOdds).toFixed(0)} {t('coupons_unit')}</p>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  {strategyBets.map((bet, i) => {
                    const game = analyses.find(a => a.game.id === bet.gameId)?.game;
                    const betResult = game ? evaluateStandaloneBet(bet.betType, bet.selection, game) : 'pending';
                    return (
                      <div key={i} className={`flex items-center justify-between text-xs p-2 rounded-lg ${
                        betResult === 'won' ? 'bg-aurora/10 border border-aurora/30' :
                        betResult === 'lost' ? 'bg-destructive/10 border border-destructive/30 opacity-70' :
                        'bg-accent/30'
                      }`}>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{game?.teams.home.name} {t('common_vs')} {game?.teams.away.name}</p>
                          <p className="text-muted-foreground">{bet.betType}: {bet.selection}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-ice">{bet.odds.toFixed(2)}</span>
                          {betResult !== 'pending' && <ResultBadge result={betResult} />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button onClick={() => {
                  handleSaveCoupon(strategy);
                  setSavedCoupons([...savedCoupons, strategyId]);
                }}
                  className={`w-full py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    isSaved ? "bg-aurora/20 text-aurora border border-aurora/40" : "bg-ice text-background hover:bg-ice/90"
                  }`}>
                  <Save className="w-4 h-4" />
                  {isSaved ? t('common_save') + 'ed' : t('coupons_save')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* By Game */}
      {analyses.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-bold tracking-wider neon-text flex items-center gap-2">
            <Target className="w-5 h-5" /> {t('coupons_by_game')}
          </h2>

          {analyses.map((analysis) => {
            if (analysis.valueBets.length === 0) return null;
            return (
              <div key={analysis.game.id} className="glass-card rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{analysis.game.teams.home.name} {t('common_vs')} {analysis.game.teams.away.name}</h3>
                    <p className="text-xs text-muted-foreground">{analysis.game.league.name}</p>
                  </div>
                  <Link href={`/match/${analysis.game.id}`} className="text-ice hover:text-aurora transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>

                <div className="space-y-2">
                  {analysis.valueBets.slice(0, 5).map((vb, i) => {
                    const betResult = evaluateStandaloneBet(vb.betType, vb.selection, analysis.game);
                    return (
                      <div key={i} className={`flex items-center justify-between text-xs p-2 rounded-lg ${
                        betResult === 'won' ? 'bg-aurora/10 border border-aurora/30' :
                        betResult === 'lost' ? 'bg-destructive/10 border border-destructive/30 opacity-70' :
                        'bg-accent/30'
                      }`}>
                        <div className="flex-1">
                          <p className="font-semibold">{vb.betType}: {vb.selection}</p>
                          <p className="text-muted-foreground">{vb.bookmaker}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-ice">{vb.odds.toFixed(2)}</span>
                          <span className="text-aurora font-bold">+{vb.edge.toFixed(1)}%</span>
                          {betResult !== 'pending' && <ResultBadge result={betResult} />}
                        </div>
                      </div>
                    );
                  })}
                  {analysis.valueBets.length > 5 && (
                    <p className="text-xs text-center text-muted-foreground py-1">+{analysis.valueBets.length - 5} {t('player_more')}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div className="glass-card rounded-xl p-4 border border-warning/30 bg-warning/5">
        <h4 className="text-sm font-semibold text-warning flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4" /> {t('coupons_disclaimer_title')}
        </h4>
        <p className="text-xs text-muted-foreground">{t('coupons_disclaimer')}</p>
      </div>
    </div>
  );
}
