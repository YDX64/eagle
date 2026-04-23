'use client';

/**
 * ProBet Tab Component
 *
 * Renders the AwaStats Nexus prediction dashboard:
 *   - Top recommendations sorted by confidence
 *   - For each match: GoalFlux breakdown, NeuroStack breakdown, blended result
 *   - Top scores, BGS, BTTS, Over/Under
 *   - ChronoFold metrics (accuracy, log-loss, Brier score)
 *
 * Data source: GET /api/probet?date=...&limit=...
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { ProBetBacktest } from './probet-backtest';
import { ProBetTracking } from './probet-tracking';
import { ProBetMatchList } from './probet-match-list';
import {
  RefreshCw,
  Brain,
  TrendingUp,
  Target,
  Activity,
  BarChart3,
  Calendar,
  AlertCircle,
  Trophy,
  Sparkles,
  Calculator,
  Layers,
  Crosshair,
  History,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface PredictionComponent {
  homeWin: number;
  draw: number;
  awayWin: number;
}

type MarketCategoryKey =
  | 'MAÇ_SONUCU'
  | 'GOL_TOPLAMI'
  | 'KG'
  | 'TAKIM_TOPLAMI'
  | 'CLEAN_SHEET'
  | 'HANDIKAP'
  | 'YARI_SONUCU'
  | 'YARI_FULL'
  | 'YARILAR'
  | 'KORNER'
  | 'KART'
  | 'ILK_GOL'
  | 'TAM_SKOR';

interface MarketPick {
  market: string;
  marketLabel: string;
  pickLabel: string;
  category: MarketCategoryKey;
  probability: number;
  edge: number;
  scoreValue?: string;
  marketOdds?: number;
  expectedValue?: number;
}

interface PatternMatchUI {
  pattern: {
    id: string;
    name: string;
    category: string;
    description: string;
    prediction: string;
    predictionLabel: string;
    sourceHitRate: number;
    empiricalHitRate?: number;
    empiricalSampleSize?: number;
  };
  evidence: Array<{ market: string; oddsValue: number; satisfies: string }>;
  hitRate: number;
  sampleSize: number;
  isBanko: boolean;
}

interface SystemBetCandidateUI {
  market: string;
  pickLabel: string;
  category: string;
  modelProbability: number;
  marketOdds: number;
  expectedValue: number;
  kellyStake: number;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
}

interface SystemComboUI {
  legs: SystemBetCandidateUI[];
  totalOdds: number;
  combinedProbability: number;
  expectedValue: number;
  description: string;
}

interface ContextExtras {
  homeInjuredCount: number;
  awayInjuredCount: number;
  homeInjuredKeyPlayers: string[];
  awayInjuredKeyPlayers: string[];
  bookmakerHomeProb: number | null;
  bookmakerDrawProb: number | null;
  bookmakerAwayProb: number | null;
  bookmakerCount: number;
  apiPredictionWinner: 'HOME' | 'DRAW' | 'AWAY' | null;
  apiPredictionAdvice: string | null;
  apiPredictionPercentHome: number | null;
  apiPredictionPercentDraw: number | null;
  apiPredictionPercentAway: number | null;
  hasLineups: boolean;
  homeFormation: string | null;
  awayFormation: string | null;
  sources: { injuries: boolean; odds: boolean; predictions: boolean; lineups: boolean };
}

interface ValueBet {
  market: string;
  modelProb: number;
  marketProb: number;
  edge: number;
}

interface KnnMatch {
  sampleSize: number;
  bucketKey: string;
  indexUsed: string;
  reliable: boolean;
  historicalHomeWinRate: number;
  historicalDrawRate: number;
  historicalAwayWinRate: number;
  historicalOver25Rate: number;
  historicalBttsRate: number;
  historicalAvgGoals: number;
}

interface PredictionData {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  recommendedOutcome: 'HOME' | 'DRAW' | 'AWAY';
  confidence: number;
  bestPick: MarketPick;
  topPicks: MarketPick[];
  highConfidencePicks?: MarketPick[];
  allMarkets: Record<MarketCategoryKey, MarketPick[]>;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  over15Prob: number;
  over25Prob: number;
  over35Prob: number;
  under15Prob: number;
  under25Prob: number;
  under35Prob: number;
  bttsYesProb: number;
  bttsNoProb: number;
  topScores: Array<{ score: string; probability: number }>;
  components: {
    poissonXG: PredictionComponent & { lambdaHome: number; lambdaAway: number };
    ensemble: PredictionComponent & { modelWeights: Record<string, number> };
    blendWeights: { poisson: number; ensemble: number };
  };
  modelMetrics: {
    cvAccuracy: number;
    cvLogLoss: number;
    cvBrierScore: number;
    trainingSamples: number;
    foldsCompleted: number;
  };
  contextExtras?: ContextExtras;
  valueBets?: ValueBet[];
  knnMatch?: KnnMatch;
  patternMatches?: PatternMatchUI[];
  systemBetCandidates?: SystemBetCandidateUI[];
  systemCombos?: SystemComboUI[];
  _resolution?: MatchResolution;
}

interface MatchResolution {
  status: 'pending' | 'resolved' | 'unknown';
  actualHome?: number;
  actualAway?: number;
  actualHtHome?: number | null;
  actualHtAway?: number | null;
  bestPickHit?: boolean | null;
  picks?: Array<{
    market: string;
    marketLabel: string;
    pickLabel: string;
    probability: number;
    marketOdds?: number;
    hit: boolean | null;
    isBest: boolean;
  }>;
}

interface ProBetResponse {
  predictions: PredictionData[];
  failures: Array<{ fixtureId: number; reason: string }>;
  stats: {
    totalRequested: number;
    successCount: number;
    failureCount: number;
    date: string;
  };
}

const formatPct = (p: number) => `${(p * 100).toFixed(1)}%`;
const formatNum = (n: number, dp = 2) => n.toFixed(dp);

/**
 * Compact WIN/LOSS pill — shown on resolved matches next to each pick.
 * hit === true  → green KAZANDI
 * hit === false → red KAYBETTI
 * hit === null  → nothing (pending or unresolvable)
 */
function ResultPill({ hit, compact = false }: { hit: boolean | null | undefined; compact?: boolean }) {
  if (hit === null || hit === undefined) return null;
  if (compact) {
    return hit ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
    ) : (
      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
        hit
          ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
          : 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-500/40'
      }`}
    >
      {hit ? (
        <>
          <CheckCircle2 className="w-3 h-3" />
          Kazandı
        </>
      ) : (
        <>
          <XCircle className="w-3 h-3" />
          Kaybetti
        </>
      )}
    </span>
  );
}

/**
 * Compact "@ 1.85" badge showing live bookmaker odds for a pick.
 * Color shows EV: green = positive value, gray = no edge.
 */
function OddsBadge({ odds, ev }: { odds?: number; ev?: number }) {
  if (!odds || !Number.isFinite(odds)) return null;
  const isValue = ev !== undefined && ev > 0.05;
  const isHighValue = ev !== undefined && ev > 0.15;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
        isHighValue
          ? 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-400 text-emerald-700 dark:text-emerald-300 font-bold'
          : isValue
            ? 'bg-amber-100 dark:bg-amber-950/30 border-amber-300 text-amber-700 dark:text-amber-300 font-semibold'
            : 'bg-muted/50 border-muted-foreground/20 text-muted-foreground'
      }`}
      title={ev !== undefined ? `EV: ${ev > 0 ? '+' : ''}${(ev * 100).toFixed(0)}%` : 'Canlı oran'}
    >
      @ {odds.toFixed(2)}
      {isValue && <span className="text-[9px]">+{((ev ?? 0) * 100).toFixed(0)}%</span>}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = confidence * 100;
  let label = 'Düşük';
  let cls = 'bg-slate-500';
  if (pct >= 60) {
    label = 'Çok Yüksek';
    cls = 'bg-emerald-600';
  } else if (pct >= 40) {
    label = 'Yüksek';
    cls = 'bg-blue-600';
  } else if (pct >= 25) {
    label = 'Orta';
    cls = 'bg-amber-600';
  }
  return (
    <Badge className={`${cls} text-white text-xs`}>
      <Sparkles className="w-3 h-3 mr-1" />
      {label} ({pct.toFixed(0)}%)
    </Badge>
  );
}

function OutcomeBar({
  label,
  probability,
  color,
}: {
  label: string;
  probability: number;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{formatPct(probability)}</span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${Math.min(100, probability * 100)}%` }}
        />
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<MarketCategoryKey, string> = {
  MAÇ_SONUCU: 'Maç Sonucu (1X2 / DC / DNB)',
  GOL_TOPLAMI: 'Gol Toplamı (Üst/Alt)',
  KG: 'Karşılıklı Gol (KG)',
  TAKIM_TOPLAMI: 'Takım Bazlı Goller',
  CLEAN_SHEET: 'Gol Yememe / Win to Nil',
  HANDIKAP: 'Asian Handikap',
  YARI_SONUCU: 'İlk Yarı (İY 1X2, İY Üst/Alt)',
  YARI_FULL: 'İlk Yarı / Maç Sonu (İY/MS)',
  YARILAR: 'Her İki Yarı / Yüksek Yarı',
  KORNER: 'Korner (Üst/Alt)',
  KART: 'Kart (Üst/Alt)',
  ILK_GOL: 'İlk Gol',
  TAM_SKOR: 'Tam Skor',
};

const CATEGORY_ORDER: MarketCategoryKey[] = [
  'MAÇ_SONUCU',
  'GOL_TOPLAMI',
  'KG',
  'ILK_GOL',
  'TAKIM_TOPLAMI',
  'HANDIKAP',
  'CLEAN_SHEET',
  'YARI_SONUCU',
  'YARI_FULL',
  'YARILAR',
  'KORNER',
  'KART',
  'TAM_SKOR',
];

export function PredictionCard({ pred }: { pred: PredictionData }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showAllMarkets, setShowAllMarkets] = useState(false);

  const matchTime = new Date(pred.matchDate).toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Smart pick from the bestPick field (highest-confidence market across all markets).
  // Fallback to 1X2 if bestPick is missing (for older API responses).
  const bp = pred.bestPick;
  const smartPickLabel = bp?.pickLabel ?? '—';
  const smartPickProb = bp?.probability ?? pred.confidence;
  const smartPickMarket = bp?.marketLabel ?? 'MS';

  // Color based on market category
  const isGoalsMarket = bp?.market.includes('OVER') || bp?.market.includes('UNDER');
  const isBttsMarket = bp?.market.includes('BTTS');
  const isScoreMarket = bp?.market === 'CORRECT_SCORE';
  const cardBg = isScoreMarket
    ? 'from-fuchsia-50 to-purple-50 dark:from-fuchsia-950/30 dark:to-purple-950/30 border-fuchsia-200 dark:border-fuchsia-800'
    : isBttsMarket
      ? 'from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-950/30 border-cyan-200 dark:border-cyan-800'
      : isGoalsMarket
        ? 'from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-orange-200 dark:border-orange-800'
        : 'from-emerald-50 to-blue-50 dark:from-emerald-950/30 dark:to-blue-950/30 border-emerald-200 dark:border-emerald-800';
  const iconColor = isScoreMarket
    ? 'text-fuchsia-600'
    : isBttsMarket
      ? 'text-cyan-600'
      : isGoalsMarket
        ? 'text-orange-600'
        : 'text-emerald-600';
  const labelColor = isScoreMarket
    ? 'text-fuchsia-700 dark:text-fuchsia-400'
    : isBttsMarket
      ? 'text-cyan-700 dark:text-cyan-400'
      : isGoalsMarket
        ? 'text-orange-700 dark:text-orange-400'
        : 'text-emerald-700 dark:text-emerald-400';

  // Resolution data (if match is finished and we've resolved it)
  const resolution = pred._resolution;
  const isResolved = resolution?.status === 'resolved';
  const actualScore = isResolved && resolution?.actualHome !== undefined && resolution?.actualAway !== undefined
    ? `${resolution.actualHome}-${resolution.actualAway}`
    : null;
  const bestPickHit = resolution?.bestPickHit;
  // Compute hit/total for the picks we tracked
  const resolvedPicks = resolution?.picks?.filter((p) => p.hit !== null) ?? [];
  const hitCount = resolvedPicks.filter((p) => p.hit === true).length;
  const totalResolved = resolvedPicks.length;

  // Build a map of pickLabel → hit status for quick lookup inside the card
  const pickHitMap = new Map<string, boolean | null>();
  for (const rp of resolution?.picks ?? []) {
    pickHitMap.set(rp.market + '|' + rp.pickLabel, rp.hit);
  }

  return (
    <Card className={`overflow-hidden border-2 transition-colors ${isResolved
      ? bestPickHit === true
        ? 'border-emerald-500/60 hover:border-emerald-500/80'
        : bestPickHit === false
          ? 'border-rose-500/60 hover:border-rose-500/80'
          : 'border-slate-400/60 hover:border-slate-500/80'
      : 'hover:border-primary/40'
    }`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-3 h-3 text-amber-500 shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{pred.league}</span>
            </div>
            <CardTitle className="text-base font-bold leading-tight">
              {pred.homeTeam} <span className="text-muted-foreground text-xs">vs</span>{' '}
              {pred.awayTeam}
            </CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Calendar className="w-3 h-3" />
              {matchTime}
            </div>
          </div>
          <ConfidenceBadge confidence={smartPickProb} />
        </div>

        {/* === RESOLUTION BANNER (only when match is finished + tracked) === */}
        {isResolved && actualScore && (
          <div className={`mt-2 p-2 rounded-lg border-2 flex items-center justify-between gap-2 ${
            bestPickHit === true
              ? 'bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/40 dark:to-green-950/40 border-emerald-500/60'
              : bestPickHit === false
                ? 'bg-gradient-to-r from-rose-50 to-red-50 dark:from-rose-950/40 dark:to-red-950/40 border-rose-500/60'
                : 'bg-slate-50 dark:bg-slate-900/40 border-slate-400/60'
          }`}>
            <div className="flex items-center gap-2">
              {bestPickHit === true ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : bestPickHit === false ? (
                <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-slate-500 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Bitti · Gerçek Skor
                </div>
                <div className="font-mono font-bold text-lg leading-none">
                  {actualScore}
                </div>
              </div>
            </div>
            {totalResolved > 0 && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Tahmin Başarımı
                </div>
                <div className={`font-bold text-lg leading-none ${
                  hitCount / totalResolved >= 0.5 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                }`}>
                  {hitCount}/{totalResolved}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {formatPct(hitCount / totalResolved)}
                </div>
              </div>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* SMART PICK banner — adapts color to market type */}
        <div className={`p-3 rounded-lg bg-gradient-to-r ${cardBg} border`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <Target className={`w-4 h-4 ${iconColor}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${labelColor}`}>
                En Yüksek Olasılıklı: {smartPickMarket}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ResultPill hit={bestPickHit} />
              <OddsBadge odds={bp?.marketOdds} ev={bp?.expectedValue} />
              <span className={`text-xs font-mono font-bold ${labelColor}`}>
                {formatPct(smartPickProb)}
              </span>
            </div>
          </div>
          <div className="font-bold text-sm">{smartPickLabel}</div>
        </div>

        {/* Top picks alternatives */}
        {pred.topPicks && pred.topPicks.length > 1 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Diğer İyi Seçenekler
            </div>
            <div className="grid grid-cols-1 gap-1">
              {pred.topPicks.slice(1, 4).map((p, i) => {
                const hit = pickHitMap.get(p.market + '|' + p.pickLabel) ?? null;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between text-[11px] px-2 py-1 rounded border gap-2 ${
                      hit === true
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-400/50'
                        : hit === false
                          ? 'bg-rose-50/60 dark:bg-rose-950/30 border-rose-400/50'
                          : 'bg-muted/40'
                    }`}
                  >
                    <span className="text-muted-foreground shrink-0">{p.marketLabel}:</span>
                    <span className="font-medium flex-1 truncate">{p.pickLabel}</span>
                    <ResultPill hit={hit} compact />
                    <OddsBadge odds={p.marketOdds} ev={p.expectedValue} />
                    <span className="font-mono text-foreground shrink-0">{formatPct(p.probability)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Outcome probabilities */}
        <div className="space-y-2">
          <OutcomeBar label="1 (Ev sahibi)" probability={pred.homeWinProb} color="bg-emerald-500" />
          <OutcomeBar label="X (Beraberlik)" probability={pred.drawProb} color="bg-amber-500" />
          <OutcomeBar label="2 (Deplasman)" probability={pred.awayWinProb} color="bg-blue-500" />
        </div>

        {/* Goals predictions grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2 rounded bg-muted/50">
            <div className="text-muted-foreground mb-0.5 flex items-center gap-1">
              <Crosshair className="w-3 h-3" /> Beklenen Gol (xG)
            </div>
            <div className="font-bold">
              {formatNum(pred.expectedHomeGoals)} - {formatNum(pred.expectedAwayGoals)}
            </div>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <div className="text-muted-foreground mb-0.5">Toplam Gol</div>
            <div className="font-bold text-emerald-700 dark:text-emerald-400">
              {formatNum(pred.expectedHomeGoals + pred.expectedAwayGoals)}
            </div>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <div className="text-muted-foreground mb-0.5">Üst 2.5</div>
            <div className="font-bold">{formatPct(pred.over25Prob)}</div>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <div className="text-muted-foreground mb-0.5">KG Var</div>
            <div className="font-bold">{formatPct(pred.bttsYesProb)}</div>
          </div>
        </div>

        {/* Top scores */}
        <div>
          <div className="text-xs font-semibold mb-2 flex items-center gap-1">
            <BarChart3 className="w-3 h-3" /> En Olası Skorlar
          </div>
          <div className="grid grid-cols-5 gap-1">
            {pred.topScores.slice(0, 5).map((s) => {
              // Try to find live odds for this exact score in TAM_SKOR market
              const csPick = pred.allMarkets?.TAM_SKOR?.find(
                (p) => p.scoreValue === s.score
              );
              return (
                <div
                  key={s.score}
                  className="text-center p-1.5 rounded bg-muted/40 border text-xs"
                >
                  <div className="font-bold">{s.score}</div>
                  <div className="text-[10px] text-muted-foreground">{formatPct(s.probability)}</div>
                  {csPick?.marketOdds && (
                    <div className="text-[9px] font-mono text-violet-600 dark:text-violet-400 mt-0.5">
                      @{csPick.marketOdds.toFixed(1)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* === VALUE BETS (model probability > bookmaker implied probability) === */}
        {pred.valueBets && pred.valueBets.length > 0 && (
          <div className="rounded border-2 border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/20 p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1">
              💎 VALUE BETS (Model &gt; Piyasa)
            </div>
            {pred.valueBets.slice(0, 3).map((vb, i) => (
              <div key={i} className="text-[11px] flex items-center justify-between">
                <span className="font-medium">{vb.market}</span>
                <span className="text-muted-foreground font-mono">
                  Model {formatPct(vb.modelProb)} vs Piyasa {formatPct(vb.marketProb)}{' '}
                  <span className="text-emerald-600 font-bold">+{(vb.edge * 100).toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* === k-NN HISTORICAL LOOKUP — 700K Pinnacle matches === */}
        {pred.knnMatch && pred.knnMatch.reliable && (
          <div className="rounded border-2 border-indigo-400/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
              📚 HİSTORİK K-NN ({pred.knnMatch.sampleSize.toLocaleString()} benzer maç)
            </div>
            <div className="text-[11px] space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">1X2 Geçmiş:</span>
                <span className="font-mono">
                  {formatPct(pred.knnMatch.historicalHomeWinRate)} /{' '}
                  {formatPct(pred.knnMatch.historicalDrawRate)} /{' '}
                  {formatPct(pred.knnMatch.historicalAwayWinRate)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Over 2.5:</span>
                <span className="font-mono">{formatPct(pred.knnMatch.historicalOver25Rate)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">KG Var:</span>
                <span className="font-mono">{formatPct(pred.knnMatch.historicalBttsRate)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Ort. Gol:</span>
                <span className="font-mono">{pred.knnMatch.historicalAvgGoals.toFixed(2)}</span>
              </div>
              <div className="text-[9px] text-muted-foreground italic">
                Bucket: {pred.knnMatch.bucketKey} · Index: {pred.knnMatch.indexUsed}
              </div>
            </div>
          </div>
        )}

        {/* === HIGH-CONFIDENCE PICKS (weighted score >= 0.70) === */}
        {pred.highConfidencePicks && pred.highConfidencePicks.length > 0 && (
          <div className="rounded border-2 border-emerald-400/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              🏆 YÜKSEK GÜVENLİ TAHMİNLER ({pred.highConfidencePicks.length} adet, ağırlıklı skor ≥ 70%)
            </div>
            {pred.highConfidencePicks.slice(0, 12).map((pick, i) => {
              const hit = pickHitMap.get(pick.market + '|' + pick.pickLabel) ?? null;
              return (
                <div
                  key={i}
                  className={`text-[11px] flex items-center justify-between gap-2 px-1 rounded ${
                    hit === true
                      ? 'bg-emerald-100/50 dark:bg-emerald-950/40'
                      : hit === false
                        ? 'bg-rose-100/50 dark:bg-rose-950/30'
                        : ''
                  }`}
                >
                  <span className="text-muted-foreground shrink-0 w-16 text-left">{pick.marketLabel}:</span>
                  <span className="font-medium flex-1 truncate">{pick.pickLabel}</span>
                  <ResultPill hit={hit} compact />
                  <OddsBadge odds={pick.marketOdds} ev={pick.expectedValue} />
                  <span className={`font-mono font-bold shrink-0 ${
                    hit === false ? 'text-rose-700 dark:text-rose-400 line-through' : 'text-emerald-700 dark:text-emerald-400'
                  }`}>
                    {formatPct(pick.probability)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* === ORAN ANALİZİ: Pattern matches + filter açıklamaları === */}
        {pred.patternMatches && pred.patternMatches.length > 0 && (
          <div className="rounded-lg border-2 border-violet-400/60 bg-gradient-to-br from-violet-50/60 to-fuchsia-50/40 dark:from-violet-950/30 dark:to-fuchsia-950/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                🎯 ORAN ANALİZİ
                <span className="text-[10px] normal-case font-normal text-muted-foreground">
                  (Canlı oranlar üzerinden filtre eşleşmeleri)
                </span>
              </div>
              <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-700 dark:text-violet-300">
                {pred.patternMatches.length} filtre
              </Badge>
            </div>
            {pred.patternMatches.slice(0, 10).map((m, i) => (
              <div
                key={i}
                className={`p-2 rounded border-l-4 ${
                  m.isBanko
                    ? 'border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/25'
                    : 'border-l-violet-400 bg-violet-50/40 dark:bg-violet-950/15'
                }`}
              >
                <div className="flex items-start justify-between gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold flex items-center gap-1.5 text-[12px]">
                      {m.isBanko && <span className="text-emerald-600">🎯 BANKO</span>}
                      <span className={m.isBanko ? 'text-emerald-700 dark:text-emerald-300' : ''}>
                        {m.pattern.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-foreground/80 font-medium mt-0.5">
                      → {m.pattern.predictionLabel}
                    </div>
                    <div className="text-[9px] text-muted-foreground italic mt-0.5">
                      {m.pattern.description || m.pattern.category}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`font-mono font-bold text-base ${
                        m.isBanko ? 'text-emerald-700 dark:text-emerald-400' : 'text-violet-700 dark:text-violet-400'
                      }`}
                    >
                      {formatPct(m.hitRate)}
                    </div>
                    {m.sampleSize > 0 && (
                      <div className="text-[9px] text-muted-foreground">
                        {m.sampleSize.toLocaleString()} örnek
                      </div>
                    )}
                  </div>
                </div>
                {m.evidence.length > 0 && (
                  <div className="mt-1 text-[9px] text-muted-foreground font-mono bg-background/50 rounded px-1.5 py-0.5 border border-muted">
                    <span className="font-semibold text-violet-600 dark:text-violet-400">Eşleşen koşullar: </span>
                    {m.evidence.map((e) => e.satisfies).join(' · ')}
                  </div>
                )}
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground italic pt-1 border-t border-violet-300/30">
              🎯 BANKO = Pinnacle DB'de validate edilmiş (≥65% hit rate, ≥500 örnek).
              Pattern isabet oranı biten maçlarda "Canlı Tracking" sekmesinde ölçülüyor.
            </div>
          </div>
        )}

        {/* === PHASE 4: SÜRPRİZ ADAYLARI (System Bet Candidates) === */}
        {pred.systemBetCandidates && pred.systemBetCandidates.length > 0 && (
          <div className="rounded border-2 border-orange-400/60 bg-gradient-to-br from-orange-50/60 to-amber-50/40 dark:from-orange-950/30 dark:to-amber-950/20 p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-bold text-orange-700 dark:text-orange-300 flex items-center gap-1">
              🎲 SÜRPRİZ ADAYLARI (Sistem Kuponları İçin)
            </div>
            {pred.systemBetCandidates.slice(0, 6).map((cand, i) => {
              const riskColor =
                cand.riskLevel === 'low'
                  ? 'text-emerald-600'
                  : cand.riskLevel === 'medium'
                    ? 'text-amber-600'
                    : 'text-rose-600';
              return (
                <div
                  key={i}
                  className="p-1.5 rounded border bg-muted/30 text-[11px] space-y-0.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{cand.pickLabel}</div>
                      <div className="text-[9px] text-muted-foreground italic">{cand.reason}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 font-bold">
                        @ {cand.marketOdds.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[9px]">
                    <span className={`uppercase font-semibold ${riskColor}`}>
                      {cand.riskLevel === 'low' ? 'Düşük risk' : cand.riskLevel === 'medium' ? 'Orta risk' : 'Yüksek risk'}
                    </span>
                    <span className="text-emerald-600 font-bold font-mono">
                      EV +{(cand.expectedValue * 100).toFixed(0)}%
                    </span>
                    <span className="text-muted-foreground font-mono">
                      Kelly {(cand.kellyStake * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* === PHASE 4: ÖNERİLEN SİSTEM KOMBO === */}
        {pred.systemCombos && pred.systemCombos.length > 0 && (
          <div className="rounded border-2 border-pink-400/60 bg-gradient-to-br from-pink-50/60 to-rose-50/40 dark:from-pink-950/30 dark:to-rose-950/20 p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-bold text-pink-700 dark:text-pink-300 flex items-center gap-1">
              🎫 ÖNERİLEN SİSTEM KOMBO (Toplam Oran 3-39)
            </div>
            {pred.systemCombos.slice(0, 3).map((combo, i) => (
              <div key={i} className="p-2 rounded border bg-pink-50/30 dark:bg-pink-950/15 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="font-semibold text-pink-700 dark:text-pink-300">{combo.description}</div>
                  <div className="font-mono font-bold text-emerald-600 text-xs">
                    EV +{(combo.expectedValue * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="space-y-0.5 pl-2 border-l-2 border-pink-300/50">
                  {combo.legs.map((leg, j) => (
                    <div key={j} className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground truncate">{leg.pickLabel}</span>
                      <span className="font-mono text-pink-700 dark:text-pink-400 font-semibold shrink-0">
                        @ {leg.marketOdds.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px] pt-0.5 border-t border-pink-300/30">
                  <span className="text-muted-foreground">
                    Birleşik ihtimal: {(combo.combinedProbability * 100).toFixed(1)}%
                  </span>
                  <span className="font-mono font-bold text-pink-700 dark:text-pink-300">
                    Toplam @ {combo.totalOdds.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === CONTEXT EXTRAS — Injuries + API-Football consensus === */}
        {pred.contextExtras && (pred.contextExtras.sources.injuries || pred.contextExtras.sources.predictions) && (
          <div className="rounded border bg-muted/30 p-2 space-y-1.5 text-[11px]">
            {pred.contextExtras.sources.injuries &&
              (pred.contextExtras.homeInjuredCount + pred.contextExtras.awayInjuredCount > 0) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                    🏥 Sakatlıklar
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="font-semibold">{pred.homeTeam}:</span>{' '}
                      <span className="text-rose-600">{pred.contextExtras.homeInjuredCount}</span>
                    </div>
                    <div>
                      <span className="font-semibold">{pred.awayTeam}:</span>{' '}
                      <span className="text-rose-600">{pred.contextExtras.awayInjuredCount}</span>
                    </div>
                  </div>
                </div>
              )}
            {pred.contextExtras.sources.predictions && pred.contextExtras.apiPredictionAdvice && (
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                  🌐 AwaStats Konsensüs
                </div>
                <div className="italic">{pred.contextExtras.apiPredictionAdvice}</div>
                {pred.contextExtras.apiPredictionPercentHome !== null && (
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    1: {formatPct(pred.contextExtras.apiPredictionPercentHome)} |{' '}
                    X: {formatPct(pred.contextExtras.apiPredictionPercentDraw ?? 0)} |{' '}
                    2: {formatPct(pred.contextExtras.apiPredictionPercentAway ?? 0)}
                  </div>
                )}
              </div>
            )}
            {pred.contextExtras.sources.lineups && (pred.contextExtras.homeFormation || pred.contextExtras.awayFormation) && (
              <div className="text-[10px] text-muted-foreground">
                Diziliş: {pred.contextExtras.homeFormation ?? '?'} vs {pred.contextExtras.awayFormation ?? '?'}
              </div>
            )}
          </div>
        )}

        {/* === ALL MARKETS toggle === */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs h-7"
          onClick={() => setShowAllMarkets(!showAllMarkets)}
        >
          {showAllMarkets ? '🔼 Tüm Marketleri Gizle' : `🔽 Tüm Marketleri Göster (${Object.values(pred.allMarkets ?? {}).flat().length} adet)`}
        </Button>

        {showAllMarkets && pred.allMarkets && (
          <div className="space-y-3 text-xs border-t pt-3 max-h-[36rem] overflow-y-auto">
            {CATEGORY_ORDER.map((cat) => {
              const picks = pred.allMarkets[cat];
              if (!picks || picks.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-[10px] uppercase tracking-wider font-bold text-primary mb-1">
                    {CATEGORY_LABELS[cat]}
                  </div>
                  <div className="space-y-1">
                    {picks.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-muted/30 border-l-2 border-l-primary/30 gap-2"
                      >
                        <span className="flex-1 truncate">{p.pickLabel}</span>
                        <OddsBadge odds={p.marketOdds} ev={p.expectedValue} />
                        <span className={`font-mono shrink-0 ${p.probability > 0.7 ? 'text-emerald-600 font-bold' : p.probability > 0.5 ? 'text-blue-600' : 'text-foreground'}`}>
                          {formatPct(p.probability)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Toggleable model details */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs h-7"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? 'Detayları Gizle' : 'Model Detayları'}
        </Button>

        {showDetails && (
          <div className="space-y-3 text-xs border-t pt-3">
            {/* Model components */}
            <div>
              <div className="flex items-center gap-1 mb-2 font-semibold">
                <Calculator className="w-3 h-3" /> Poisson + xG (Temel Model)
              </div>
              <div className="space-y-1 pl-4">
                <div className="flex justify-between">
                  <span>Ev sahibi λ:</span>
                  <span className="font-mono">{formatNum(pred.components.poissonXG.lambdaHome)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Deplasman λ:</span>
                  <span className="font-mono">{formatNum(pred.components.poissonXG.lambdaAway)}</span>
                </div>
                <div className="flex justify-between">
                  <span>1/X/2:</span>
                  <span className="font-mono">
                    {formatPct(pred.components.poissonXG.homeWin)} /{' '}
                    {formatPct(pred.components.poissonXG.draw)} /{' '}
                    {formatPct(pred.components.poissonXG.awayWin)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-2 font-semibold">
                <Layers className="w-3 h-3" /> Gradient Boost Ensemble
              </div>
              <div className="space-y-1 pl-4">
                {Object.entries(pred.components.ensemble.modelWeights).map(([name, w]) => (
                  <div key={name} className="flex justify-between">
                    <span>{name}:</span>
                    <span className="font-mono">ağırlık {formatPct(w)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-1">
                  <span>1/X/2:</span>
                  <span className="font-mono">
                    {formatPct(pred.components.ensemble.homeWin)} /{' '}
                    {formatPct(pred.components.ensemble.draw)} /{' '}
                    {formatPct(pred.components.ensemble.awayWin)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-2 font-semibold">
                <Brain className="w-3 h-3" /> Karışım Ağırlıkları
              </div>
              <div className="space-y-1 pl-4">
                <div className="flex justify-between">
                  <span>Poisson:</span>
                  <span className="font-mono">{formatPct(pred.components.blendWeights.poisson)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Ensemble:</span>
                  <span className="font-mono">{formatPct(pred.components.blendWeights.ensemble)}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-2 font-semibold">
                <Activity className="w-3 h-3" /> Cross-Validation Metrikleri
              </div>
              <div className="space-y-1 pl-4">
                <div className="flex justify-between">
                  <span>Doğruluk:</span>
                  <span className="font-mono">{formatPct(pred.modelMetrics.cvAccuracy)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Log Loss:</span>
                  <span className="font-mono">{formatNum(pred.modelMetrics.cvLogLoss, 3)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Brier Score:</span>
                  <span className="font-mono">{formatNum(pred.modelMetrics.cvBrierScore, 3)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Eğitim örneği:</span>
                  <span className="font-mono">{pred.modelMetrics.trainingSamples}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tamamlanan fold:</span>
                  <span className="font-mono">{pred.modelMetrics.foldsCompleted}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type ProBetSubView = 'list' | 'predictions' | 'backtest' | 'tracking';

export function ProBetTab() {
  const [view, setView] = useState<ProBetSubView>('list');
  const [predictions, setPredictions] = useState<PredictionData[]>([]);
  const [failures, setFailures] = useState<Array<{ fixtureId: number; reason: string }>>([]);
  const [stats, setStats] = useState<ProBetResponse['stats'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [limit, setLimit] = useState(15);

  const fetchPredictions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        limit: limit.toString(),
        majorLeagues: 'true',
      });
      const res = await fetch(`/api/probet?${params}`);
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'ProBet API hatası');
      }
      const preds = (json.data.predictions || []) as PredictionData[];

      // ═════════════════════════════════════════════════════════════════
      // Fetch resolution data for all predictions in a single batch call.
      // This fires in parallel with rendering — if tracking DB is down,
      // UI still renders without resolution markers.
      // ═════════════════════════════════════════════════════════════════
      if (preds.length > 0) {
        try {
          const ids = preds.map((p) => p.fixtureId).join(',');
          const statusRes = await fetch(
            `/api/probet/match-status?sport=football&fixtureIds=${ids}`
          );
          if (statusRes.ok) {
            const statusJson = await statusRes.json();
            const statusMap = statusJson?.data ?? {};
            for (const p of preds) {
              const status = statusMap[String(p.fixtureId)] || statusMap[p.fixtureId];
              if (status && status.status !== 'unknown') {
                p._resolution = status as MatchResolution;
              }
            }
          }
        } catch {
          // Ignore — tracking DB might not be available yet
        }
      }

      setPredictions(preds);
      setFailures(json.data.failures || []);
      setStats(json.data.stats || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, limit]);

  useEffect(() => {
    fetchPredictions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* ProBet header — compact */}
      <div className="rounded-lg border border-primary/20 bg-gradient-to-r from-violet-50 via-blue-50 to-emerald-50 dark:from-violet-950/40 dark:via-blue-950/40 dark:to-emerald-950/40 px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold leading-tight">ProBet</h2>
              <p className="text-[11px] text-muted-foreground leading-tight">
                AwaStats Nexus · Çok katmanlı tahmin motoru
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-violet-500/50 text-violet-700 dark:text-violet-300 text-[11px]">
            <Sparkles className="w-3 h-3 mr-1" />
            Nexus Entegre
          </Badge>
        </div>

        {/* Sub-view toggle */}
        <div className="flex items-center gap-2 mt-3 p-1 bg-white/60 dark:bg-slate-800/40 rounded-lg w-fit flex-wrap">
          <Button
            variant={view === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('list')}
            className={`gap-2 ${view === 'list' ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white' : ''}`}
          >
            <Target className="w-4 h-4" />
            Tüm Maçlar Listesi
          </Button>
          <Button
            variant={view === 'predictions' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('predictions')}
            className={`gap-2 ${view === 'predictions' ? 'bg-gradient-to-r from-violet-500 to-blue-600 text-white' : ''}`}
          >
            <Brain className="w-4 h-4" />
            Top Tahminler
          </Button>
          <Button
            variant={view === 'backtest' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('backtest')}
            className={`gap-2 ${view === 'backtest' ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white' : ''}`}
          >
            <History className="w-4 h-4" />
            Backtest
          </Button>
          <Button
            variant={view === 'tracking' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('tracking')}
            className={`gap-2 ${view === 'tracking' ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white' : ''}`}
          >
            <Activity className="w-4 h-4" />
            Canlı Tracking
          </Button>
        </div>

        {/* Controls — only shown for predictions view */}
        {view === 'predictions' && (
        <div className="flex items-end gap-3 mt-4 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs font-medium">Tarih</label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Limit</label>
            <Input
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value || '15', 10))}
              className="w-24"
            />
          </div>
          <Button onClick={fetchPredictions} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Tahmin ediliyor...' : 'Yenile'}
          </Button>
        </div>
        )}

        {/* Stats summary */}
        {view === 'predictions' && stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div className="p-3 rounded-lg bg-white/70 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">Talep edilen</div>
              <div className="text-xl font-bold">{stats.totalRequested}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/70 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">Başarılı tahmin</div>
              <div className="text-xl font-bold text-emerald-600">{stats.successCount}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/70 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">Başarısız</div>
              <div className="text-xl font-bold text-amber-600">{stats.failureCount}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/70 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">Tarih</div>
              <div className="text-sm font-bold">{stats.date}</div>
            </div>
          </div>
        )}
      </div>

      {/* PREDICTIONS VIEW */}
      {view === 'predictions' && (
        <>
          {/* Loading state */}
          {loading && predictions.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <RefreshCw className="w-10 h-10 mx-auto mb-4 animate-spin text-primary" />
                <h3 className="font-semibold mb-1">ProBet motoru çalışıyor</h3>
                <p className="text-sm text-muted-foreground">
                  Lig başına NeuroStack Ensemble eğitiliyor — bu işlem ilk maç için ~5-15 saniye
                  sürebilir, sonraki maçlar cache'lenecek.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
              <CardContent className="py-6">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-semibold">Hata:</span>
                  <span className="text-sm">{error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {!loading && !error && predictions.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-1">Tahmin bulunamadı</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Seçilen tarih için ProBet ile tahmin edilebilecek maç yok ya da büyük ligler dışında
                  yetersiz veri var.
                </p>
                <Button onClick={fetchPredictions} variant="outline" size="sm">
                  Tekrar Dene
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Predictions grid */}
          {predictions.length > 0 && (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {predictions.map((p) => (
                <PredictionCard key={p.fixtureId} pred={p} />
              ))}
            </div>
          )}

          {/* Failures (collapsible) */}
          {failures.length > 0 && (
            <Card className="border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  Tahmin Edilemeyen Maçlar ({failures.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-xs space-y-1 text-muted-foreground">
                  {failures.slice(0, 10).map((f) => (
                    <li key={f.fixtureId}>
                      <span className="font-mono">#{f.fixtureId}</span> — {f.reason}
                    </li>
                  ))}
                  {failures.length > 10 && (
                    <li className="italic">...ve {failures.length - 10} maç daha</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* BACKTEST VIEW */}
      {view === 'backtest' && <ProBetBacktest />}

      {/* LIVE TRACKING VIEW — real-time backtest from tracking DB */}
      {view === 'tracking' && <ProBetTracking />}

      {/* MATCH LIST VIEW — pick any match from the day's full schedule */}
      {view === 'list' && (
        <ProBetMatchList
          renderPrediction={(fixtureId, prediction, isLoading) => {
            if (isLoading) {
              return (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ProBet motoru bu maç için çalışıyor — GoalFlux + BGS + NeuroStack + sakatlık + oran verisi çekiliyor (~5-15 sn)...
                </div>
              );
            }
            if (!prediction) {
              return (
                <div className="text-xs text-muted-foreground italic">
                  Bu maç için henüz tahmin yok. Maç açılıyor...
                </div>
              );
            }
            return <PredictionCard pred={prediction} />;
          }}
        />
      )}
    </div>
  );
}
