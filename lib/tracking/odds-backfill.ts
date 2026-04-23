/**
 * Odds backfill — fill `picks.market_odds` from real bookmaker snapshots
 * captured in `odds_snapshots_v2`.
 *
 * Bookmaker preference: Bet365 > 1xBet > Pinnacle > first available. This
 * matches the user's stated requirement ("baz alabilirsin Bet365").
 *
 * Market matching is heuristic — api-sports' odds feed uses natural-language
 * market names like "3Way Result" / "Goals Over/Under" while our picks use
 * canonical codes (HOME_WIN, OVER_25, …). A mapping table bridges the two.
 */

import { trackingPrisma as prisma } from '@/lib/db';

const BOOKMAKER_PRIORITY = ['Bet365', '1xBet', 'Pinnacle', 'Betano', 'Marathon'];

/**
 * Odds-feed markets that map to the HOME_WIN/AWAY_WIN/DRAW family.
 * (selections vary case + whitespace across bookmakers)
 */
const MATCH_WINNER_MARKETS = [
  'Match Winner',
  'Home/Away',
  '3Way Result',
  'Regular Time',
  'Match Result',
  '1X2',
  'Moneyline',
];

const TOTAL_MARKETS = [
  'Goals Over/Under',
  'Over/Under',
  'Total',
  'Total Points',
  'Total Goals',
];

const BTTS_MARKETS = ['Both Teams Score', 'Both Teams To Score', 'BTTS'];

const DOUBLE_CHANCE_MARKETS = ['Double Chance'];

interface OddsRow {
  bookmaker: string;
  market: string;
  selection: string | null;
  line: number | null;
  odds_value: number;
  snapshot_at: Date;
}

/** Parse the line number out of a market code like OVER_25 → 2.5, HOME_UNDER_35 → 3.5. */
function lineFromCode(code: string): number | null {
  const m = code.match(/(\d+)(?:$|[^\d])/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  return raw < 10 ? raw : raw / 10;
}

/**
 * Given a pick market code and a list of odds snapshots for the same game,
 * pick the best bookmaker-specific match.
 */
function matchOdds(pickMarket: string, snapshots: OddsRow[]): number | null {
  const snaps = snapshots.filter(s => BOOKMAKER_PRIORITY.includes(s.bookmaker) || true);
  const byBookmaker = new Map<string, OddsRow[]>();
  for (const s of snaps) {
    const list = byBookmaker.get(s.bookmaker) ?? [];
    list.push(s);
    byBookmaker.set(s.bookmaker, list);
  }

  const candidates = [
    ...BOOKMAKER_PRIORITY.flatMap(b => byBookmaker.get(b) ?? []),
    ...snaps.filter(s => !BOOKMAKER_PRIORITY.includes(s.bookmaker)),
  ];

  const normSel = (s: string | null) => (s ?? '').trim().toLowerCase();

  // ── Match winner ─────────────────────────────────────────────────────────
  if (pickMarket === 'HOME_WIN' || pickMarket === 'BB_HOME_WIN' || pickMarket === 'HO_HOME_ML' || pickMarket === 'HO_HOME_WIN_REG' || pickMarket === 'HB_HOME_WIN' || pickMarket === 'VB_HOME_WIN' || pickMarket === 'BS_HOME_ML') {
    const hit = candidates.find(s => MATCH_WINNER_MARKETS.some(m => s.market.includes(m)) && ['home', '1'].includes(normSel(s.selection)));
    return hit?.odds_value ?? null;
  }
  if (pickMarket === 'AWAY_WIN' || pickMarket === 'BB_AWAY_WIN' || pickMarket === 'HO_AWAY_ML' || pickMarket === 'HO_AWAY_WIN_REG' || pickMarket === 'HB_AWAY_WIN' || pickMarket === 'VB_AWAY_WIN' || pickMarket === 'BS_AWAY_ML') {
    const hit = candidates.find(s => MATCH_WINNER_MARKETS.some(m => s.market.includes(m)) && ['away', '2'].includes(normSel(s.selection)));
    return hit?.odds_value ?? null;
  }
  if (pickMarket === 'DRAW' || pickMarket === 'HO_DRAW_REG' || pickMarket === 'HB_DRAW') {
    const hit = candidates.find(s => MATCH_WINNER_MARKETS.some(m => s.market.includes(m)) && ['draw', 'x'].includes(normSel(s.selection)));
    return hit?.odds_value ?? null;
  }

  // ── Double chance ─────────────────────────────────────────────────────────
  const dcMap: Record<string, string[]> = {
    DC_1X: ['1x', '1/x', 'home/draw'],
    DC_X2: ['x2', 'x/2', 'draw/away'],
    DC_12: ['12', '1/2', 'home/away'],
  };
  if (dcMap[pickMarket]) {
    const hit = candidates.find(s => DOUBLE_CHANCE_MARKETS.some(m => s.market.includes(m)) && dcMap[pickMarket].includes(normSel(s.selection)));
    return hit?.odds_value ?? null;
  }

  // ── BTTS ─────────────────────────────────────────────────────────────────
  if (pickMarket === 'BTTS_YES' || pickMarket === 'HO_BTTS_YES') {
    const hit = candidates.find(s => BTTS_MARKETS.some(m => s.market.includes(m)) && normSel(s.selection) === 'yes');
    return hit?.odds_value ?? null;
  }
  if (pickMarket === 'BTTS_NO' || pickMarket === 'HO_BTTS_NO') {
    const hit = candidates.find(s => BTTS_MARKETS.some(m => s.market.includes(m)) && normSel(s.selection) === 'no');
    return hit?.odds_value ?? null;
  }

  // ── Totals (Over/Under) — line must match within ±0.05 ───────────────────
  const overUnderMatch = pickMarket.match(/^(OVER|UNDER|HO_OVER|HO_UNDER|HB_OVER|HB_UNDER|BS_OVER|BS_UNDER|BB_OVER|BB_UNDER)_(\d+)$/);
  if (overUnderMatch) {
    const isOver = overUnderMatch[1].endsWith('OVER');
    const pickLine = lineFromCode(pickMarket);
    if (pickLine == null) return null;
    const hit = candidates.find(s => {
      if (!TOTAL_MARKETS.some(m => s.market.includes(m))) return false;
      const sel = normSel(s.selection);
      if (isOver && !sel.startsWith('over')) return false;
      if (!isOver && !sel.startsWith('under')) return false;
      const snapLine = s.line ?? parseFloat((s.selection ?? '').replace(/[^\d.]/g, ''));
      return snapLine != null && Math.abs(snapLine - pickLine) < 0.06;
    });
    return hit?.odds_value ?? null;
  }

  return null;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  already_had_odds: number;
  no_snapshot: number;
  no_match: number;
  by_sport: Record<string, { scanned: number; updated: number }>;
}

/**
 * Backfill pick.market_odds from odds_snapshots_v2 for picks that currently
 * have missing or zero odds. Also updates expected_value when both odds and
 * probability are present.
 *
 * @param limit max picks to process per run (protect memory on huge backlogs)
 * @param onlySport optional sport filter — backfill one sport at a time
 */
export async function backfillPickOdds(args: {
  limit?: number;
  onlySport?: string;
}): Promise<BackfillResult> {
  if (!prisma) {
    throw new Error('tracking DB not configured');
  }
  const limit = args.limit ?? 5000;
  const onlySport = args.onlySport;

  const result: BackfillResult = {
    scanned: 0,
    updated: 0,
    already_had_odds: 0,
    no_snapshot: 0,
    no_match: 0,
    by_sport: {},
  };

  // Pick up picks missing odds, joined with their prediction for sport + fixture_id
  const picks = await prisma.picks.findMany({
    where: {
      OR: [{ market_odds: null }, { market_odds: 0 }],
      predictions: onlySport ? { sport: onlySport } : undefined,
    },
    select: {
      id: true,
      market: true,
      probability: true,
      prediction_id: true,
      predictions: {
        select: { sport: true, fixture_id: true },
      },
    },
    take: limit,
    orderBy: { id: 'desc' },
  });

  // Group picks by (sport, fixture_id) to batch-load odds snapshots
  const byGame = new Map<string, typeof picks>();
  for (const pk of picks) {
    const key = `${pk.predictions.sport}:${pk.predictions.fixture_id}`;
    const list = byGame.get(key) ?? [];
    list.push(pk);
    byGame.set(key, list);
  }

  for (const [key, gamePicks] of byGame) {
    const [sport, fixtureIdStr] = key.split(':');
    const fixture_id = parseInt(fixtureIdStr, 10);
    const sportStats = result.by_sport[sport] ?? { scanned: 0, updated: 0 };

    // Load all snapshots for this game once
    const snapshots = await prisma.odds_snapshots_v2.findMany({
      where: { sport, api_game_id: fixture_id },
      select: {
        bookmaker: true,
        market: true,
        selection: true,
        line: true,
        odds_value: true,
        snapshot_at: true,
      },
      orderBy: { snapshot_at: 'desc' },
    });

    if (snapshots.length === 0) {
      result.no_snapshot += gamePicks.length;
      sportStats.scanned += gamePicks.length;
      result.by_sport[sport] = sportStats;
      continue;
    }

    for (const pk of gamePicks) {
      result.scanned++;
      sportStats.scanned++;
      const odds = matchOdds(pk.market, snapshots);
      if (odds == null) {
        result.no_match++;
        continue;
      }
      const expectedValue = pk.probability != null ? pk.probability * odds - 1 : null;
      await prisma.picks.update({
        where: { id: pk.id },
        data: {
          market_odds: odds,
          expected_value: expectedValue,
        },
      });
      result.updated++;
      sportStats.updated++;
    }
    result.by_sport[sport] = sportStats;
  }

  return result;
}
