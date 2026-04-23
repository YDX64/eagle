'use client';

/**
 * ProBet Live Tracking Panel
 *
 * Shows real-time backtest stats from the tracking database:
 *  - Overall best-pick accuracy
 *  - Per-sport breakdown (football, basketball, hockey, volleyball, handball)
 *  - Per-market accuracy (OVER_25, BTTS_YES, HOME_WIN, etc)
 *  - Per-pattern accuracy (how well odds patterns actually perform)
 *  - System bet category performance
 *  - Confidence bucket calibration
 *
 * Data auto-updates when you click "Çözüle" (resolve button) which fetches
 * the latest match results for all pending predictions.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  Trophy,
  Target,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Crosshair,
  Sparkles,
  TrendingUp,
  Activity,
} from 'lucide-react';

interface TrackingStats {
  totalPredictions: number;
  resolvedPredictions: number;
  pendingPredictions: number;
  bestPickHits: number;
  bestPickAccuracy: number;
  bySport: Record<
    string,
    { total: number; resolved: number; bestPickHits: number; bestPickAccuracy: number }
  >;
  byMarket: Array<{
    market: string;
    marketLabel: string;
    total: number;
    hits: number;
    accuracy: number;
  }>;
  byPattern: Array<{
    patternId: string;
    patternName: string;
    total: number;
    hits: number;
    accuracy: number;
    avgHitRate: number;
    isBanko: boolean;
  }>;
  bySystemCategory: Array<{
    category: string;
    total: number;
    hits: number;
    accuracy: number;
    avgEv: number;
  }>;
  byConfidenceBucket: Array<{
    bucket: string;
    total: number;
    hits: number;
    accuracy: number;
  }>;
}

const SPORT_EMOJI: Record<string, string> = {
  football: '⚽',
  basketball: '🏀',
  hockey: '🏒',
  volleyball: '🏐',
  handball: '🤾',
};

const SPORT_NAME: Record<string, string> = {
  football: 'Futbol',
  basketball: 'Basketbol',
  hockey: 'Hokey',
  volleyball: 'Voleybol',
  handball: 'Hentbol',
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function AccuracyBar({
  value,
  label,
  baseline = 0.33,
}: {
  value: number;
  label?: string;
  baseline?: number;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const color =
    value >= baseline + 0.1
      ? 'bg-emerald-500'
      : value >= baseline
        ? 'bg-blue-500'
        : value >= baseline - 0.1
          ? 'bg-amber-500'
          : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      {label && <span className="w-32 text-muted-foreground truncate">{label}</span>}
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] w-12 text-right font-semibold">{fmtPct(value)}</span>
    </div>
  );
}

export function ProBetTracking() {
  const [stats, setStats] = useState<TrackingStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/probet/tracking-stats');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Stats hatası');
      setStats(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }, []);

  const resolveMatches = useCallback(async () => {
    setResolving(true);
    setResolveMessage(null);
    try {
      const res = await fetch('/api/probet/resolve-results?max=100', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Resolve hatası');
      const d = json.data;
      setResolveMessage(
        `Taranan: ${d.scanned} · İşlenen: ${d.processed} · Çözülen: ${d.resolved} · Atlanan: ${d.skipped} · Hata: ${d.errors}`
      );
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setResolving(false);
    }
  }, [loadStats]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return (
    <Card className="border-2 border-emerald-300/40 bg-gradient-to-br from-emerald-50/40 to-teal-50/30 dark:from-emerald-950/20 dark:to-teal-950/15">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-gradient-to-br from-emerald-500 to-teal-600">
            <Activity className="w-4 h-4 text-white" />
          </div>
          Canlı Tracking Backtest
          <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300 text-[10px] ml-2">
            Gerçek Tahmin Geçmişi
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Her üretilen tahmin otomatik olarak kaydedilir. Maç bittiğinde kazanıp kaybettiği
          ölçülür. Birkaç gün sonra buradan hangi spor dalı, hangi market, hangi pattern'in
          en başarılı olduğunu göreceksin.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Action bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={loadStats}
            disabled={loading}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
          <Button
            onClick={resolveMatches}
            disabled={resolving}
            size="sm"
            className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
          >
            <CheckCircle2 className={`w-3.5 h-3.5 ${resolving ? 'animate-spin' : ''}`} />
            {resolving ? 'Çözülüyor...' : 'Biten Maçları Çöz'}
          </Button>
          {resolveMessage && (
            <span className="text-[11px] text-muted-foreground font-mono">{resolveMessage}</span>
          )}
        </div>

        {error && (
          <div className="p-3 rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-sm">
            {error}
          </div>
        )}

        {stats && (
          <div className="space-y-4">
            {/* ═══════ OVERVIEW CARDS ═══════ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-background border">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <Target className="w-3 h-3" />
                  Toplam
                </div>
                <div className="text-2xl font-bold">{stats.totalPredictions}</div>
                <div className="text-[10px] text-muted-foreground">
                  tahmin kaydedildi
                </div>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300/40">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-3 h-3" />
                  Çözüldü
                </div>
                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {stats.resolvedPredictions}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  maçı biten
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300/40">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
                  <Clock className="w-3 h-3" />
                  Bekliyor
                </div>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {stats.pendingPredictions}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  henüz oynanmamış
                </div>
              </div>
              <div className="p-3 rounded-lg bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30 border-2 border-violet-400/50">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-400 font-semibold">
                  <Sparkles className="w-3 h-3" />
                  Best Pick İsabet
                </div>
                <div className="text-2xl font-bold text-violet-700 dark:text-violet-400">
                  {fmtPct(stats.bestPickAccuracy)}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {stats.bestPickHits}/{stats.resolvedPredictions}
                </div>
              </div>
            </div>

            {/* ═══════ BY SPORT ═══════ */}
            {Object.keys(stats.bySport).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Trophy className="w-4 h-4" />
                    Spor Dalına Göre Performans
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.bySport)
                      .sort((a, b) => b[1].resolved - a[1].resolved)
                      .map(([sport, s]) => (
                        <div key={sport} className="flex items-center gap-2 text-xs">
                          <div className="w-28 flex items-center gap-1.5">
                            <span className="text-base">{SPORT_EMOJI[sport] || '🏅'}</span>
                            <span className="font-semibold">{SPORT_NAME[sport] || sport}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono w-20">
                            {s.bestPickHits}/{s.resolved} ({s.total} top)
                          </div>
                          <div className="flex-1">
                            <AccuracyBar value={s.bestPickAccuracy} baseline={0.33} />
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ═══════ BY MARKET ═══════ */}
            {stats.byMarket.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Crosshair className="w-4 h-4" />
                    Market Bazlı Performans (hangi market isabet yüksek?)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-h-72 overflow-y-auto pr-2">
                    {stats.byMarket.slice(0, 30).map((m) => (
                      <div key={m.market} className="flex items-center gap-2 text-xs">
                        <span className="w-40 truncate font-medium">{m.marketLabel}</span>
                        <span className="text-[10px] text-muted-foreground font-mono w-14">
                          {m.hits}/{m.total}
                        </span>
                        <div className="flex-1">
                          <AccuracyBar value={m.accuracy} baseline={0.5} />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ═══════ BY PATTERN ═══════ */}
            {stats.byPattern.length > 0 && (
              <Card className="border-violet-300/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-600" />
                    Oran Pattern Performansı
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-2">
                    {stats.byPattern.slice(0, 20).map((p) => (
                      <div key={p.patternId} className="flex items-center gap-2 text-xs">
                        <span className="w-48 truncate font-medium flex items-center gap-1">
                          {p.isBanko && <span className="text-emerald-600">🎯</span>}
                          {p.patternName}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono w-16">
                          {p.hits}/{p.total}
                        </span>
                        <div className="flex-1">
                          <AccuracyBar value={p.accuracy} baseline={p.avgHitRate} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground italic mt-2">
                    Baseline = her pattern'in iddia ettiği historical hit rate. Bunun üzerinde
                    performans gösterenler gerçekten çalışıyor.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ═══════ BY SYSTEM CATEGORY ═══════ */}
            {stats.bySystemCategory.length > 0 && (
              <Card className="border-orange-300/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-orange-600" />
                    Sistem Bahis Kategorisi Performansı
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {stats.bySystemCategory.map((sc) => (
                      <div key={sc.category} className="flex items-center gap-2 text-xs">
                        <span className="w-28 font-semibold uppercase tracking-wider text-[10px]">
                          {sc.category}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono w-14">
                          {sc.hits}/{sc.total}
                        </span>
                        <div className="flex-1">
                          <AccuracyBar value={sc.accuracy} baseline={0.35} />
                        </div>
                        <span className="w-16 text-[10px] font-mono text-emerald-600">
                          EV {sc.avgEv > 0 ? '+' : ''}{(sc.avgEv * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ═══════ CONFIDENCE CALIBRATION ═══════ */}
            {stats.byConfidenceBucket.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Güven Kalibrasyonu (modelin güveni ile gerçek isabet uyuşuyor mu?)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {stats.byConfidenceBucket.map((b) => {
                      // Bucket midpoint for comparison
                      const midpoint =
                        b.bucket === '>80%' ? 0.85 :
                        b.bucket === '65-80%' ? 0.725 :
                        b.bucket === '50-65%' ? 0.575 :
                        b.bucket === '35-50%' ? 0.425 :
                        0.25;
                      const diff = b.accuracy - midpoint;
                      const label =
                        Math.abs(diff) < 0.05 ? 'Kalibre' :
                        diff < -0.05 ? 'Over-confident' :
                        'Under-confident';
                      return (
                        <div key={b.bucket} className="flex items-center gap-2 text-xs">
                          <span className="w-20 font-mono font-semibold">{b.bucket}</span>
                          <span className="text-[10px] text-muted-foreground font-mono w-14">
                            {b.hits}/{b.total}
                          </span>
                          <div className="flex-1">
                            <AccuracyBar value={b.accuracy} baseline={midpoint} />
                          </div>
                          <span className={`w-24 text-[10px] font-semibold ${
                            label === 'Kalibre' ? 'text-emerald-600' :
                            label === 'Over-confident' ? 'text-rose-600' :
                            'text-blue-600'
                          }`}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {stats.resolvedPredictions === 0 && (
              <div className="p-4 rounded border-2 border-dashed border-muted-foreground/30 text-center text-sm text-muted-foreground">
                Henüz hiç maç çözülmemiş. "Biten Maçları Çöz" butonuna bas veya birkaç gün
                bekle — sistem her gün yeni tahminler yapıp sonuçlarını otomatik kayıt edecek.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
