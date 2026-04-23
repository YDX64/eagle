'use client';

/**
 * Embeddable visual badge that shows the tracked result for a fixture/prediction.
 *
 * Usage (in any match-card / prediction-card):
 *   <PredictionResultBadge fixtureId={1234} sport="football" />
 *
 * States:
 *  - Unknown: no prediction tracked yet → hidden
 *  - Pending: match hasn't finished → "Bekliyor" gray badge
 *  - Win: best pick hit → green "✓ Kazandı %XX/YY" chip
 *  - Loss: best pick missed → red "✗ Kaybetti %XX/YY" chip
 *  - Partial: best pick hit true but some picks missed → amber "Kısmi"
 *
 * Batch mode: pass `ids` prop (array of fixture ids) to a parent
 * `PredictionResultBadgeProvider` to fetch once and distribute via context.
 */

import * as React from 'react';

type Sport =
  | 'football'
  | 'basketball'
  | 'nba'
  | 'hockey'
  | 'handball'
  | 'volleyball'
  | 'baseball';

interface FixtureResult {
  sport: Sport;
  status: 'pending' | 'resolved' | string;
  has_prediction: true;
  best_market: string | null;
  best_pick_label: string | null;
  best_probability: number | null;
  best_pick_hit: boolean | null;
  actual_home: number | null;
  actual_away: number | null;
  match_date: string | null;
  total_picks: number;
  picks_won: number;
  picks_lost: number;
  picks_pending: number;
  win_rate: number | null;
}

type ResultMap = Record<number, FixtureResult>;

const BadgeContext = React.createContext<{
  results: ResultMap;
  register: (id: number) => void;
  sport: Sport;
}>({ results: {}, register: () => {}, sport: 'football' });

/**
 * Wrap a page section that renders many match cards. It batches all child
 * badge lookups into ONE API call per sport.
 */
export function PredictionResultBadgeProvider({
  sport = 'football',
  children,
  pollIntervalMs = 60_000,
}: {
  sport?: Sport;
  children: React.ReactNode;
  pollIntervalMs?: number;
}) {
  const [results, setResults] = React.useState<ResultMap>({});
  const registeredIds = React.useRef<Set<number>>(new Set());
  const pendingFetch = React.useRef<number | null>(null);

  const register = React.useCallback((id: number) => {
    if (registeredIds.current.has(id)) return;
    registeredIds.current.add(id);
    // Debounce-like: schedule a single fetch for the next tick so multiple
    // badges that mount on the same render coalesce into one request.
    if (pendingFetch.current != null) window.clearTimeout(pendingFetch.current);
    pendingFetch.current = window.setTimeout(() => {
      pendingFetch.current = null;
      const ids = Array.from(registeredIds.current);
      if (ids.length === 0) return;
      fetch(`/api/tracking/fixture-result?sport=${sport}&ids=${ids.join(',')}`, {
        cache: 'no-store',
      })
        .then(r => r.json())
        .then(json => {
          if (json?.data) {
            setResults(prev => ({ ...prev, ...json.data }));
          }
        })
        .catch(() => {
          /* tracking is best-effort */
        });
    }, 120) as unknown as number;
  }, [sport]);

  // Periodic refresh for live tracking — pending matches may resolve mid-day.
  React.useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const t = window.setInterval(() => {
      const ids = Array.from(registeredIds.current);
      if (ids.length === 0) return;
      fetch(`/api/tracking/fixture-result?sport=${sport}&ids=${ids.join(',')}`, {
        cache: 'no-store',
      })
        .then(r => r.json())
        .then(json => json?.data && setResults(json.data))
        .catch(() => {});
    }, pollIntervalMs);
    return () => window.clearInterval(t);
  }, [sport, pollIntervalMs]);

  return (
    <BadgeContext.Provider value={{ results, register, sport }}>
      {children}
    </BadgeContext.Provider>
  );
}

export interface PredictionResultBadgeProps {
  fixtureId: number;
  sport?: Sport;
  /** Inline mode uses smaller typography — for stacking inside match cards. */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

/**
 * Single-fixture badge. If rendered inside a `PredictionResultBadgeProvider`
 * it uses the batched cache, otherwise fetches individually.
 */
export function PredictionResultBadge({
  fixtureId,
  sport = 'football',
  size = 'sm',
  className = '',
}: PredictionResultBadgeProps) {
  const ctx = React.useContext(BadgeContext);
  const hasProvider = ctx.register !== undefined && ctx.sport === sport;
  const [localResult, setLocalResult] = React.useState<FixtureResult | null>(null);

  React.useEffect(() => {
    if (hasProvider) {
      ctx.register(fixtureId);
      return;
    }
    fetch(`/api/tracking/fixture-result?sport=${sport}&ids=${fixtureId}`, {
      cache: 'no-store',
    })
      .then(r => r.json())
      .then(json => {
        const r = json?.data?.[fixtureId];
        if (r) setLocalResult(r);
      })
      .catch(() => {});
  }, [fixtureId, sport, hasProvider, ctx]);

  const result = hasProvider ? ctx.results[fixtureId] : localResult;
  if (!result) return null; // no prediction tracked yet — hide gracefully

  const textSizeClass =
    size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';

  // Resolved match
  if (result.status === 'resolved') {
    const settled = result.picks_won + result.picks_lost;
    const pct = settled > 0 ? Math.round((result.picks_won / settled) * 100) : 0;
    const bestHit = result.best_pick_hit;

    if (bestHit === true) {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 font-semibold ${textSizeClass} ${className}`}
          title={`En iyi tahmin tuttu: ${result.best_pick_label ?? result.best_market} — ${result.picks_won}/${settled} pick kazandı (%${pct})`}
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
          </svg>
          Kazandı %{pct}
          {settled > 1 && <span className="opacity-75">({result.picks_won}/{settled})</span>}
        </span>
      );
    }
    if (bestHit === false) {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-semibold ${textSizeClass} ${className}`}
          title={`En iyi tahmin tutmadı: ${result.best_pick_label ?? result.best_market} — ${result.picks_won}/${settled} pick kazandı (%${pct})`}
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
          </svg>
          Kaybetti %{pct}
          {settled > 1 && <span className="opacity-75">({result.picks_won}/{settled})</span>}
        </span>
      );
    }
    // Resolved but best_pick_hit unknown (edge case — perhaps unknown market)
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/40 ${textSizeClass} ${className}`}
        title={`Sonuçlandı — ${result.picks_won}/${settled} pick kazandı`}
      >
        {settled > 0 ? `${result.picks_won}/${settled}` : 'Sonuçlandı'}
      </span>
    );
  }

  // Pending match with a tracked prediction
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/30 ${textSizeClass} ${className}`}
      title={`Tahmin kaydedildi: ${result.best_pick_label ?? result.best_market ?? 'kayıtlı'} (${result.total_picks} market)`}
    >
      <svg className="w-3 h-3 animate-pulse" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <circle cx="10" cy="10" r="4" />
      </svg>
      Tahmin kaydedildi
      {result.total_picks > 0 && <span className="opacity-75">({result.total_picks})</span>}
    </span>
  );
}

/**
 * Expanded card — shows a small detail panel inside a match-card, surfacing
 * best pick + win/lose ratio + actual score.
 */
export function PredictionResultDetail({
  fixtureId,
  sport = 'football',
  className = '',
}: {
  fixtureId: number;
  sport?: Sport;
  className?: string;
}) {
  const ctx = React.useContext(BadgeContext);
  const hasProvider = ctx.sport === sport;
  const [local, setLocal] = React.useState<FixtureResult | null>(null);

  React.useEffect(() => {
    if (hasProvider) {
      ctx.register(fixtureId);
      return;
    }
    fetch(`/api/tracking/fixture-result?sport=${sport}&ids=${fixtureId}`, {
      cache: 'no-store',
    })
      .then(r => r.json())
      .then(j => setLocal(j?.data?.[fixtureId] ?? null))
      .catch(() => {});
  }, [fixtureId, sport, hasProvider, ctx]);

  const r = hasProvider ? ctx.results[fixtureId] : local;
  if (!r) return null;

  const settled = r.picks_won + r.picks_lost;
  const pct = settled > 0 ? ((r.picks_won / settled) * 100).toFixed(0) : '—';

  return (
    <div className={`rounded-lg border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-3 space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          Takip sonucu
        </span>
        <PredictionResultBadge fixtureId={fixtureId} sport={sport} size="xs" />
      </div>
      {r.best_pick_label && (
        <p className="text-sm text-slate-800 dark:text-slate-200">
          <span className="font-medium">En iyi tahmin:</span> {r.best_pick_label}
        </p>
      )}
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <div className="text-center">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400">{r.picks_won}</div>
          <div className="text-slate-500">kazandı</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-rose-600 dark:text-rose-400">{r.picks_lost}</div>
          <div className="text-slate-500">kaybetti</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-sky-600 dark:text-sky-400">{r.picks_pending}</div>
          <div className="text-slate-500">bekliyor</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-slate-700 dark:text-slate-300">%{pct}</div>
          <div className="text-slate-500">isabet</div>
        </div>
      </div>
      {r.actual_home != null && r.actual_away != null && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Gerçek skor: <span className="font-semibold text-slate-700 dark:text-slate-300">{r.actual_home}-{r.actual_away}</span>
        </p>
      )}
    </div>
  );
}
