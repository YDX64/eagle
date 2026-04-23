/**
 * Odds snapshotter — captures bookmaker odds for fixtures so we can later do
 * opening/closing line value analysis and odds-movement charts.
 *
 * Writes to `odds_snapshots_v2` (cross-sport, shared schema).
 * Uses api-sports' /odds endpoint per sport.
 */

import { trackingPrisma as prisma } from '@/lib/db';
import type { SportCode } from './types';

interface RawBookmaker {
  id: number;
  name: string;
  bets?: Array<{
    id: number;
    name: string;
    values: Array<{
      value: string;
      odd: string;
      handicap?: string;
    }>;
  }>;
}

interface RawOddsResponse {
  response: Array<{
    fixture?: { id: number };
    game?: { id: number };
    league?: any;
    bookmakers: RawBookmaker[];
    update?: string;
  }>;
}

const SPORT_BASE_URLS: Record<SportCode, string> = {
  football: 'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  nba: 'https://v2.nba.api-sports.io',
  hockey: 'https://v1.hockey.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  handball: 'https://v1.handball.api-sports.io',
  baseball: 'https://v1.baseball.api-sports.io',
};

const ODDS_PATH: Record<SportCode, string> = {
  football: '/odds',
  basketball: '/odds',
  nba: '/odds',
  hockey: '/odds',
  volleyball: '/odds',
  handball: '/odds',
  baseball: '/odds',
};

/**
 * Best-effort map of bet name → (market_code, selection parser).
 * Unknown bet types are still saved in raw_data for later processing.
 */
const BET_NAME_CANONICAL: Record<string, { sport?: SportCode; emit: (v: { value: string; odd: string; handicap?: string }) => { market: string; selection: string; line?: number } | null }> = {
  'Match Winner': {
    emit: v => ({ market: 'match_winner', selection: v.value.toLowerCase() }),
  },
  'Home/Away': {
    emit: v => ({ market: 'match_winner', selection: v.value.toLowerCase() }),
  },
  'Double Chance': {
    emit: v => ({ market: 'double_chance', selection: v.value.replace('/', '').toLowerCase() }),
  },
  'Both Teams Score': {
    emit: v => ({ market: 'btts', selection: v.value.toLowerCase() }),
  },
  'Goals Over/Under': {
    emit: v => {
      const line = parseFloat((v.handicap ?? v.value).replace(/[^\d.-]/g, ''));
      return { market: 'total', selection: v.value.toLowerCase().includes('over') ? 'over' : 'under', line };
    },
  },
  'Asian Handicap': {
    emit: v => {
      const line = parseFloat((v.handicap ?? '').replace(/[^\d.-]/g, ''));
      return { market: 'handicap', selection: v.value.toLowerCase(), line };
    },
  },
  'HT/FT Double': {
    emit: v => ({ market: 'ht_ft', selection: v.value.replace('/', '').toUpperCase() }),
  },
  'Cards Over/Under': {
    emit: v => {
      const line = parseFloat((v.handicap ?? v.value).replace(/[^\d.-]/g, ''));
      return { market: 'cards', selection: v.value.toLowerCase().includes('over') ? 'over' : 'under', line };
    },
  },
  'Corners Over Under': {
    emit: v => {
      const line = parseFloat((v.handicap ?? v.value).replace(/[^\d.-]/g, ''));
      return { market: 'corners', selection: v.value.toLowerCase().includes('over') ? 'over' : 'under', line };
    },
  },
  'Handicap Result': {
    emit: v => {
      const line = parseFloat((v.handicap ?? '').replace(/[^\d.-]/g, ''));
      return { market: 'handicap', selection: v.value.toLowerCase(), line };
    },
  },
  'Home Win Either Half': {
    emit: v => ({ market: 'match_winner', selection: 'home' }),
  },
};

function resolveBetMapping(name: string) {
  if (BET_NAME_CANONICAL[name]) return BET_NAME_CANONICAL[name];
  // Heuristic fuzzy fallback for slight naming variants
  const lc = name.toLowerCase();
  if (lc.includes('over') || lc.includes('under')) return BET_NAME_CANONICAL['Goals Over/Under'];
  if (lc.includes('handicap') || lc.includes('spread')) return BET_NAME_CANONICAL['Asian Handicap'];
  if (lc.includes('both teams')) return BET_NAME_CANONICAL['Both Teams Score'];
  if (lc.includes('ht/ft') || lc.includes('halftime/fulltime')) return BET_NAME_CANONICAL['HT/FT Double'];
  if (lc.includes('winner')) return BET_NAME_CANONICAL['Match Winner'];
  return null;
}

async function fetchOdds(sport: SportCode, api_game_id: number) {
  const apiKey = process.env.AWASTATS_API_KEY ?? process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('API key not configured');
  const base = SPORT_BASE_URLS[sport];
  const path = ODDS_PATH[sport];
  const idParam = sport === 'football' ? 'fixture' : 'game';
  const url = `${base}${path}?${idParam}=${api_game_id}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`odds fetch failed: ${res.status}`);
  return (await res.json()) as RawOddsResponse;
}

interface SnapshotResult {
  sport: SportCode;
  api_game_id: number;
  bookmakers: number;
  snapshots_written: number;
}

/**
 * Fetch odds for a single game and write one row per (bookmaker, market, selection).
 * Safe to call repeatedly — each call creates a new timestamp.
 */
export async function snapshotOdds(sport: SportCode, api_game_id: number): Promise<SnapshotResult> {
  const raw = await fetchOdds(sport, api_game_id);
  const game_id = `${sport}:${api_game_id}`;
  let written = 0;
  let bookmakerCount = 0;
  const now = new Date();

  const rows: any[] = [];
  for (const entry of raw.response ?? []) {
    const books = entry.bookmakers ?? [];
    bookmakerCount += books.length;
    for (const book of books) {
      for (const bet of book.bets ?? []) {
        const mapping = resolveBetMapping(bet.name);
        for (const v of bet.values ?? []) {
          const num = parseFloat(v.odd);
          if (!Number.isFinite(num)) continue;
          const norm = mapping?.emit(v) ?? null;
          rows.push({
            sport,
            api_game_id,
            game_id,
            bookmaker_id: book.id,
            bookmaker: book.name,
            market: norm?.market ?? bet.name,
            selection: norm?.selection ?? v.value,
            line: norm?.line ?? (v.handicap ? parseFloat(v.handicap) : null),
            odds_value: num,
            snapshot_at: now,
            raw_data: { bet_name: bet.name, raw_value: v.value, handicap: v.handicap ?? null },
          });
        }
      }
    }
  }

  if (rows.length > 0) {
    // Use createMany with skipDuplicates disabled (no unique constraint); each call is a new snapshot
    await prisma.odds_snapshots_v2.createMany({
      data: rows,
    });
    written = rows.length;
  }

  return {
    sport,
    api_game_id,
    bookmakers: bookmakerCount,
    snapshots_written: written,
  };
}

/** Bulk snapshot a list of games — serialized with a tiny delay to respect rate limits. */
export async function snapshotOddsBulk(
  items: Array<{ sport: SportCode; api_game_id: number }>,
  delay_ms: number = 80,
): Promise<{ total: number; errors: Array<{ sport: string; id: number; error: string }> }> {
  let total = 0;
  const errors: Array<{ sport: string; id: number; error: string }> = [];
  for (const it of items) {
    try {
      const r = await snapshotOdds(it.sport, it.api_game_id);
      total += r.snapshots_written;
    } catch (err) {
      errors.push({ sport: it.sport, id: it.api_game_id, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise(res => setTimeout(res, delay_ms));
  }
  return { total, errors };
}

/** Query odds history for one (sport, game, market) — powers odds-movement charts. */
export async function getOddsHistory(args: { sport: SportCode; api_game_id: number; market?: string; bookmaker?: string; limit?: number }) {
  return prisma.odds_snapshots_v2.findMany({
    where: {
      sport: args.sport,
      api_game_id: args.api_game_id,
      ...(args.market ? { market: args.market } : {}),
      ...(args.bookmaker ? { bookmaker: args.bookmaker } : {}),
    },
    orderBy: { snapshot_at: 'asc' },
    take: args.limit ?? 2000,
  });
}
