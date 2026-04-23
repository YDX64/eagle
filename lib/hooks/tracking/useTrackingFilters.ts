'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MarketFamily, SportCode, TrackingFilters } from './types';

const DEFAULT_WINDOW_DAYS = 30;

const VALID_SPORTS: SportCode[] = [
  'football',
  'basketball',
  'nba',
  'hockey',
  'handball',
  'volleyball',
  'baseball',
];

const VALID_FAMILIES: MarketFamily[] = [
  'match_winner',
  'double_chance',
  'draw_no_bet',
  'handicap',
  'totals',
  'team_totals',
  'btts',
  'ht_ft',
  'correct_score',
  'cards',
  'corners',
  'first_half',
  'second_half',
  'quarter',
  'period',
  'set',
  'innings',
  'player_props',
  'other',
];

function isValidSport(x: string): x is SportCode {
  return (VALID_SPORTS as string[]).includes(x);
}
function isValidFamily(x: string): x is MarketFamily {
  return (VALID_FAMILIES as string[]).includes(x);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - DEFAULT_WINDOW_DAYS);
  return {
    date_from: toIsoDate(start),
    date_to: toIsoDate(end),
  };
}

export function parseFiltersFromSearchParams(
  sp: URLSearchParams
): TrackingFilters {
  const sportsParam = sp.get('sports');
  const sports: SportCode[] = sportsParam
    ? sportsParam.split(',').filter(isValidSport)
    : [];

  const familyParam = sp.get('family');
  const family =
    familyParam && isValidFamily(familyParam) ? familyParam : undefined;

  const defaults = defaultDateRange();

  const date_from = sp.get('date_from') || defaults.date_from;
  const date_to = sp.get('date_to') || defaults.date_to;

  const parseNum = (key: string): number | undefined => {
    const v = sp.get(key);
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    sports,
    date_from,
    date_to,
    family,
    market: sp.get('market') || undefined,
    min_sample: parseNum('min_sample'),
    min_probability: parseNum('min_probability'),
    min_expected_value: parseNum('min_expected_value'),
    only_high_confidence: sp.get('only_high_confidence') === '1' || undefined,
  };
}

export function filtersToQueryString(filters: Partial<TrackingFilters>): string {
  const sp = new URLSearchParams();
  if (filters.sports && filters.sports.length > 0) {
    sp.set('sports', filters.sports.join(','));
  }
  if (filters.date_from) sp.set('date_from', filters.date_from);
  if (filters.date_to) sp.set('date_to', filters.date_to);
  if (filters.family) sp.set('family', filters.family);
  if (filters.market) sp.set('market', filters.market);
  if (filters.min_sample != null) sp.set('min_sample', String(filters.min_sample));
  if (filters.min_probability != null)
    sp.set('min_probability', String(filters.min_probability));
  if (filters.min_expected_value != null)
    sp.set('min_expected_value', String(filters.min_expected_value));
  if (filters.only_high_confidence) sp.set('only_high_confidence', '1');
  return sp.toString();
}

export function useTrackingFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const rawSearchParams = useSearchParams();

  const filters = useMemo<TrackingFilters>(() => {
    const sp = new URLSearchParams(rawSearchParams?.toString() ?? '');
    return parseFiltersFromSearchParams(sp);
  }, [rawSearchParams]);

  const setFilters = useCallback(
    (patch: Partial<TrackingFilters>) => {
      const next: TrackingFilters = { ...filters, ...patch };
      const qs = filtersToQueryString(next);
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url, { scroll: false });
    },
    [filters, pathname, router]
  );

  const resetFilters = useCallback(() => {
    const defaults = defaultDateRange();
    const qs = filtersToQueryString({ sports: [], ...defaults });
    router.replace(`${pathname}?${qs}`, { scroll: false });
  }, [pathname, router]);

  return { filters, setFilters, resetFilters };
}
