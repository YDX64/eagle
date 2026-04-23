'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { SportRoiRow, TrackingFilters } from './types';

export function useSportRoi(filters: TrackingFilters) {
  const qs = toQuery(baseFilterParams(filters));
  return useQuery<SportRoiRow[]>({
    queryKey: ['tracking', 'sport-roi', qs],
    queryFn: () =>
      fetchJson<SportRoiRow[]>(`/api/tracking/sport-roi?${qs}`),
  });
}
