'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJsonEnvelope, toQuery } from './fetcher';
import type {
  PredictionListItem,
  PredictionListResponse,
  SportCode,
  TrackingFilters,
} from './types';

export interface UsePredictionsParams {
  status?: 'pending' | 'resolved';
  sport?: SportCode;
  page?: number;
  limit?: number;
  /** Restrict returned picks to a single market (client-side filter). */
  market?: string;
}

interface RawPrediction {
  id: string;
  sport: SportCode;
  fixture_id: number;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
  match_date: string | Date | null;
  status: string;
  home_win_prob: number | null;
  draw_prob: number | null;
  away_win_prob: number | null;
  confidence: number | null;
  actual_home: number | null;
  actual_away: number | null;
  picks?: Array<{
    id: bigint | number | string;
    market: string;
    market_label: string | null;
    pick_label: string | null;
    probability: number | null;
    market_odds: number | null;
    expected_value: number | null;
    hit: boolean | null;
    is_high_confidence: boolean | null;
  }>;
}

interface RawPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

function adaptPrediction(
  raw: RawPrediction,
  restrictMarket?: string
): PredictionListItem {
  const picks = (raw.picks ?? [])
    .filter(p => !restrictMarket || p.market === restrictMarket)
    .map(p => ({
      pick_id: String(p.id),
      market: p.market,
      market_label: p.market_label ?? undefined,
      pick_label: p.pick_label ?? undefined,
      probability: p.probability,
      market_odds: p.market_odds,
      expected_value: p.expected_value,
      hit: p.hit,
      is_high_confidence: p.is_high_confidence,
    }));
  return {
    prediction_id: raw.id,
    sport: raw.sport,
    fixture_id: raw.fixture_id,
    match_date:
      raw.match_date instanceof Date
        ? raw.match_date.toISOString()
        : (raw.match_date ?? null),
    home_team: raw.home_team,
    away_team: raw.away_team,
    league: raw.league,
    status: raw.status,
    confidence: raw.confidence,
    home_win_prob: raw.home_win_prob,
    draw_prob: raw.draw_prob,
    away_win_prob: raw.away_win_prob,
    home_score: raw.actual_home,
    away_score: raw.actual_away,
    picks,
  };
}

export function usePredictions(
  filters: TrackingFilters,
  params: UsePredictionsParams = {}
) {
  const qs = toQuery({
    ...baseFilterParams(filters),
    status: params.status,
    sport: params.sport,
    page: params.page ?? 1,
    limit: params.limit ?? 25,
  });
  return useQuery<PredictionListResponse>({
    queryKey: ['tracking', 'predictions', qs, params.market ?? ''],
    queryFn: async () => {
      const env = await fetchJsonEnvelope<
        RawPrediction[],
        { pagination?: RawPagination }
      >(`/api/tracking/predictions?${qs}`);
      const page = env.meta.pagination?.page ?? params.page ?? 1;
      const limit = env.meta.pagination?.limit ?? params.limit ?? 25;
      const total = env.meta.pagination?.total ?? env.data.length;
      const total_pages =
        env.meta.pagination?.total_pages ?? Math.ceil(total / Math.max(limit, 1));
      return {
        data: env.data.map(p => adaptPrediction(p, params.market)),
        page,
        limit,
        total,
        total_pages,
        has_more: page < total_pages,
      };
    },
  });
}
