'use client';

/**
 * ProBet Backtest Component
 *
 * Provides a UI for running historical backtests of the ProBet engine.
 * Shows hit rate, Brier score, log loss, ROI per confidence threshold,
 * per-outcome accuracy, and sample match-level results.
 *
 * Data source: GET /api/probet/backtest?fromDate=...&toDate=...
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  RefreshCw,
  History,
  TrendingUp,
  TrendingDown,
  Target,
  AlertCircle,
  CheckCircle2,
  XCircle,
  BarChart3,
  Percent,
  DollarSign,
  Calendar,
  Trophy,
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  Crosshair,
  Sparkles,
} from 'lucide-react';

interface BacktestMatchResult {
  fixtureId: number;
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  actualResult: 'H' | 'D' | 'A';
  actualScore: string;
  predictedOutcome: 'H' | 'D' | 'A';
  predictedConfidence: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  hit: boolean;
  brierContribution: number;
  logLossContribution: number;
  poissonProbs: { H: number; D: number; A: number };
  ensembleProbs: { H: number; D: number; A: number };
}

interface ConfidenceBucket {
  threshold: number;
  count: number;
  hits: number;
  accuracy: number;
  roi: number;
}

interface LeagueBreakdown {
  leagueName: string;
  count: number;
  hits: number;
  accuracy: number;
  brierScore: number;
}

interface MarketStat {
  count: number;
  hits: number;
  accuracy: number;
}

interface MarketBreakdown {
  matchResult: MarketStat;
  over15: MarketStat;
  over25: MarketStat;
  over35: MarketStat;
  bttsCorrect: MarketStat;
  exactScoreTopPick: MarketStat;
  smartPick: MarketStat;
  clearFavorites: MarketStat;
  closeMatches: MarketStat;
  cornersOver85?: MarketStat;
  cornersOver95?: MarketStat;
  cornersOver105?: MarketStat;
  cardsOver35?: MarketStat;
  cardsOver45?: MarketStat;
  firstGoal?: MarketStat;
  // Phase 1B extensions
  htft?: MarketStat;
  htftSpecific?: Record<string, MarketStat>;
  exactScoreTop3?: MarketStat;
  exactScoreTop5?: MarketStat;
  matchResultByConfidence?: Record<string, MarketStat>;
}

interface StrengthInsights {
  bestLeague: string | null;
  worstLeague: string | null;
  bestMarket: string;
  bestConfidenceThreshold: number;
  highlights: string[];
  weaknesses: string[];
}

interface BacktestData {
  leaguesUsed: number[];
  fromDate: string;
  toDate: string;
  totalMatches: number;
  hits: number;
  hitRate: number;
  brierScore: number;
  logLoss: number;
  homeWinAccuracy: number;
  drawAccuracy: number;
  awayWinAccuracy: number;
  confidenceBuckets: ConfidenceBucket[];
  leagueBreakdowns: LeagueBreakdown[];
  marketBreakdowns: MarketBreakdown;
  insights: StrengthInsights;
  sampleResults: BacktestMatchResult[];
}

const formatPct = (p: number) => `${(p * 100).toFixed(1)}%`;
const formatNum = (n: number, dp = 3) => n.toFixed(dp);

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  color = 'text-foreground',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ResultRow({ m }: { m: BacktestMatchResult }) {
  const matchTime = new Date(m.date).toLocaleDateString('sv-SE', {
    day: '2-digit',
    month: '2-digit',
  });
  const resultLabel = (r: 'H' | 'D' | 'A') => (r === 'H' ? '1' : r === 'D' ? 'X' : '2');
  return (
    <div className="flex items-center gap-3 p-2 rounded border bg-muted/30 text-xs">
      {m.hit ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">
          {m.homeTeam} <span className="text-muted-foreground">vs</span> {m.awayTeam}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {m.league} · {matchTime}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono font-bold">{m.actualScore}</div>
        <div className="text-[10px] text-muted-foreground">
          Pred {resultLabel(m.predictedOutcome)} ({formatPct(m.predictedConfidence)})
        </div>
      </div>
    </div>
  );
}

export function ProBetBacktest() {
  // Default: last 90 days for the bigger walk-forward window, capped to 100 matches for speed
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [fromDate, setFromDate] = useState(ninetyDaysAgo.toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(today.toISOString().split('T')[0]);
  const [maxMatches, setMaxMatches] = useState(100);
  const [fastMode, setFastMode] = useState(false);
  const [includePreviousSeason, setIncludePreviousSeason] = useState(false);
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        fromDate,
        toDate,
        maxMatches: maxMatches.toString(),
        retrainEvery: '30',
        fastMode: fastMode ? 'true' : 'false',
        includePreviousSeason: includePreviousSeason ? 'true' : 'false',
      });
      const res = await fetch(`/api/probet/backtest?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Backtest hatası');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, maxMatches, fastMode, includePreviousSeason]);

  // Quick presets
  const presetBig = useCallback(() => {
    const t = new Date();
    const yearAgo = new Date(t);
    yearAgo.setDate(yearAgo.getDate() - 365);
    setFromDate(yearAgo.toISOString().split('T')[0]);
    setToDate(t.toISOString().split('T')[0]);
    setMaxMatches(1000);
    setFastMode(true); // 1000 matches in slow mode would take 30+ min
    setIncludePreviousSeason(true);
  }, []);

  return (
    <Card className="border-2 border-amber-300/40 bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-gradient-to-br from-amber-500 to-orange-600">
            <History className="w-4 h-4 text-white" />
          </div>
          ProBet Backtest
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300 text-[10px] ml-2">
            Geçmiş Performans Testi
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Geçmiş tamamlanmış maçlarda ProBet motorunu çalıştırır ve gerçek sonuçlarla karşılaştırır.
          Walk-forward yöntemi: model her maçı tahmin ederken sadece o maçtan ÖNCEKİ verileri görür.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Hızlı seçim:</span>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              const t = new Date();
              const d = new Date(t);
              d.setDate(d.getDate() - 30);
              setFromDate(d.toISOString().split('T')[0]);
              setToDate(t.toISOString().split('T')[0]);
              setMaxMatches(100);
              setFastMode(false);
              setIncludePreviousSeason(false);
            }}
          >
            Son 30 gün · 100 maç
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              const t = new Date();
              const d = new Date(t);
              d.setDate(d.getDate() - 90);
              setFromDate(d.toISOString().split('T')[0]);
              setToDate(t.toISOString().split('T')[0]);
              setMaxMatches(300);
              setFastMode(false);
              setIncludePreviousSeason(false);
            }}
          >
            Son 90 gün · 300 maç
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 border-violet-400 text-violet-700 dark:text-violet-300"
            onClick={presetBig}
          >
            <Sparkles className="w-3 h-3 mr-1" />
            BÜYÜK · 1000 maç (1 yıl, fast mode)
          </Button>
        </div>

        {/* Controls */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs font-medium">Başlangıç</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Bitiş</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Maks. Maç</label>
            <Input
              type="number"
              min={10}
              max={2000}
              value={maxMatches}
              onChange={(e) => setMaxMatches(parseInt(e.target.value || '100', 10))}
              className="w-24"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium">Mod</label>
            <div className="flex items-center gap-2">
              <Button
                variant={fastMode ? 'default' : 'outline'}
                size="sm"
                className={`text-xs h-9 ${fastMode ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                onClick={() => setFastMode(!fastMode)}
              >
                {fastMode ? '⚡ Hızlı (Poisson)' : '🔬 Tam (Ensemble)'}
              </Button>
              <Button
                variant={includePreviousSeason ? 'default' : 'outline'}
                size="sm"
                className={`text-xs h-9 ${includePreviousSeason ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                onClick={() => setIncludePreviousSeason(!includePreviousSeason)}
              >
                {includePreviousSeason ? '✓ Önceki Sezon Dahil' : '+ Önceki Sezon'}
              </Button>
            </div>
          </div>
          <Button
            onClick={runBacktest}
            disabled={loading}
            className="gap-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Backtest çalışıyor...' : 'Backtest Çalıştır'}
          </Button>
        </div>

        {loading && !data && (
          <div className="text-center py-8">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-amber-600" />
            <div className="font-semibold text-sm">Backtest motoru çalışıyor</div>
            <div className="text-xs text-muted-foreground mt-1">
              Lig başına ensemble eğitiliyor, geçmiş maçlar yeniden tahmin ediliyor —
              bu işlem 30-90 saniye sürebilir.
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Summary metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard
                icon={Target}
                label="Toplam Maç"
                value={data.totalMatches.toString()}
                hint={`${data.fromDate} → ${data.toDate}`}
              />
              <MetricCard
                icon={CheckCircle2}
                label="İsabet Oranı"
                value={formatPct(data.hitRate)}
                hint={`${data.hits} / ${data.totalMatches} doğru`}
                color={
                  data.hitRate >= 0.45
                    ? 'text-emerald-600'
                    : data.hitRate >= 0.4
                      ? 'text-amber-600'
                      : 'text-rose-600'
                }
              />
              <MetricCard
                icon={BarChart3}
                label="Brier Skoru"
                value={formatNum(data.brierScore)}
                hint="Düşük = iyi (0=mükemmel)"
                color={data.brierScore < 0.6 ? 'text-emerald-600' : 'text-amber-600'}
              />
              <MetricCard
                icon={Percent}
                label="Log Loss"
                value={formatNum(data.logLoss)}
                hint="Düşük = iyi"
                color={data.logLoss < 1.05 ? 'text-emerald-600' : 'text-amber-600'}
              />
            </div>

            {/* INSIGHTS — automatic strengths/weaknesses summary */}
            {data.insights && (data.insights.highlights.length > 0 || data.insights.weaknesses.length > 0) && (
              <Card className="border-emerald-300/40 bg-gradient-to-br from-emerald-50/40 to-blue-50/40 dark:from-emerald-950/20 dark:to-blue-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-600" />
                    Otomatik Bulgular: Model Nelerde İyi?
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.insights.highlights.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">
                        <ThumbsUp className="w-3.5 h-3.5" />
                        Güçlü Yanları
                      </div>
                      <ul className="space-y-1.5 text-xs pl-5 list-disc text-foreground/90">
                        {data.insights.highlights.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data.insights.weaknesses.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 mb-1.5">
                        <ThumbsDown className="w-3.5 h-3.5" />
                        Zayıf Yanları
                      </div>
                      <ul className="space-y-1.5 text-xs pl-5 list-disc text-foreground/90">
                        {data.insights.weaknesses.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Per-outcome accuracy */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Sonuca Göre İsabet</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2 rounded bg-emerald-100/50 dark:bg-emerald-950/30">
                    <div className="text-xs text-muted-foreground">Ev sahibi (1)</div>
                    <div className="font-bold text-lg">{formatPct(data.homeWinAccuracy)}</div>
                  </div>
                  <div className="p-2 rounded bg-amber-100/50 dark:bg-amber-950/30">
                    <div className="text-xs text-muted-foreground">Beraberlik (X)</div>
                    <div className="font-bold text-lg">{formatPct(data.drawAccuracy)}</div>
                  </div>
                  <div className="p-2 rounded bg-blue-100/50 dark:bg-blue-950/30">
                    <div className="text-xs text-muted-foreground">Deplasman (2)</div>
                    <div className="font-bold text-lg">{formatPct(data.awayWinAccuracy)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Market breakdowns */}
            {data.marketBreakdowns && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Crosshair className="w-4 h-4" />
                    Market Bazlı Performans (Sistem nelerde iyi?)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Smart Pick HERO card — most important metric */}
                  {data.marketBreakdowns.smartPick && (
                    <div className="p-3 rounded-lg bg-gradient-to-r from-violet-100/60 to-blue-100/60 dark:from-violet-950/40 dark:to-blue-950/40 border-2 border-violet-300/60 dark:border-violet-700/40">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                          <Sparkles className="w-3.5 h-3.5" />
                          AKILLI ÖNERİ (Her maç için en yüksek olasılıklı marketi seç)
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">
                        {formatPct(data.marketBreakdowns.smartPick.accuracy)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {data.marketBreakdowns.smartPick.hits} / {data.marketBreakdowns.smartPick.count} doğru —
                        sistemin "her maç için en güvendiği" tahminin gerçek isabet oranı
                      </div>
                    </div>
                  )}

                  {/* Goals markets row */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                      Gol Marketleri
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2 rounded bg-muted/40 border">
                        <div className="text-muted-foreground">Üst/Alt 1.5</div>
                        <div className="font-bold text-base">
                          {formatPct(data.marketBreakdowns.over15?.accuracy ?? 0)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.over15?.hits ?? 0}/{data.marketBreakdowns.over15?.count ?? 0}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border">
                        <div className="text-muted-foreground">Üst/Alt 2.5</div>
                        <div className="font-bold text-base">
                          {formatPct(data.marketBreakdowns.over25.accuracy)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.over25.hits}/{data.marketBreakdowns.over25.count}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border">
                        <div className="text-muted-foreground">Üst/Alt 3.5</div>
                        <div className="font-bold text-base">
                          {formatPct(data.marketBreakdowns.over35?.accuracy ?? 0)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.over35?.hits ?? 0}/{data.marketBreakdowns.over35?.count ?? 0}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border">
                        <div className="text-muted-foreground">KG Var/Yok</div>
                        <div className="font-bold text-base">
                          {formatPct(data.marketBreakdowns.bttsCorrect.accuracy)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.bttsCorrect.hits}/{data.marketBreakdowns.bttsCorrect.count}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Outcome + Score markets row */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                      Sonuç & Skor Marketleri
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2 rounded bg-muted/40 border">
                        <div className="text-muted-foreground">1X2 Maç Sonucu</div>
                        <div className="font-bold text-base">
                          {formatPct(data.marketBreakdowns.matchResult.accuracy)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.matchResult.hits}/{data.marketBreakdowns.matchResult.count}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-muted/40 border">
                        <div className="text-muted-foreground">Tam Skor (top pick)</div>
                        <div className="font-bold text-base">
                          {formatPct(data.marketBreakdowns.exactScoreTopPick.accuracy)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.exactScoreTopPick.hits}/{data.marketBreakdowns.exactScoreTopPick.count}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-emerald-100/40 dark:bg-emerald-950/20 border border-emerald-300/40">
                        <div className="text-muted-foreground">Açık Favori (xG ↗)</div>
                        <div className="font-bold text-base text-emerald-700 dark:text-emerald-400">
                          {formatPct(data.marketBreakdowns.clearFavorites.accuracy)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.clearFavorites.hits}/{data.marketBreakdowns.clearFavorites.count}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-rose-100/40 dark:bg-rose-950/20 border border-rose-300/40">
                        <div className="text-muted-foreground">Yakın Maç (xG ≈)</div>
                        <div className="font-bold text-base text-rose-700 dark:text-rose-400">
                          {formatPct(data.marketBreakdowns.closeMatches.accuracy)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {data.marketBreakdowns.closeMatches.hits}/{data.marketBreakdowns.closeMatches.count}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tam Skor Analizi — Top-1 / Top-3 / Top-5 */}
            {data.marketBreakdowns?.exactScoreTop3 && data.marketBreakdowns?.exactScoreTop5 && (
              <Card className="border-indigo-300/40 bg-gradient-to-br from-indigo-50/40 to-purple-50/40 dark:from-indigo-950/20 dark:to-purple-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4 text-indigo-600" />
                    Tam Skor Analizi — Top-N İsabet
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        Top-1 (En olası tek skor)
                      </div>
                      <div className="font-bold text-2xl mt-1">
                        {formatPct(data.marketBreakdowns.exactScoreTopPick.accuracy)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {data.marketBreakdowns.exactScoreTopPick.hits}/{data.marketBreakdowns.exactScoreTopPick.count}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                        <div
                          className="h-full bg-indigo-500"
                          style={{ width: `${Math.min(100, data.marketBreakdowns.exactScoreTopPick.accuracy * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/30 border border-indigo-300/40">
                      <div className="text-[10px] uppercase tracking-wider text-indigo-700 dark:text-indigo-400 font-semibold">
                        Top-3 (İlk 3 olası)
                      </div>
                      <div className="font-bold text-2xl mt-1 text-indigo-700 dark:text-indigo-300">
                        {formatPct(data.marketBreakdowns.exactScoreTop3.accuracy)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {data.marketBreakdowns.exactScoreTop3.hits}/{data.marketBreakdowns.exactScoreTop3.count}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                        <div
                          className="h-full bg-indigo-600"
                          style={{ width: `${Math.min(100, data.marketBreakdowns.exactScoreTop3.accuracy * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-purple-50/40 dark:bg-purple-950/30 border border-purple-300/40">
                      <div className="text-[10px] uppercase tracking-wider text-purple-700 dark:text-purple-400 font-semibold">
                        Top-5 (İlk 5 olası)
                      </div>
                      <div className="font-bold text-2xl mt-1 text-purple-700 dark:text-purple-300">
                        {formatPct(data.marketBreakdowns.exactScoreTop5.accuracy)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {data.marketBreakdowns.exactScoreTop5.hits}/{data.marketBreakdowns.exactScoreTop5.count}
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                        <div
                          className="h-full bg-purple-600"
                          style={{ width: `${Math.min(100, data.marketBreakdowns.exactScoreTop5.accuracy * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-3 italic">
                    Sistem bahis: Top-3 / Top-5 birden oynanabilir — tam skor marketinde pay yüksektir (6-20 civarı).
                  </p>
                </CardContent>
              </Card>
            )}

            {/* HTFT Analizi — 9 outcome breakdown */}
            {data.marketBreakdowns?.htft && data.marketBreakdowns.htft.count > 0 && (
              <Card className="border-teal-300/40 bg-gradient-to-br from-teal-50/40 to-cyan-50/40 dark:from-teal-950/20 dark:to-cyan-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-teal-600" />
                    HTFT Analizi — İlk Yarı / Maç Sonu Tahmini
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 rounded-lg bg-teal-100/60 dark:bg-teal-950/40 border-2 border-teal-300/60 dark:border-teal-700/40">
                    <div className="text-[10px] uppercase tracking-wider text-teal-700 dark:text-teal-300 font-semibold">
                      HTFT Genel İsabet (Tahmin edilen HTFT doğru çıkan)
                    </div>
                    <div className="font-bold text-2xl mt-1 text-teal-700 dark:text-teal-300">
                      {formatPct(data.marketBreakdowns.htft.accuracy)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {data.marketBreakdowns.htft.hits}/{data.marketBreakdowns.htft.count} maç
                    </div>
                  </div>

                  {data.marketBreakdowns.htftSpecific && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                        HTFT Outcome Bazlı (Hangi HTFT tahminleri isabet ediyor?)
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        {(['H/H', 'H/D', 'H/A', 'D/H', 'D/D', 'D/A', 'A/H', 'A/D', 'A/A'] as const).map((outcome) => {
                          const stat = data.marketBreakdowns.htftSpecific?.[outcome];
                          if (!stat) return null;
                          const label = outcome.replace('H', '1').replace('A', '2').replace('D', 'X');
                          const hasData = stat.count > 0;
                          const isStrong = hasData && stat.accuracy >= 0.5;
                          return (
                            <div
                              key={outcome}
                              className={`p-2 rounded border ${
                                isStrong
                                  ? 'bg-emerald-100/40 dark:bg-emerald-950/30 border-emerald-300/40'
                                  : hasData
                                    ? 'bg-muted/40'
                                    : 'bg-muted/20 opacity-60'
                              }`}
                            >
                              <div className="font-mono font-bold text-center">{label}</div>
                              <div className={`text-center text-sm font-bold ${isStrong ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                                {hasData ? formatPct(stat.accuracy) : '—'}
                              </div>
                              <div className="text-center text-[10px] text-muted-foreground">
                                {stat.hits}/{stat.count}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground italic">
                    HTFT (İlk Yarı / Maç Sonu) pazarı yüksek oranlıdır (2/1 ~15-20, X/1 ~4-5).
                    Sistem bahisleri için çok değerli.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* 1X2 Confidence Bucket — Calibration Plot */}
            {data.marketBreakdowns?.matchResultByConfidence && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Percent className="w-4 h-4" />
                    1X2 Güven Kalibrasyonu (Hangi güvende isabet yüksek?)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {(['>65%', '55-65%', '45-55%', '35-45%', '<35%'] as const).map((bucket) => {
                      const stat = data.marketBreakdowns.matchResultByConfidence?.[bucket];
                      if (!stat) return null;
                      // Model "well-calibrated" if accuracy matches confidence range
                      const midpoint =
                        bucket === '>65%' ? 0.75 :
                        bucket === '55-65%' ? 0.6 :
                        bucket === '45-55%' ? 0.5 :
                        bucket === '35-45%' ? 0.4 :
                        0.3;
                      const diff = stat.accuracy - midpoint;
                      const isWellCalibrated = Math.abs(diff) < 0.05 && stat.count >= 5;
                      const isOverconfident = diff < -0.05 && stat.count >= 5;
                      const isUnderconfident = diff > 0.05 && stat.count >= 5;
                      return (
                        <div key={bucket} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/30 border">
                          <div className="font-mono font-semibold w-16 shrink-0">{bucket}</div>
                          <div className="text-[10px] text-muted-foreground shrink-0 font-mono w-14">
                            {stat.hits}/{stat.count}
                          </div>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full ${
                                isWellCalibrated
                                  ? 'bg-emerald-500'
                                  : isOverconfident
                                    ? 'bg-rose-500'
                                    : isUnderconfident
                                      ? 'bg-blue-500'
                                      : 'bg-amber-500'
                              }`}
                              style={{ width: `${Math.min(100, stat.accuracy * 100)}%` }}
                            />
                          </div>
                          <div className="shrink-0 font-bold font-mono w-14 text-right">
                            {stat.count > 0 ? formatPct(stat.accuracy) : '—'}
                          </div>
                          <div className="shrink-0 w-20 text-[10px]">
                            {isWellCalibrated && (
                              <span className="text-emerald-600 font-semibold">Kalibre</span>
                            )}
                            {isOverconfident && (
                              <span className="text-rose-600 font-semibold">Over-confident</span>
                            )}
                            {isUnderconfident && (
                              <span className="text-blue-600 font-semibold">Under-confident</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2 italic">
                    İdeal durum: "güven aralığı" ile "gerçek isabet oranı" eşit olur. "Over-confident" ise model
                    abartıyor, "under-confident" ise değer var.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Per-league breakdown */}
            {data.leagueBreakdowns && data.leagueBreakdowns.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Trophy className="w-4 h-4" />
                    Lig Bazlı Doğruluk (en iyiden en kötüye)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {data.leagueBreakdowns.map((lg) => {
                      const isStrong = lg.accuracy >= data.hitRate + 0.05;
                      const isWeak = lg.accuracy < data.hitRate - 0.05;
                      return (
                        <div
                          key={lg.leagueName}
                          className="flex items-center gap-2 text-xs p-2 rounded bg-muted/30 border"
                        >
                          <div className="flex-1 min-w-0 truncate font-medium">{lg.leagueName}</div>
                          <div className="text-[10px] text-muted-foreground shrink-0 font-mono">
                            {lg.hits}/{lg.count}
                          </div>
                          <div
                            className={`shrink-0 font-bold font-mono w-14 text-right ${
                              isStrong
                                ? 'text-emerald-600'
                                : isWeak
                                  ? 'text-rose-600'
                                  : 'text-foreground'
                            }`}
                          >
                            {formatPct(lg.accuracy)}
                          </div>
                          <div className="w-20 h-2 rounded-full bg-muted overflow-hidden shrink-0">
                            <div
                              className={`h-full ${
                                isStrong ? 'bg-emerald-500' : isWeak ? 'bg-rose-500' : 'bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(100, lg.accuracy * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Confidence buckets */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Güven Eşiğine Göre ROI (Fair-odds bahis simülasyonu)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-1.5 px-2">Eşik ≥</th>
                        <th className="text-right py-1.5 px-2">Maç</th>
                        <th className="text-right py-1.5 px-2">İsabet</th>
                        <th className="text-right py-1.5 px-2">Doğruluk</th>
                        <th className="text-right py-1.5 px-2">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.confidenceBuckets.map((b) => (
                        <tr key={b.threshold} className="border-b border-muted">
                          <td className="py-1.5 px-2 font-mono">{formatPct(b.threshold)}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{b.count}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{b.hits}</td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {formatPct(b.accuracy)}
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right font-mono font-semibold ${
                              b.roi > 0
                                ? 'text-emerald-600'
                                : b.roi < 0
                                  ? 'text-rose-600'
                                  : 'text-muted-foreground'
                            }`}
                          >
                            {b.roi > 0 ? '+' : ''}
                            {formatPct(b.roi)}
                            {b.roi > 0 ? (
                              <TrendingUp className="w-3 h-3 inline ml-1" />
                            ) : (
                              <TrendingDown className="w-3 h-3 inline ml-1" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 italic">
                  Not: ROI hesabı fair odds (1/p) varsayar. Gerçek bahis sitelerinde bookmaker
                  marjı bu rakamı düşürür.
                </p>
              </CardContent>
            </Card>

            {/* Sample results */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Örnek Tahminler (En yüksek güvenli)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {data.sampleResults.map((m) => (
                    <ResultRow key={m.fixtureId} m={m} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
