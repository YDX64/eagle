'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { FamilyPerformanceRow, TrackingFilters } from './types';

export function useFamilyPerformance(filters: TrackingFilters) {
  const qs = toQuery(baseFilterParams(filters));
  return useQuery<FamilyPerformanceRow[]>({
    queryKey: ['tracking', 'family-performance', qs],
    queryFn: () =>
      fetchJson<FamilyPerformanceRow[]>(
        `/api/tracking/family-performance?${qs}`
      ),
  });
}
