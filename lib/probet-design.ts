/**
 * ProBet Design System
 *
 * The shared visual language used across ProBet UI: gradients, color tokens,
 * category-specific colors for prediction markets, and helper classes.
 *
 * Any other component in the app (or another worktree) can import these
 * to match the ProBet look & feel.
 */

// ─────────────────────────────────────────────────────────────────────────
// Brand gradient palette
// ─────────────────────────────────────────────────────────────────────────

export const PROBET_GRADIENTS = {
  /** Main ProBet brand (violet → blue). Used for ProBet headers and active states. */
  brand: 'from-violet-500 to-blue-600',
  brandHover: 'from-violet-600 to-blue-700',
  brandSoft: 'from-violet-50 via-blue-50 to-emerald-50 dark:from-violet-950/40 dark:via-blue-950/40 dark:to-emerald-950/40',

  /** Match list / browse (emerald → teal). */
  list: 'from-emerald-500 to-teal-600',
  listHover: 'from-emerald-600 to-teal-700',

  /** Backtest / history (amber → orange). */
  backtest: 'from-amber-500 to-orange-600',
  backtestHover: 'from-amber-600 to-orange-700',
  backtestSoft: 'from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20',

  /** Value bets (amber, warning). */
  value: 'from-amber-100 to-yellow-100 dark:from-amber-950/30 dark:to-yellow-950/30',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Market category theming — each prediction market category has its own
// color tint so users can visually distinguish them at a glance.
// ─────────────────────────────────────────────────────────────────────────

export type MarketCategory =
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

interface CategoryTheme {
  /** Tailwind background classes for a soft tinted card */
  bg: string;
  /** Tailwind border classes */
  border: string;
  /** Icon color */
  icon: string;
  /** Primary text color */
  text: string;
  /** Category label in Turkish (human-readable) */
  label: string;
}

export const MARKET_CATEGORY_THEME: Record<MarketCategory, CategoryTheme> = {
  MAÇ_SONUCU: {
    bg: 'bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-950/30 dark:to-blue-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: 'text-emerald-600',
    text: 'text-emerald-700 dark:text-emerald-400',
    label: 'Maç Sonucu (1X2 / DC / DNB)',
  },
  GOL_TOPLAMI: {
    bg: 'bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30',
    border: 'border-orange-200 dark:border-orange-800',
    icon: 'text-orange-600',
    text: 'text-orange-700 dark:text-orange-400',
    label: 'Gol Toplamı (Üst/Alt)',
  },
  KG: {
    bg: 'bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-950/30',
    border: 'border-cyan-200 dark:border-cyan-800',
    icon: 'text-cyan-600',
    text: 'text-cyan-700 dark:text-cyan-400',
    label: 'Karşılıklı Gol (KG)',
  },
  TAKIM_TOPLAMI: {
    bg: 'bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30',
    border: 'border-indigo-200 dark:border-indigo-800',
    icon: 'text-indigo-600',
    text: 'text-indigo-700 dark:text-indigo-400',
    label: 'Takım Bazlı Goller',
  },
  CLEAN_SHEET: {
    bg: 'bg-gradient-to-r from-sky-50 to-indigo-50 dark:from-sky-950/30 dark:to-indigo-950/30',
    border: 'border-sky-200 dark:border-sky-800',
    icon: 'text-sky-600',
    text: 'text-sky-700 dark:text-sky-400',
    label: 'Gol Yememe / Win to Nil',
  },
  HANDIKAP: {
    bg: 'bg-gradient-to-r from-lime-50 to-green-50 dark:from-lime-950/30 dark:to-green-950/30',
    border: 'border-lime-200 dark:border-lime-800',
    icon: 'text-lime-600',
    text: 'text-lime-700 dark:text-lime-400',
    label: 'Asian Handikap',
  },
  YARI_SONUCU: {
    bg: 'bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30',
    border: 'border-rose-200 dark:border-rose-800',
    icon: 'text-rose-600',
    text: 'text-rose-700 dark:text-rose-400',
    label: 'İlk Yarı (İY 1X2, İY Üst/Alt)',
  },
  YARI_FULL: {
    bg: 'bg-gradient-to-r from-purple-50 to-fuchsia-50 dark:from-purple-950/30 dark:to-fuchsia-950/30',
    border: 'border-purple-200 dark:border-purple-800',
    icon: 'text-purple-600',
    text: 'text-purple-700 dark:text-purple-400',
    label: 'İlk Yarı / Maç Sonu (İY/MS)',
  },
  YARILAR: {
    bg: 'bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-950/30 dark:to-emerald-950/30',
    border: 'border-teal-200 dark:border-teal-800',
    icon: 'text-teal-600',
    text: 'text-teal-700 dark:text-teal-400',
    label: 'Her İki Yarı / Yüksek Yarı',
  },
  KORNER: {
    bg: 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'text-amber-600',
    text: 'text-amber-700 dark:text-amber-400',
    label: 'Korner (Üst/Alt)',
  },
  KART: {
    bg: 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30',
    border: 'border-red-200 dark:border-red-800',
    icon: 'text-red-600',
    text: 'text-red-700 dark:text-red-400',
    label: 'Kart (Üst/Alt)',
  },
  ILK_GOL: {
    bg: 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30',
    border: 'border-green-200 dark:border-green-800',
    icon: 'text-green-600',
    text: 'text-green-700 dark:text-green-400',
    label: 'İlk Gol',
  },
  TAM_SKOR: {
    bg: 'bg-gradient-to-r from-fuchsia-50 to-purple-50 dark:from-fuchsia-950/30 dark:to-purple-950/30',
    border: 'border-fuchsia-200 dark:border-fuchsia-800',
    icon: 'text-fuchsia-600',
    text: 'text-fuchsia-700 dark:text-fuchsia-400',
    label: 'Tam Skor',
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Confidence → badge theming
// ─────────────────────────────────────────────────────────────────────────

export function confidenceTheme(probability: number): {
  label: string;
  className: string;
} {
  const pct = probability * 100;
  if (pct >= 75) {
    return { label: 'Çok Yüksek', className: 'bg-emerald-600 text-white' };
  } else if (pct >= 60) {
    return { label: 'Yüksek', className: 'bg-blue-600 text-white' };
  } else if (pct >= 45) {
    return { label: 'Orta', className: 'bg-amber-600 text-white' };
  } else if (pct >= 30) {
    return { label: 'Düşük', className: 'bg-slate-500 text-white' };
  }
  return { label: 'Çok Düşük', className: 'bg-slate-400 text-white' };
}

export function probabilityTextColor(probability: number): string {
  const pct = probability * 100;
  if (pct >= 70) return 'text-emerald-600 font-bold';
  if (pct >= 50) return 'text-blue-600';
  if (pct >= 35) return 'text-foreground';
  return 'text-muted-foreground';
}

// ─────────────────────────────────────────────────────────────────────────
// Progress-bar colors for 1X2 outcomes
// ─────────────────────────────────────────────────────────────────────────

export const OUTCOME_COLORS = {
  home: 'bg-emerald-500',
  draw: 'bg-amber-500',
  away: 'bg-blue-500',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Card container presets
// ─────────────────────────────────────────────────────────────────────────

export const CARD_PRESETS = {
  /** Main prediction card (with hover) */
  prediction: 'overflow-hidden border-2 hover:border-primary/40 transition-colors',
  /** Header card with soft brand gradient */
  brandHeader:
    'rounded-lg border-2 border-primary/20 bg-gradient-to-br from-violet-50 via-blue-50 to-emerald-50 dark:from-violet-950/40 dark:via-blue-950/40 dark:to-emerald-950/40 p-6',
  /** Backtest header with amber accent */
  backtestHeader:
    'border-2 border-amber-300/40 bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20',
  /** Value bet callout */
  valueBet:
    'rounded border-2 border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/20',
  /** Neutral info panel (injuries, API consensus) */
  info: 'rounded border bg-muted/30',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Common helpers
// ─────────────────────────────────────────────────────────────────────────

export const formatPct = (p: number) => `${(p * 100).toFixed(1)}%`;
export const formatNum = (n: number, dp = 2) => n.toFixed(dp);
