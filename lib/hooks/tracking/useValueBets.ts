'use client';

import { useQuery } from '@tanstack/react-query';
import { baseFilterParams, fetchJson, toQuery } from './fetcher';
import type { TrackingFilters, ValueBetRow } from './types';

export interface UseValueBetsParams {
  limit?: number;
}

export function useValueBets(
  filters: TrackingFilters,
  params: UseValueBetsParams = {}
) {
  const qs = toQuery({
    ...baseFilterParams(filters),
    limit: params.limit ?? 100,
  });
  return useQuery<ValueBetRow[]>({
    queryKey: ['tracking', 'value-bets', qs],
    queryFn: () =>
      fetchJson<ValueBetRow[]>(`/api/tracking/value-bets?${qs}`),
  });
}
