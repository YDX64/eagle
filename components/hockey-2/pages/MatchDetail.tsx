/**
 * Match Detail Page - Detaylı Maç Analizi / Match Analysis / Matchanalys
 * Arctic Futurism Theme - AWA Stats
 * i18n destekli - Türkçe, İsveççe, İngilizce
 */
import { useState, useEffect } from "react";
import Link from 'next/link';
import { useParams } from 'next/navigation';;
import { useLocale } from "@/components/hockey-2/contexts/LocaleContext";
import {
  getGameById,
  getOdds,
  getH2H,
  getGameEvents,
  getStandings,
  getTeamStatistics,
  formatTime,
  formatDate,
  getGameStatusText,
  isLiveGame,
  isFinishedGame,
  type Game,
  type OddsResponse,
  type GameEvent,
  type Standing,
  type TeamStatistics,
} from "@/lib/hockey-2/api";
import {
  predictMatch,
  detectValueBets,
  compareOdds,
  analyzeH2H,
  type MatchPrediction,
  type ValueBet,
  type OddsComparison,
  type H2HAnalysis,
} from "@/lib/hockey-2/analysis";
import { evaluateStandaloneBet } from "@/lib/hockey-2/couponStore";
import {
  analyzePlayerProps,
  findSmartBets,
  evaluatePlayerPropResult,
  type PlayerPropPrediction,
  type SmartBet,
} from "@/lib/hockey-2/playerAnalysis";
import {
  ArrowLeft, Loader2, TrendingUp, Target, BarChart3, Zap,
  Shield, Clock, AlertTriangle, ChevronDown, ChevronUp, Star,
  CheckCircle2, XCircle, User, Crosshair, Flame, Award,
} from "lucide-react";

const ANALYTICS_BG = "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/analytics-bg-mDbgemfkwrBjNES7wCAb5c.webp";

export default function MatchDetail() {
  const { t, locale } = useLocale();
  const params = useParams<{ id: string }>();
  const gameId = parseInt(params.id || "0");

  const [game, setGame] = useState<Game | null>(null);
  const [odds, setOdds] = useState<OddsResponse | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [h2hGames, setH2hGames] = useState<Game[]>([]);
  const [homeStats, setHomeStats] = useState<TeamStatistics | null>(null);
  const [awayStats, setAwayStats] = useState<TeamStatistics | null>(null);
  const [homeStanding, setHomeStanding] = useState<Standing | null>(null);
  const [awayStanding, setAwayStanding] = useState<Standing | null>(null);
  const [prediction, setPrediction] = useState<MatchPrediction | null>(null);
  const [valueBets, setValueBets] = useState<ValueBet[]>([]);
  const [oddsComparison, setOddsComparison] = useState<OddsComparison[]>([]);
  const [h2hAnalysis, setH2hAnalysis] = useState<H2HAnalysis | null>(null);
  const [playerPredictions, setPlayerPredictions] = useState<PlayerPropPrediction[]>([]);
  const [smartBets, setSmartBets] = useState<SmartBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("analysis");

  useEffect(() => {
    if (!gameId) return;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const gameRes = await getGameById(gameId);
        const g = gameRes.response?.[0];
        if (!g) return;
        setGame(g);

        const promises: Promise<any>[] = [];
        promises.push(getOdds({ game: gameId }).then((r) => { const o = r.response?.[0] || null; setOdds(o); return o; }).catch(() => null));
        promises.push(getGameEvents(gameId).then((r) => { setEvents(r.response || []); return r.response || []; }).catch(() => []));
        const h2hKey = `${g.teams.home.id}-${g.teams.away.id}`;
        promises.push(getH2H({ h2h: h2hKey }).then((r) => { const games = r.response || []; setH2hGames(games); if (games.length > 0) setH2hAnalysis(analyzeH2H(games, g.teams.home.id)); return games; }).catch(() => []));
        promises.push(getStandings({ league: g.league.id, season: g.league.season }).then((r) => { const all = (r.response || []).flat(); const hs = all.find((s: Standing) => s.team.id === g.teams.home.id) || null; const as_ = all.find((s: Standing) => s.team.id === g.teams.away.id) || null; setHomeStanding(hs); setAwayStanding(as_); return { hs, as_ }; }).catch(() => ({ hs: null, as_: null })));
        promises.push(getTeamStatistics({ season: g.league.season, team: g.teams.home.id, league: g.league.id }).then((r) => { setHomeStats(r.response as any); return r.response; }).catch(() => null));
        promises.push(getTeamStatistics({ season: g.league.season, team: g.teams.away.id, league: g.league.id }).then((r) => { setAwayStats(r.response as any); return r.response; }).catch(() => null));

        const results = await Promise.all(promises);
        const oddsData = results[0];
        const eventsData = results[1] || [];
        const h2hData = results[2];
        const standingsData = results[3];
        const homeStatsData = results[4];
        const awayStatsData = results[5];

        const pred = predictMatch(homeStatsData, awayStatsData, h2hData || [], standingsData?.hs || null, standingsData?.as_ || null);
        setPrediction(pred);

        if (oddsData) {
          const vb = detectValueBets(pred, oddsData);
          setValueBets(vb);
          setOddsComparison(compareOdds(oddsData.bookmakers || []));
          const pp = analyzePlayerProps(oddsData, pred, g, eventsData);
          setPlayerPredictions(pp);
          const sb = findSmartBets(pred, oddsData, g);
          setSmartBets(sb);
        }
      } catch (err) {
        console.error("Match detail error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [gameId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-600 dark:text-cyan-400" />
        <span className="ml-3 text-muted-foreground">{t('match_analyzing')}</span>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">{t('match_not_found')}</p>
        <Link href="/hockey-2" className="text-cyan-600 dark:text-cyan-400 hover:underline mt-2 inline-block">{t('match_back')}</Link>
      </div>
    );
  }

  const live = isLiveGame(game.status);
  const finished = isFinishedGame(game.status);
  const lowRiskBets = smartBets.filter(b => b.riskScore <= 35);
  const highValueBets = smartBets.filter(b => b.edge > 8 && b.odds >= 2.0);

  const tabs = [
    { id: "analysis", label: t('match_tab_analysis'), icon: BarChart3 },
    { id: "smartbets", label: `${t('match_tab_smart_bets')} (${lowRiskBets.length})`, icon: Crosshair },
    { id: "valuebets", label: `${t('match_tab_value_bets')} (${valueBets.length})`, icon: Zap },
    ...(playerPredictions.length > 0 ? [{ id: "playerprops", label: `${t('match_tab_player_props')} (${playerPredictions.length})`, icon: User }] : []),
    { id: "odds", label: t('match_tab_odds'), icon: TrendingUp },
    { id: "h2h", label: t('match_tab_h2h'), icon: Shield },
    { id: "events", label: t('match_tab_events'), icon: Clock },
  ];

  return (
    <div className="space-y-6">
      <Link href="/hockey-2" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> {t('match_back')}
      </Link>

      {/* Match Header */}
      <div className="relative rounded-xl overflow-hidden p-6 sm:p-8" style={{ backgroundImage: `url(${ANALYTICS_BG})`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <img src={game.league.logo} alt="" className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            {game.country.flag && <img src={game.country.flag} alt="" className="w-4 h-3" />}
            <span className="text-xs text-muted-foreground">{game.country.name} / {game.league.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{formatDate(game.date)} - {formatTime(game.date)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 text-center sm:text-right">
              <img src={game.teams.home.logo} alt="" className="w-14 h-14 sm:w-20 sm:h-20 object-contain mx-auto sm:ml-auto sm:mr-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <h2 className="font-bold text-base sm:text-xl font-bold mt-2">{game.teams.home.name}</h2>
              {homeStanding && (
                <p className="text-xs text-muted-foreground mt-1">
                  #{homeStanding.position} - {homeStanding.points} {t('standings_points')} - {t('standings_form')}: <span className="font-mono">{homeStanding.form}</span>
                </p>
              )}
            </div>

            <div className="text-center px-4 sm:px-8">
              {live && <span className="text-xs font-bold text-destructive animate-pulse block mb-1">{getGameStatusText(game.status)} {game.timer && `${game.timer}'`}</span>}
              {finished && <span className="text-xs text-muted-foreground block mb-1">{t('match_finished')}</span>}
              <div className="flex items-center gap-3">
                <span className={`font-bold text-4xl sm:text-5xl font-black ${live ? "text-cyan-600 dark:text-cyan-400 font-bold" : ""}`}>{game.scores.home ?? "-"}</span>
                <span className="text-2xl text-muted-foreground">:</span>
                <span className={`font-bold text-4xl sm:text-5xl font-black ${live ? "text-cyan-600 dark:text-cyan-400 font-bold" : ""}`}>{game.scores.away ?? "-"}</span>
              </div>
              <div className="flex gap-2 justify-center mt-2 text-[10px] text-muted-foreground font-mono">
                {game.periods.first && <span>P1: {game.periods.first}</span>}
                {game.periods.second && <span>P2: {game.periods.second}</span>}
                {game.periods.third && <span>P3: {game.periods.third}</span>}
                {game.periods.overtime && <span>OT: {game.periods.overtime}</span>}
                {game.periods.penalties && <span>PEN: {game.periods.penalties}</span>}
              </div>
            </div>

            <div className="flex-1 text-center sm:text-left">
              <img src={game.teams.away.logo} alt="" className="w-14 h-14 sm:w-20 sm:h-20 object-contain mx-auto sm:mr-auto sm:ml-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <h2 className="font-bold text-base sm:text-xl font-bold mt-2">{game.teams.away.name}</h2>
              {awayStanding && (
                <p className="text-xs text-muted-foreground mt-1">
                  #{awayStanding.position} - {awayStanding.points} {t('standings_points')} - {t('standings_form')}: <span className="font-mono">{awayStanding.form}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id ? "bg-card border border-border rounded-xl backdrop-blur-sm border-cyan-500/40 shadow-sm text-cyan-600 dark:text-cyan-400" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
              }`}>
              <Icon className="w-3.5 h-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "analysis" && prediction && <AnalysisTab prediction={prediction} game={game} homeStats={homeStats} awayStats={awayStats} finished={finished} />}
      {activeTab === "smartbets" && <SmartBetsTab smartBets={smartBets} lowRiskBets={lowRiskBets} highValueBets={highValueBets} game={game} finished={finished} />}
      {activeTab === "valuebets" && <ValueBetsTab valueBets={valueBets} prediction={prediction} game={game} finished={finished} />}
      {activeTab === "playerprops" && <PlayerPropsTab predictions={playerPredictions} game={game} events={events} finished={finished} />}
      {activeTab === "odds" && <OddsTab oddsComparison={oddsComparison} odds={odds} game={game} finished={finished} />}
      {activeTab === "h2h" && <H2HTab h2h={h2hAnalysis} h2hGames={h2hGames} />}
      {activeTab === "events" && <EventsTab events={events} />}
    </div>
  );
}

function ResultBadge({ result }: { result: 'won' | 'lost' | 'void' | 'pending' }) {
  const { t } = useLocale();
  if (result === 'pending') return null;
  const config = {
    won: { label: t('result_won'), icon: CheckCircle2, cls: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40' },
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
    'very-low': { label: t('risk_very_low'), cls: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40' },
    'low': { label: t('risk_low'), cls: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-500/40' },
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

function AnalysisTab({ prediction, game, homeStats, awayStats, finished }: { prediction: MatchPrediction; game: Game; homeStats: TeamStatistics | null; awayStats: TeamStatistics | null; finished: boolean }) {
  const { t } = useLocale();
  const homeGoals = game.scores.home ?? 0;
  const awayGoals = game.scores.away ?? 0;
  const totalGoals = homeGoals + awayGoals;

  const getWinnerResult = () => {
    if (!finished) return null;
    const maxProb = Math.max(prediction.homeWinProb, prediction.drawProb, prediction.awayWinProb);
    const predicted = maxProb === prediction.homeWinProb ? 'home' : maxProb === prediction.awayWinProb ? 'away' : 'draw';
    const actual = homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw';
    return predicted === actual ? 'won' : 'lost';
  };

  const getOUResult = (line: number, predictedOver: number) => {
    if (!finished) return null;
    const predictedSide = predictedOver > 50 ? 'over' : 'under';
    const actual = totalGoals > line ? 'over' : 'under';
    return predictedSide === actual ? 'won' : 'lost';
  };

  const getBttsResult = () => {
    if (!finished) return null;
    const predictedYes = prediction.btts.yes > 50;
    const actual = homeGoals > 0 && awayGoals > 0;
    return predictedYes === actual ? 'won' : 'lost';
  };

  const getScoreResult = () => {
    if (!finished || prediction.mostLikelyScores.length === 0) return null;
    const top = prediction.mostLikelyScores[0];
    return top.homeGoals === homeGoals && top.awayGoals === awayGoals ? 'won' : 'lost';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Win Probability */}
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm font-bold tracking-wider text-cyan-600 dark:text-cyan-400 font-bold flex items-center gap-2">
            <Target className="w-4 h-4" /> {t('analysis_win_prob')}
          </h3>
          {finished && <ResultBadge result={getWinnerResult() as any} />}
        </div>
        <div className="space-y-3">
          <ProbBar label={game.teams.home.name} value={prediction.homeWinProb} color="bg-cyan-500" isWinner={finished && homeGoals > awayGoals} />
          <ProbBar label={t('analysis_draw')} value={prediction.drawProb} color="bg-warning" isWinner={finished && homeGoals === awayGoals} />
          <ProbBar label={game.teams.away.name} value={prediction.awayWinProb} color="bg-emerald-500" isWinner={finished && awayGoals > homeGoals} />
        </div>
        {finished && (
          <div className="mt-3 pt-3 border-t border-border/30 text-xs text-muted-foreground">
            {t('analysis_actual_result')}: <span className="font-mono font-bold text-foreground">{homeGoals} - {awayGoals}</span>
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="w-3.5 h-3.5" />
            {t('analysis_confidence')}: <span className="font-bold text-cyan-600 dark:text-cyan-400 font-mono">{prediction.confidence.toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* Expected Goals */}
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
        <h3 className="font-bold text-sm font-bold tracking-wider mb-4 text-cyan-600 dark:text-cyan-400 font-bold flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> {t('analysis_expected_goals')}
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-3xl font-bold font-black text-cyan-600 dark:text-cyan-400 font-bold">{prediction.expectedHomeGoals.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('analysis_home')}</p>
            {finished && <p className="text-xs font-mono font-bold text-foreground mt-1">{t('analysis_actual')}: {homeGoals}</p>}
          </div>
          <div>
            <p className="text-3xl font-bold font-black text-warning">{prediction.expectedTotalGoals.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('analysis_total')}</p>
            {finished && <p className="text-xs font-mono font-bold text-foreground mt-1">{t('analysis_actual')}: {totalGoals}</p>}
          </div>
          <div>
            <p className="text-3xl font-bold font-black text-emerald-600 dark:text-emerald-400 font-bold">{prediction.expectedAwayGoals.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('analysis_away')}</p>
            {finished && <p className="text-xs font-mono font-bold text-foreground mt-1">{t('analysis_actual')}: {awayGoals}</p>}
          </div>
        </div>
      </div>

      {/* Over/Under */}
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
        <h3 className="font-bold text-sm font-bold tracking-wider mb-4 text-cyan-600 dark:text-cyan-400 font-bold flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> {t('analysis_over_under')}
        </h3>
        <div className="space-y-2">
          <OURow label="2.5" over={prediction.overUnder25.over} under={prediction.overUnder25.under} result={getOUResult(2.5, prediction.overUnder25.over)} actualTotal={finished ? totalGoals : undefined} />
          <OURow label="3.5" over={prediction.overUnder35.over} under={prediction.overUnder35.under} result={getOUResult(3.5, prediction.overUnder35.over)} actualTotal={finished ? totalGoals : undefined} />
          <OURow label="4.5" over={prediction.overUnder45.over} under={prediction.overUnder45.under} result={getOUResult(4.5, prediction.overUnder45.over)} actualTotal={finished ? totalGoals : undefined} />
          <OURow label="5.5" over={prediction.overUnder55.over} under={prediction.overUnder55.under} result={getOUResult(5.5, prediction.overUnder55.over)} actualTotal={finished ? totalGoals : undefined} />
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{t('analysis_btts_yes')}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{prediction.btts.yes.toFixed(1)}%</span>
              {finished && <ResultBadge result={getBttsResult() as any} />}
            </div>
          </div>
          {finished && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('analysis_actual')}: {homeGoals > 0 && awayGoals > 0 ? t('analysis_btts_yes') : t('analysis_btts_no')} ({homeGoals}-{awayGoals})
            </p>
          )}
        </div>
      </div>

      {/* Most Likely Scores */}
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm font-bold tracking-wider text-cyan-600 dark:text-cyan-400 font-bold flex items-center gap-2">
            <Star className="w-4 h-4" /> {t('analysis_likely_scores')}
          </h3>
          {finished && <ResultBadge result={getScoreResult() as any} />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {prediction.mostLikelyScores.slice(0, 8).map((s, i) => {
            const isActual = finished && s.homeGoals === homeGoals && s.awayGoals === awayGoals;
            return (
              <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                isActual ? "bg-emerald-500/20 border-2 border-emerald-500/60 ring-1 ring-aurora/30" :
                i === 0 ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-accent/30"
              }`}>
                <span className={`font-mono font-bold text-sm ${isActual ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{s.homeGoals}-{s.awayGoals}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-mono ${isActual ? 'text-emerald-600 dark:text-emerald-400 font-bold' : i === 0 ? "text-cyan-600 dark:text-cyan-400 font-bold" : "text-muted-foreground"}`}>
                    {(s.probability * 100).toFixed(1)}%
                  </span>
                  {isActual && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                </div>
              </div>
            );
          })}
        </div>
        {finished && !prediction.mostLikelyScores.slice(0, 8).some(s => s.homeGoals === homeGoals && s.awayGoals === awayGoals) && (
          <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/30">
            {t('analysis_actual_result')}: <span className="font-mono font-bold text-foreground">{homeGoals}-{awayGoals}</span>
          </p>
        )}
      </div>

      {/* Team Stats Comparison */}
      {(homeStats || awayStats) && (
        <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5 lg:col-span-2">
          <h3 className="font-bold text-sm font-bold tracking-wider mb-4 text-cyan-600 dark:text-cyan-400 font-bold flex items-center gap-2">
            <Shield className="w-4 h-4" /> {t('analysis_team_stats')}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2">{t('stat_played')}</th>
                  <th className="text-center py-2 px-2">{game.teams.home.name}</th>
                  <th className="text-center py-2 px-2">{game.teams.away.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {homeStats && awayStats && (
                  <>
                    <StatsRow label={t('stat_played')} home={homeStats.games?.played?.all} away={awayStats.games?.played?.all} />
                    <StatsRow label={t('stat_wins')} home={homeStats.games?.wins?.all?.total} away={awayStats.games?.wins?.all?.total} highlight />
                    <StatsRow label={t('stat_losses')} home={homeStats.games?.loses?.all?.total} away={awayStats.games?.loses?.all?.total} reverse />
                    <StatsRow label={t('stat_goals_scored')} home={homeStats.goals?.for?.total?.all} away={awayStats.goals?.for?.total?.all} highlight />
                    <StatsRow label={t('stat_goals_conceded')} home={homeStats.goals?.against?.total?.all} away={awayStats.goals?.against?.total?.all} reverse />
                    <StatsRow label={t('stat_goals_avg_scored')} home={homeStats.goals?.for?.average?.all} away={awayStats.goals?.for?.average?.all} highlight />
                    <StatsRow label={t('stat_goals_avg_conceded')} home={homeStats.goals?.against?.average?.all} away={awayStats.goals?.against?.average?.all} reverse />
                    <StatsRow label={t('stat_home_wins')} home={homeStats.games?.wins?.home?.total} away={awayStats.games?.wins?.away?.total} highlight />
                    <StatsRow label={t('stat_win_pct')} home={homeStats.games?.wins?.all?.percentage} away={awayStats.games?.wins?.all?.percentage} highlight />
                  </>
                )}
                <tr className="border-t border-border">
                  <td className="py-2 px-2 text-muted-foreground">{t('analysis_form_score')}</td>
                  <td className={`text-center py-2 px-2 font-bold ${prediction.homeForm > prediction.awayForm ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{prediction.homeForm.toFixed(0)}</td>
                  <td className={`text-center py-2 px-2 font-bold ${prediction.awayForm > prediction.homeForm ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{prediction.awayForm.toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SmartBetsTab({ smartBets, lowRiskBets, highValueBets, game, finished }: { smartBets: SmartBet[]; lowRiskBets: SmartBet[]; highValueBets: SmartBet[]; game: Game; finished: boolean }) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<'all' | 'low-risk' | 'high-value' | 'positive-edge'>('low-risk');

  const filtered = filter === 'low-risk' ? lowRiskBets
    : filter === 'high-value' ? highValueBets
    : filter === 'positive-edge' ? smartBets.filter(b => b.edge > 0)
    : smartBets;

  const wonCount = finished ? filtered.filter(b => evaluateStandaloneBet(b.betType, b.selection, game) === 'won').length : 0;
  const lostCount = finished ? filtered.filter(b => evaluateStandaloneBet(b.betType, b.selection, game) === 'lost').length : 0;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5 border border-cyan-500/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Crosshair className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm font-bold text-cyan-600 dark:text-cyan-400 font-bold">{t('smart_title')}</h3>
            <p className="text-xs text-muted-foreground">{t('smart_subtitle')}</p>
          </div>
          {finished && (
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{wonCount} {t('common_won')}</span>
              <span className="text-destructive font-mono font-bold">{lostCount} {t('common_lost')}</span>
              <span className="text-muted-foreground font-mono">%{filtered.length > 0 ? ((wonCount / filtered.length) * 100).toFixed(0) : 0}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('smart_description')}</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'low-risk' as const, label: `${t('smart_low_risk')} (${lowRiskBets.length})`, icon: Shield },
          { id: 'high-value' as const, label: `${t('smart_high_value')} (${highValueBets.length})`, icon: Flame },
          { id: 'positive-edge' as const, label: `${t('smart_positive_edge')} (${smartBets.filter(b => b.edge > 0).length})`, icon: TrendingUp },
          { id: 'all' as const, label: `${t('smart_all')} (${smartBets.length})`, icon: BarChart3 },
        ].map(f => {
          const Icon = f.icon;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === f.id ? "bg-card border border-border rounded-xl backdrop-blur-sm border-cyan-500/40 shadow-sm text-cyan-600 dark:text-cyan-400" : "text-muted-foreground hover:bg-accent/30"
              }`}>
              <Icon className="w-3 h-3" />{f.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-8 text-center">
          <p className="text-muted-foreground">{t('smart_no_bets')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((bet, i) => {
            const betResult = finished ? evaluateStandaloneBet(bet.betType, bet.selection, game) : 'pending';
            return (
              <div key={`${bet.betType}-${bet.selection}-${i}`} className={`bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-4 transition-all ${
                betResult === 'won' ? 'border border-emerald-500/40 bg-emerald-500/5' :
                betResult === 'lost' ? 'border border-destructive/30 bg-destructive/5 opacity-70' :
                bet.riskScore <= 20 ? 'border border-emerald-500/20' :
                bet.riskScore <= 35 ? 'border border-cyan-500/20' : ''
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <RiskBadge risk={bet.riskCategory} />
                      {bet.edge > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold">
                          +{bet.edge.toFixed(1)}% Edge
                        </span>
                      )}
                      {finished && <ResultBadge result={betResult} />}
                    </div>
                    <p className="text-sm font-semibold">{bet.betType}</p>
                    <p className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">{bet.selection}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{bet.reasoning}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{bet.bookmaker}</span>
                      {bet.tags.map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/50 text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-2xl font-bold font-black ${
                      betResult === 'won' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : betResult === 'lost' ? 'text-destructive' : 'text-cyan-600 dark:text-cyan-400'
                    }`}>{bet.odds.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">{t('common_odds')}</p>
                    <p className="text-xs font-mono mt-1">
                      <span className="text-emerald-600 dark:text-emerald-400">{bet.trueProbability.toFixed(0)}%</span>
                      <span className="text-muted-foreground"> {t('common_probability')}</span>
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlayerPropsTab({ predictions, game, events, finished }: { predictions: PlayerPropPrediction[]; game: Game; events: GameEvent[]; finished: boolean }) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<'all' | 'goal' | 'shot' | 'point' | 'assist'>('all');
  const [showPositiveOnly, setShowPositiveOnly] = useState(true);

  const filtered = predictions
    .filter(p => filter === 'all' || p.category === filter)
    .filter(p => !showPositiveOnly || p.edge > 0);

  const goalCount = predictions.filter(p => p.category === 'goal' && (!showPositiveOnly || p.edge > 0)).length;
  const shotCount = predictions.filter(p => p.category === 'shot' && (!showPositiveOnly || p.edge > 0)).length;
  const pointCount = predictions.filter(p => p.category === 'point' && (!showPositiveOnly || p.edge > 0)).length;
  const assistCount = predictions.filter(p => p.category === 'assist' && (!showPositiveOnly || p.edge > 0)).length;

  const wonCount = finished ? filtered.filter(p => evaluatePlayerPropResult(p.betType, p.selection, game, events) === 'won').length : 0;
  const lostCount = finished ? filtered.filter(p => evaluatePlayerPropResult(p.betType, p.selection, game, events) === 'lost').length : 0;

  const categoryIcons: Record<string, any> = {
    goal: Crosshair,
    shot: Target,
    point: Star,
    assist: Award,
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5 border border-emerald-500/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm font-bold text-emerald-600 dark:text-emerald-400 font-bold">{t('player_title')}</h3>
            <p className="text-xs text-muted-foreground">{predictions.length} {t('player_analyzed')}</p>
          </div>
          {finished && (
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{wonCount} {t('common_won')}</span>
              <span className="text-destructive font-mono font-bold">{lostCount} {t('common_lost')}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('player_description')}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {[
          { id: 'all' as const, label: `${t('player_all')} (${showPositiveOnly ? filtered.length : predictions.length})` },
          { id: 'goal' as const, label: `${t('player_goal')} (${goalCount})` },
          { id: 'shot' as const, label: `${t('player_shot')} (${shotCount})` },
          { id: 'point' as const, label: `${t('player_point')} (${pointCount})` },
          { id: 'assist' as const, label: `${t('player_assist')} (${assistCount})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.id ? "bg-card border border-border rounded-xl backdrop-blur-sm border-cyan-500/40 shadow-sm text-cyan-600 dark:text-cyan-400" : "text-muted-foreground hover:bg-accent/30"
            }`}>
            {f.label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto cursor-pointer">
          <input type="checkbox" checked={showPositiveOnly} onChange={(e) => setShowPositiveOnly(e.target.checked)}
            className="rounded border-border" />
          {t('player_positive_only')}
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-8 text-center">
          <p className="text-muted-foreground">{t('player_no_predictions')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 50).map((pred, i) => {
            const betResult = finished ? evaluatePlayerPropResult(pred.betType, pred.selection, game, events) : 'pending';
            const CatIcon = categoryIcons[pred.category] || User;
            return (
              <div key={`${pred.betType}-${pred.selection}-${i}`} className={`bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-3 transition-all ${
                betResult === 'won' ? 'border border-emerald-500/40 bg-emerald-500/5' :
                betResult === 'lost' ? 'border border-destructive/30 bg-destructive/5 opacity-70' :
                pred.edge > 15 ? 'border border-emerald-500/20' : ''
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    pred.category === 'goal' ? 'bg-emerald-500/20' :
                    pred.category === 'shot' ? 'bg-cyan-500/20' :
                    pred.category === 'point' ? 'bg-warning/20' : 'bg-muted/20'
                  }`}>
                    <CatIcon className={`w-4 h-4 ${
                      pred.category === 'goal' ? 'text-emerald-600 dark:text-emerald-400' :
                      pred.category === 'shot' ? 'text-cyan-600 dark:text-cyan-400' :
                      pred.category === 'point' ? 'text-warning' : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{pred.playerName}</span>
                      <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-accent/50">{pred.teamName}</span>
                      {pred.edge > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold">
                          +{pred.edge.toFixed(1)}%
                        </span>
                      )}
                      <RiskBadge risk={pred.riskLevel === 'low' ? 'low' : pred.riskLevel === 'medium' ? 'medium' : 'high'} />
                      {finished && <ResultBadge result={betResult} />}
                    </div>
                    <p className="text-xs text-cyan-600 dark:text-cyan-400 mt-0.5">{pred.betType}: {pred.selection}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{pred.reasoning}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xl font-bold font-black ${
                      betResult === 'won' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : betResult === 'lost' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
                    }`}>{pred.odds.toFixed(2)}</p>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      <p>{t('player_estimated')}: <span className="text-cyan-600 dark:text-cyan-400 font-mono">{pred.estimatedProb.toFixed(0)}%</span></p>
                      <p>{t('player_confidence_label')}: <span className="font-mono">{pred.confidence}%</span></p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length > 50 && (
            <p className="text-xs text-center text-muted-foreground py-2">
              +{filtered.length - 50} {t('player_more')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ValueBetsTab({ valueBets, prediction, game, finished }: { valueBets: ValueBet[]; prediction: MatchPrediction | null; game: Game; finished: boolean }) {
  const { t } = useLocale();

  if (valueBets.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-2" />
        <p className="text-muted-foreground">{t('value_no_bets')}</p>
      </div>
    );
  }

  const ratingColors = {
    excellent: "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    good: "border-cyan-500 text-cyan-600 dark:text-cyan-400 bg-cyan-500/10",
    moderate: "border-warning text-warning bg-warning/10",
    low: "border-muted-foreground text-muted-foreground bg-muted/10",
  };
  const ratingLabels = { excellent: t('rating_excellent'), good: t('rating_good'), moderate: t('rating_moderate'), low: t('rating_low') };

  const wonCount = finished ? valueBets.filter(vb => evaluateStandaloneBet(vb.betType, vb.selection, game) === 'won').length : 0;
  const lostCount = finished ? valueBets.filter(vb => evaluateStandaloneBet(vb.betType, vb.selection, game) === 'lost').length : 0;

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-4 border border-emerald-500/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 font-bold">
            <Zap className="w-4 h-4" />
            {valueBets.length} {t('value_detected')}
          </div>
          {finished && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{wonCount} {t('common_won')}</span>
              <span className="text-destructive font-mono font-bold">{lostCount} {t('common_lost')}</span>
              <span className="text-muted-foreground font-mono">%{valueBets.length > 0 ? ((wonCount / valueBets.length) * 100).toFixed(0) : 0} {t('common_success')}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{t('value_description')}</p>
      </div>

      {valueBets.map((vb, i) => {
        const betResult = finished ? evaluateStandaloneBet(vb.betType, vb.selection, game) : 'pending';
        return (
          <div key={i} className={`bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-4 ${
            betResult === 'won' ? 'border border-emerald-500/40 bg-emerald-500/5' :
            betResult === 'lost' ? 'border border-destructive/30 bg-destructive/5 opacity-70' :
            vb.rating === 'excellent' ? 'ring-2 ring-emerald-500/30 border border-emerald-500/40' : ''
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${ratingColors[vb.rating]}`}>
                    {ratingLabels[vb.rating]}
                  </span>
                  <span className="text-xs text-muted-foreground">{vb.bookmaker}</span>
                  {finished && <ResultBadge result={betResult} />}
                </div>
                <p className="text-sm font-semibold mt-1">{vb.betType}: <span className="text-cyan-600 dark:text-cyan-400">{vb.selection}</span></p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-2xl font-bold font-black ${betResult === 'won' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : betResult === 'lost' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400 font-bold'}`}>{vb.odds.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">{t('common_odds')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-border/30">
              <MiniStat label={t('value_true_prob')} value={`${vb.trueProbability.toFixed(1)}%`} />
              <MiniStat label={t('value_implied_prob')} value={`${vb.impliedProb.toFixed(1)}%`} />
              <MiniStat label={t('value_edge')} value={`+${vb.edge.toFixed(1)}%`} highlight />
              <MiniStat label={t('value_kelly')} value={`${vb.kellyStake.toFixed(1)}%`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OddsTab({ oddsComparison, odds, game, finished }: { oddsComparison: OddsComparison[]; odds: OddsResponse | null; game: Game; finished: boolean }) {
  const { t } = useLocale();
  const [expandedBet, setExpandedBet] = useState<string | null>(null);

  if (!odds || oddsComparison.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-8 text-center">
        <p className="text-muted-foreground">{t('odds_no_odds')}</p>
      </div>
    );
  }

  const priorityBets = ['3Way Result', 'Home/Away', 'Over/Under', 'Both Teams To Score', 'Double Chance', 'Handicap Result', 'Asian Handicap', 'Correct Score'];
  const sorted = [...oddsComparison].sort((a, b) => {
    const aIdx = priorityBets.indexOf(a.betType);
    const bIdx = priorityBets.indexOf(b.betType);
    if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    return a.betType.localeCompare(b.betType);
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <span>{odds.bookmakers.length} {t('odds_bookmakers')}</span>
        <span>|</span>
        <span>{oddsComparison.length} {t('odds_bet_types')}</span>
        {finished && <span className="text-emerald-600 dark:text-emerald-400 font-bold ml-2">{t('odds_results_showing')}</span>}
      </div>
      {sorted.map((comp) => (
        <div key={comp.betType} className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl overflow-hidden">
          <button onClick={() => setExpandedBet(expandedBet === comp.betType ? null : comp.betType)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors">
            <span className="text-sm font-semibold">{comp.betType}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{comp.selections.length} {t('odds_options')}</span>
              {expandedBet === comp.betType ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
          {expandedBet === comp.betType && (
            <div className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-2">{t('odds_selection')}</th>
                      <th className="text-center py-2">{t('odds_best_odds')}</th>
                      <th className="text-center py-2">{t('odds_bookmaker')}</th>
                      <th className="text-center py-2">{t('odds_avg_odds')}</th>
                      {finished && <th className="text-center py-2">{t('odds_result')}</th>}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {comp.selections.map((sel) => {
                      const betResult = finished ? evaluateStandaloneBet(comp.betType, sel.value, game) : 'pending';
                      return (
                        <tr key={sel.value} className={`border-b border-border/30 ${betResult === 'won' ? 'bg-emerald-500/5' : betResult === 'lost' ? 'bg-destructive/5' : ''}`}>
                          <td className="py-2 font-medium text-foreground">{sel.value}</td>
                          <td className="text-center py-2 font-bold text-emerald-600 dark:text-emerald-400">{sel.bestOdds.toFixed(2)}</td>
                          <td className="text-center py-2 text-muted-foreground">{sel.bestBookmaker}</td>
                          <td className="text-center py-2 text-cyan-600 dark:text-cyan-400">{sel.avgOdds.toFixed(2)}</td>
                          {finished && <td className="text-center py-2"><ResultBadge result={betResult} /></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function H2HTab({ h2h, h2hGames }: { h2h: H2HAnalysis | null; h2hGames: Game[] }) {
  const { t } = useLocale();

  if (!h2h || h2h.totalGames === 0) {
    return (
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-8 text-center">
        <p className="text-muted-foreground">{t('h2h_no_data')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
        <h3 className="font-bold text-sm font-bold tracking-wider mb-4 text-cyan-600 dark:text-cyan-400 font-bold">
          {t('h2h_title')} ({h2h.totalGames} {t('h2h_matches')})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold font-black text-cyan-600 dark:text-cyan-400">{h2h.homeWins}</p>
            <p className="text-xs text-muted-foreground">{t('h2h_home_wins')}</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold font-black text-warning">{h2h.draws}</p>
            <p className="text-xs text-muted-foreground">{t('h2h_draws')}</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold font-black text-emerald-600 dark:text-emerald-400">{h2h.awayWins}</p>
            <p className="text-xs text-muted-foreground">{t('h2h_away_wins')}</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold font-black text-foreground">{h2h.avgTotalGoals.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">{t('h2h_avg_goals')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t border-border">
          <div className="text-center">
            <p className="text-lg font-mono font-bold text-emerald-600 dark:text-emerald-400">{(h2h.over25Rate * 100).toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground">{t('h2h_over25')}</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-mono font-bold text-cyan-600 dark:text-cyan-400">{(h2h.bttsRate * 100).toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground">{t('h2h_btts')}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
        <h3 className="font-bold text-sm font-bold tracking-wider mb-4 text-cyan-600 dark:text-cyan-400 font-bold">{t('h2h_recent')}</h3>
        <div className="space-y-2">
          {h2h.recentResults.map((r, i) => (
            <div key={i} className="flex items-center gap-3 text-xs py-2 border-b border-border/30 last:border-0">
              <span className="text-muted-foreground font-mono w-20 shrink-0">
                {new Date(r.date).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
              </span>
              <span className="flex-1 truncate">{r.homeTeam}</span>
              <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400 px-2">{r.score}</span>
              <span className="flex-1 truncate text-right">{r.awayTeam}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventsTab({ events }: { events: GameEvent[] }) {
  const { t } = useLocale();

  if (events.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-8 text-center">
        <p className="text-muted-foreground">{t('events_no_data')}</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl backdrop-blur-sm rounded-xl p-5">
      <h3 className="font-bold text-sm font-bold tracking-wider mb-4 text-cyan-600 dark:text-cyan-400 font-bold">{t('events_title')}</h3>
      <div className="space-y-3">
        {events.map((event, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <div className="w-12 text-center shrink-0">
              <span className="text-xs font-mono text-muted-foreground">{event.period}</span>
              <p className="text-sm font-bold font-mono text-cyan-600 dark:text-cyan-400">{event.minute}'</p>
            </div>
            <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${event.type === 'goal' ? 'bg-emerald-500' : event.type === 'penalty' ? 'bg-warning' : 'bg-muted-foreground'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <img src={event.team.logo} alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <span className="font-medium">{event.team.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${event.type === 'goal' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-warning/20 text-warning'}`}>
                  {event.type === 'goal' ? t('events_goal') : event.type === 'penalty' ? t('events_penalty') : event.type.toUpperCase()}
                </span>
              </div>
              {event.players.length > 0 && <p className="text-xs text-foreground mt-0.5">{event.players.join(", ")}</p>}
              {event.assists.length > 0 && <p className="text-xs text-muted-foreground">{t('events_assist')}: {event.assists.join(", ")}</p>}
              {event.comment && <p className="text-xs text-warning mt-0.5">{event.comment}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProbBar({ label, value, color, isWinner }: { label: string; value: number; color: string; isWinner?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className={`truncate mr-2 ${isWinner ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-muted-foreground'}`}>
          {label} {isWinner && <CheckCircle2 className="w-3 h-3 inline text-emerald-600 dark:text-emerald-400" />}
        </span>
        <span className="font-mono font-bold">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-accent rounded-full overflow-hidden">
        <div className={`h-full ${isWinner ? 'bg-emerald-500' : color} rounded-full transition-all duration-1000`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function OURow({ label, over, under, result, actualTotal }: { label: string; over: number; under: number; result?: 'won' | 'lost' | null; actualTotal?: number }) {
  const line = parseFloat(label);
  const isOver = actualTotal !== undefined ? actualTotal > line : undefined;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-8 text-muted-foreground font-mono">{label}</span>
      <div className="flex-1 h-5 bg-accent rounded-full overflow-hidden flex">
        <div className={`h-full ${isOver === true ? 'bg-emerald-500/80' : 'bg-emerald-500/60'} flex items-center justify-end pr-1 text-[10px] font-mono font-bold`} style={{ width: `${over}%` }}>
          {over > 15 && `${over.toFixed(0)}%`}
        </div>
        <div className={`h-full ${isOver === false ? 'bg-cyan-500/50' : 'bg-cyan-500/30'} flex items-center justify-start pl-1 text-[10px] font-mono`} style={{ width: `${under}%` }}>
          {under > 15 && `${under.toFixed(0)}%`}
        </div>
      </div>
      <div className="flex gap-1 items-center w-32 text-[10px]">
        <span className="text-emerald-600 dark:text-emerald-400 font-mono">Ü {over.toFixed(0)}%</span>
        <span className="text-muted-foreground font-mono">A {under.toFixed(0)}%</span>
        {result && <ResultBadge result={result} />}
      </div>
    </div>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-bold ${highlight ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>{value}</p>
    </div>
  );
}

function StatsRow({ label, home, away, highlight, reverse }: { label: string; home: any; away: any; highlight?: boolean; reverse?: boolean }) {
  const hVal = typeof home === 'string' ? parseFloat(home) : home;
  const aVal = typeof away === 'string' ? parseFloat(away) : away;
  const hBetter = reverse ? hVal < aVal : hVal > aVal;
  const aBetter = reverse ? aVal < hVal : aVal > hVal;
  return (
    <tr className="border-b border-border/30">
      <td className="py-1.5 px-2 text-muted-foreground">{label}</td>
      <td className={`text-center py-1.5 px-2 ${hBetter && highlight ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>{home ?? "-"}</td>
      <td className={`text-center py-1.5 px-2 ${aBetter && highlight ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}`}>{away ?? "-"}</td>
    </tr>
  );
}
