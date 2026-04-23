'use client';

/**
 * ProBet Winrate Badge
 *
 * Her tahmin/pick kartının yanında gösterilen kompakt rozet.
 * Son N günün geçmişine dayanarak o pazardaki kazanma oranını,
 * örnek sayısını ve ROI'yi gösterir. Renk kodu:
 *
 *  ≥80%  → mavi (elit)  → %XX (n=NN)
 *  65-80 → yeşil (güvenilir)
 *  50-65 → sarı (orta)
 *  <50%  → kırmızı (kaçın)
 *  n<3   → gri (yeterli veri yok)
 *
 * Hover'da tooltip ile kazanç/kayıp ve ROI detayı görünür.
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { winrateColorClass, winrateBgClass, roiColorClass, roiEmoji } from '@/lib/probet/label-helpers';

export interface MarketStat {
  winrate: number;
  n: number;
  wins: number;
  losses: number;
  avgOdds: number | null;
  roiPct: number | null;
}

export interface PatternStat {
  winrate: number;
  n: number;
  wins: number;
  losses: number;
  isBanko: boolean;
  patternName: string;
}

export interface SystemCategoryStat {
  winrate: number;
  n: number;
  wins: number;
  losses: number;
  avgOdds: number | null;
  roiPct: number | null;
  category: string;
  riskLevel: string;
}

export interface MarketWinrateData {
  window: { days: number; resolved: number; totalPicks: number };
  byMarket: Record<string, MarketStat>;
  byPattern: Record<string, PatternStat>;
  bySystemCategory: Record<string, SystemCategoryStat>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context provider — tek bir fetch ile tüm rozetler beslenir
// ─────────────────────────────────────────────────────────────────────────────
interface WinrateCtx {
  data: MarketWinrateData | null;
  loading: boolean;
  error: string | null;
  days: number;
  sport: string;
}

const Ctx = createContext<WinrateCtx>({ data: null, loading: false, error: null, days: 7, sport: 'all' });

export function WinrateProvider({ children, days = 7, sport = 'all' }: { children: React.ReactNode; days?: number; sport?: string }) {
  const [data, setData] = useState<MarketWinrateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const sportParam = sport && sport !== 'all' ? `&sport=${encodeURIComponent(sport)}` : '';
    fetch(`/api/probet/market-winrates?days=${days}${sportParam}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setData(json.data);
          setError(null);
        } else {
          setError(json.error || 'Winrate verisi alınamadı');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, sport]);

  const value = useMemo(() => ({ data, loading, error, days, sport }), [data, loading, error, days]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWinrates(): WinrateCtx {
  return useContext(Ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Badge
// ─────────────────────────────────────────────────────────────────────────────
interface BadgeProps {
  winrate: number;
  n: number;
  wins?: number;
  losses?: number;
  roiPct?: number | null;
  avgOdds?: number | null;
  label?: string;
  tooltipExtra?: string;
  size?: 'xs' | 'sm';
}

function CoreBadge({ winrate, n, wins, losses, roiPct, avgOdds, label, tooltipExtra, size = 'xs' }: BadgeProps) {
  if (n < 3) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0 rounded border bg-slate-500/10 border-slate-500/30 text-slate-500 text-[9px] font-mono shrink-0"
        title={`Örnek sayısı az (n=${n}). Güvenilir istatistik için en az 3 örnek gerekli.`}
      >
        n={n}
      </span>
    );
  }
  const pct = Math.round(winrate * 100);
  const colorCls = winrateColorClass(winrate);
  const bgCls = winrateBgClass(winrate);
  const roiTxt =
    roiPct !== null && roiPct !== undefined
      ? `ROI ${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%`
      : null;
  const tooltip = [
    label ? `${label}` : null,
    `Son kazanma oranı: %${pct} (${wins ?? '?'}W / ${losses ?? '?'}L, n=${n})`,
    avgOdds ? `Ortalama oran: ${avgOdds.toFixed(2)}` : null,
    roiTxt ? `${roiEmoji(roiPct)} ${roiTxt}` : null,
    tooltipExtra || null,
  ]
    .filter(Boolean)
    .join('\n');

  const padCls = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1 py-0 text-[9px]';

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border font-mono font-bold shrink-0 ${bgCls} ${colorCls} ${padCls}`}
      title={tooltip}
    >
      📈 {pct}%
      <span className="opacity-70 font-normal">({n})</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Badge — pick kartlarında market bazlı winrate
// ─────────────────────────────────────────────────────────────────────────────
export function MarketWinrateBadge({ market, size }: { market: string; size?: 'xs' | 'sm' }) {
  const { data, loading, days } = useWinrates();
  if (loading || !data) return null;
  const stat = data.byMarket[market];
  if (!stat) {
    return (
      <span
        className="inline-flex items-center px-1 py-0 rounded border bg-slate-500/10 border-slate-500/30 text-slate-500 text-[9px] font-mono shrink-0"
        title={`Son ${days} günde bu pazarda yeterli örnek yok.`}
      >
        yeni
      </span>
    );
  }
  return (
    <CoreBadge
      winrate={stat.winrate}
      n={stat.n}
      wins={stat.wins}
      losses={stat.losses}
      roiPct={stat.roiPct}
      avgOdds={stat.avgOdds}
      label={`Pazar: ${market}`}
      tooltipExtra={`(Son ${days} gün)`}
      size={size}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Badge
// ─────────────────────────────────────────────────────────────────────────────
export function PatternWinrateBadge({ patternId, size }: { patternId: string; size?: 'xs' | 'sm' }) {
  const { data, loading, days } = useWinrates();
  if (loading || !data) return null;
  const stat = data.byPattern[patternId];
  if (!stat) {
    return (
      <span
        className="inline-flex items-center px-1 py-0 rounded border bg-slate-500/10 border-slate-500/30 text-slate-500 text-[9px] font-mono shrink-0"
        title={`Son ${days} günde bu pattern için yeterli örnek yok.`}
      >
        yeni
      </span>
    );
  }
  return (
    <CoreBadge
      winrate={stat.winrate}
      n={stat.n}
      wins={stat.wins}
      losses={stat.losses}
      label={`Pattern: ${stat.patternName}${stat.isBanko ? ' (BANKO)' : ''}`}
      tooltipExtra={`(Son ${days} gün)`}
      size={size}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// System Category Badge — sistem kuponunda kategori+risk kombosu için
// ─────────────────────────────────────────────────────────────────────────────
export function SystemCategoryBadge({
  category,
  riskLevel,
  size,
}: {
  category: string;
  riskLevel: string;
  size?: 'xs' | 'sm';
}) {
  const { data, loading, days } = useWinrates();
  if (loading || !data) return null;
  const key = `${category}::${riskLevel}`;
  const stat = data.bySystemCategory[key];
  if (!stat) {
    return (
      <span
        className="inline-flex items-center px-1 py-0 rounded border bg-slate-500/10 border-slate-500/30 text-slate-500 text-[9px] font-mono shrink-0"
        title={`Son ${days} günde bu kategori+risk için yeterli örnek yok.`}
      >
        yeni
      </span>
    );
  }
  return (
    <CoreBadge
      winrate={stat.winrate}
      n={stat.n}
      wins={stat.wins}
      losses={stat.losses}
      roiPct={stat.roiPct}
      avgOdds={stat.avgOdds}
      label={`${category} (${riskLevel})`}
      tooltipExtra={`(Son ${days} gün)`}
      size={size}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROI Chip — sistem kuponlarında ROI bazlı karar desteği
// ─────────────────────────────────────────────────────────────────────────────
export function RoiChip({ roiPct, n, label }: { roiPct: number | null | undefined; n: number; label?: string }) {
  if (roiPct === null || roiPct === undefined || n < 3) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-500/30 bg-slate-500/10 text-slate-500 text-[9px] font-mono font-bold shrink-0"
        title="Yeterli veri yok"
      >
        ROI ?
      </span>
    );
  }
  const cls = roiColorClass(roiPct);
  const bgCls =
    roiPct >= 20
      ? 'bg-emerald-500/15 border-emerald-500/50'
      : roiPct >= 5
        ? 'bg-emerald-500/10 border-emerald-500/30'
        : roiPct >= -5
          ? 'bg-slate-500/10 border-slate-500/30'
          : 'bg-rose-500/15 border-rose-500/40';
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border font-mono font-bold shrink-0 ${bgCls} ${cls} text-[10px]`}
      title={`Geçmiş ROI: ${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}% (n=${n})${label ? ' · ' + label : ''}`}
    >
      {roiEmoji(roiPct)} ROI {roiPct >= 0 ? '+' : ''}
      {roiPct.toFixed(0)}%
    </span>
  );
}
