'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { MarketPerformanceRow, TrackingFilters } from './types';

export interface UseMarketPerformanceParams {
  limit?: number;
}

export function useMarketPerformance(
  filters: TrackingFilters,
  params: UseMarketPerformanceParams = {}
) {
  const qs = toQuery({ ...baseFilterParams(filters), limit: params.limit });
  return useQuery<MarketPerformanceRow[]>({
    queryKey: ['tracking', 'performance', qs],
    queryFn: () =>
      fetchJson<MarketPerformanceRow[]>(`/api/tracking/performance?${qs}`),
  });
}
