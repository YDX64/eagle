'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { LeaderboardRow, TrackingFilters } from './types';

export interface UseLeaderboardParams {
  limit?: number;
}

export function useLeaderboard(
  filters: TrackingFilters,
  params: UseLeaderboardParams = {}
) {
  const qs = toQuery({
    ...baseFilterParams(filters),
    limit: params.limit ?? 50,
  });
  return useQuery<LeaderboardRow[]>({
    queryKey: ['tracking', 'leaderboard', qs],
    queryFn: () =>
      fetchJson<LeaderboardRow[]>(`/api/tracking/leaderboard?${qs}`),
  });
}
