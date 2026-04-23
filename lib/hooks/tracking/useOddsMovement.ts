'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson, toQuery } from './fetcher';
import type { OddsSnapshotRow, SportCode } from './types';

export interface UseOddsMovementParams {
  sport?: SportCode;
  api_game_id?: number;
  market?: string;
}

export function useOddsMovement(params: UseOddsMovementParams) {
  const qs = toQuery({
    sport: params.sport,
    api_game_id: params.api_game_id,
    market: params.market,
  });
  const enabled = Boolean(params.sport && params.api_game_id);
  return useQuery<OddsSnapshotRow[]>({
    queryKey: ['tracking', 'odds-movement', qs],
    queryFn: () =>
      fetchJson<OddsSnapshotRow[]>(`/api/tracking/odds-movement?${qs}`),
    enabled,
  });
}
