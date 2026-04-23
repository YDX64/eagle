/**
 * Shared client-side types for the tracking dashboard.
 *
 * These mirror the response shapes of `/api/tracking/*` endpoints.
 * The API endpoints themselves wrap `lib/tracking/analytics.ts` queries.
 */

import type {
  ConfidenceTier,
  MarketFamily,
  MarketPerformanceRow as BaseMarketPerformanceRow,
  SportCode,
} from '@/lib/tracking/types';

export type { ConfidenceTier, MarketFamily, SportCode };

/** Filters driven by URL search params. */
export interface TrackingFilters {
  sports: SportCode[];
  date_from?: string; // ISO date
  date_to?: string; // ISO date
  family?: MarketFamily;
  market?: string;
  min_sample?: number;
  min_probability?: number;
  min_expected_value?: number;
  only_high_confidence?: boolean;
}

export interface OverallKpis {
  total_predictions: number;
  pending: number;
  settled: number;
  total_picks_won: number;
  total_return: number;
  total_stake?: number;
  profit?: number;
  roi?: number;
  trend_total?: number;
  trend_profit?: number;
}

export type MarketPerformanceRow = BaseMarketPerformanceRow;

export interface SportRoiRow {
  sport: SportCode;
  total: number;
  hit: number;
  win_rate: number;
  total_return: number;
  profit: number;
  roi: number;
  avg_probability: number;
}

export interface FamilyPerformanceRow {
  sport: SportCode;
  family: MarketFamily | 'other';
  total: number;
  hit: number;
  win_rate: number;
  avg_probability: number;
  avg_odds: number;
  total_return: number;
  total_stake: number;
  profit: number;
  roi: number;
}

export interface LeaderboardRow extends MarketPerformanceRow {
  rank?: number;
}

export interface ValueBetRow {
  prediction_id: string;
  sport: SportCode;
  match_date: string | null;
  home_team: string | null;
  away_team: string | null;
  league?: string | null;
  market: string;
  market_label?: string | null;
  pick_label?: string | null;
  probability: number | null;
  market_odds: number | null;
  expected_value: number | null;
  is_high_confidence?: boolean | null;
  /** Not persisted on picks — derived client-side from is_high_confidence when present. */
  confidence_tier?: ConfidenceTier | null;
}

/**
 * Normalized prediction shape consumed by the UI. The API returns raw prisma
 * rows — this interface captures the subset the UI actually reads and renames
 * a few fields (`actual_home` → `home_score`, `id` → `prediction_id`) for
 * clarity. Adapters on the client bridge the raw shape.
 */
export interface PredictionListItem {
  prediction_id: string;
  sport: SportCode;
  fixture_id: number;
  match_date: string | null;
  home_team: string | null;
  away_team: string | null;
  league?: string | null;
  status: 'pending' | 'resolved' | 'void' | string;
  confidence?: number | null;
  home_win_prob?: number | null;
  draw_prob?: number | null;
  away_win_prob?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  picks: Array<{
    pick_id: string;
    market: string;
    market_label?: string | null;
    pick_label?: string | null;
    probability: number | null;
    market_odds: number | null;
    expected_value: number | null;
    hit: boolean | null;
    is_high_confidence?: boolean | null;
    confidence_tier?: ConfidenceTier | null;
  }>;
}

/**
 * Envelope returned by /api/tracking/predictions after client-side adaptation.
 * The raw API returns `{ success, data, pagination: { page, limit, total, total_pages } }`.
 */
export interface PredictionListResponse {
  data: PredictionListItem[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

export interface PlayerPropPerformanceRow {
  sport: SportCode;
  market: string;
  market_label?: string | null;
  selection: 'OVER' | 'UNDER' | 'YES' | 'NO';
  total: number;
  hit: number;
  win_rate: number;
  avg_probability: number;
  avg_odds: number;
  total_return: number;
  profit: number;
  roi: number;
}

export interface OddsSnapshotRow {
  snapshot_at: string;
  bookmaker: string;
  market: string;
  selection: string | null;
  odds_value: number;
  line?: number | null;
  is_opening?: boolean;
  is_closing?: boolean;
}

export interface DailyVolumeRow {
  date: string; // YYYY-MM-DD
  total: number;
  hit: number;
  profit: number;
}

export const SPORT_META: Record<
  SportCode,
  { label: string; icon: string; color: string }
> = {
  football: { label: 'Futbol', icon: '⚽', color: 'emerald' },
  basketball: { label: 'Basketbol', icon: '🏀', color: 'orange' },
  nba: { label: 'NBA', icon: '🏀', color: 'orange' },
  hockey: { label: 'Buz Hokeyi', icon: '🏒', color: 'blue' },
  handball: { label: 'Hentbol', icon: '🤾', color: 'purple' },
  volleyball: { label: 'Voleybol', icon: '🏐', color: 'pink' },
  baseball: { label: 'Beyzbol', icon: '⚾', color: 'amber' },
};

export const FAMILY_LABELS_TR: Record<string, string> = {
  match_winner: 'Maç Sonucu',
  double_chance: 'Çifte Şans',
  draw_no_bet: 'Beraberlik İade',
  handicap: 'Handikap',
  totals: 'Üst/Alt',
  team_totals: 'Takım Üst/Alt',
  btts: 'Karşılıklı Gol',
  ht_ft: 'İY/MS',
  correct_score: 'Kesin Skor',
  cards: 'Kartlar',
  corners: 'Korner',
  first_half: 'İlk Yarı',
  second_half: 'İkinci Yarı',
  quarter: 'Çeyrek',
  period: 'Periyot',
  set: 'Set',
  innings: 'Devre',
  player_props: 'Oyuncu Marketleri',
  other: 'Diğer',
};
