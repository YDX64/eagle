'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { PlayerPropPerformanceRow, TrackingFilters } from './types';

export function usePlayerProps(filters: TrackingFilters) {
  const qs = toQuery(baseFilterParams(filters));
  return useQuery<PlayerPropPerformanceRow[]>({
    queryKey: ['tracking', 'player-props', qs],
    queryFn: () =>
      fetchJson<PlayerPropPerformanceRow[]>(
        `/api/tracking/player-props/performance?${qs}`
      ),
  });
}
