'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { OverallKpis, TrackingFilters } from './types';

export function useKpis(filters: TrackingFilters) {
  const qs = toQuery(baseFilterParams(filters));
  return useQuery<OverallKpis>({
    queryKey: ['tracking', 'kpis', qs],
    queryFn: () => fetchJson<OverallKpis>(`/api/tracking/kpis?${qs}`),
  });
}
