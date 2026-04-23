'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { DailyVolumeRow, TrackingFilters } from './types';

export function useDailyVolume(filters: TrackingFilters) {
  const qs = toQuery(baseFilterParams(filters));
  return useQuery<DailyVolumeRow[]>({
    queryKey: ['tracking', 'daily-volume', qs],
    queryFn: () =>
      fetchJson<DailyVolumeRow[]>(`/api/tracking/daily-volume?${qs}`),
  });
}
