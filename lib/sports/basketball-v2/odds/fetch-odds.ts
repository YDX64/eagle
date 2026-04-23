/**
 * Real Bookmaker Odds Fetcher
 *
 * Fetches live odds from basketball-api v1 for NBA games (league=12).
 * The basketball-api exposes 11+ bookmakers (Marathon Bet, 1xBet, Bet365, etc.)
 * with 50+ markets per game: moneyline, spreads, totals, halves, quarters,
 * odd/even, double chance, and more.
 *
 * Strategy:
 *   1. Fetch /odds?game=X OR /odds?season=Y&league=Z (for multi-game cache)
 *   2. Average odds across all bookmakers for robustness
 *   3. Return a simplified ParsedOdds structure ready for EV comparison
 *
 * Why average: single-bookmaker odds can be stale or biased. Averaging 11
 * bookmakers gives a more accurate "market consensus" line.
 */

const BASE_URL = 'https://v1.basketball.api-sports.io';
const API_KEY = process.env.API_FOOTBALL_KEY || '';

// In-memory cache for odds (10 min TTL — odds move, but not every second)
const oddsCache = new Map<string, { data: any; expiresAt: number }>();
const ODDS_TTL_MS = 10 * 60 * 1000;

export interface OddsLine {
  line?: number;          // For total/handicap markets
  selection: string;      // "Home", "Away", "Over", "Under", etc.
  odds: number;           // Decimal odds (averaged across bookmakers)
  bookmakerCount: number; // How many bookmakers offered this
}

export interface ParsedOdds {
  gameId: number;
  bookmakerCount: number;

  // Main markets
  moneyline?: { home: number; away: number };
  spread?: { line: number; home: number; away: number };
  total?: { line: number; over: number; under: number };

  // Alternate lines (multi-line markets)
  spreadAlts: Array<{ line: number; home: number; away: number }>;
  totalAlts: Array<{ line: number; over: number; under: number }>;

  // Team totals
  homeTotal?: { line: number; over: number; under: number };
  awayTotal?: { line: number; over: number; under: number };

  // Periods
  firstHalf?: {
    moneyline?: { home: number; away: number };
    total?: { line: number; over: number; under: number };
  };
  secondHalf?: {
    moneyline?: { home: number; away: number };
    total?: { line: number; over: number; under: number };
  };
  q1?: { moneyline?: { home: number; away: number }; total?: { line: number; over: number; under: number } };
  q2?: { moneyline?: { home: number; away: number } };
  q3?: { moneyline?: { home: number; away: number } };
  q4?: { moneyline?: { home: number; away: number } };

  // Specials
  oddEven?: { odd: number; even: number };
  doubleChance?: { homeOrDraw: number; drawOrAway: number; homeOrAway: number };
  highestScoringHalf?: { first: number; second: number };
}

/**
 * Fetch raw odds for a single game. Returns null if no odds available.
 */
export async function fetchGameOdds(gameId: number): Promise<ParsedOdds | null> {
  const cacheKey = `game:${gameId}`;
  const cached = oddsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const url = `${BASE_URL}/odds?game=${gameId}`;
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': API_KEY,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const games: any[] = json.response || [];
    if (games.length === 0) return null;

    const parsed = parseGameOdds(gameId, games[0]);
    oddsCache.set(cacheKey, { data: parsed, expiresAt: Date.now() + ODDS_TTL_MS });
    return parsed;
  } catch (err) {
    console.error('[fetch-odds] failed:', err);
    return null;
  }
}

/**
 * Parse a raw odds response into simplified structure.
 * Averages odds across all bookmakers.
 */
function parseGameOdds(gameId: number, raw: any): ParsedOdds {
  const bookmakers: any[] = raw.bookmakers || [];
  const parsed: ParsedOdds = {
    gameId,
    bookmakerCount: bookmakers.length,
    spreadAlts: [],
    totalAlts: [],
  };

  // Aggregators: each is a Map from selection-key → array of odds
  const moneyline: { home: number[]; away: number[] } = { home: [], away: [] };
  const spread: Map<number, { home: number[]; away: number[] }> = new Map();
  const total: Map<number, { over: number[]; under: number[] }> = new Map();
  const homeTotal: Map<number, { over: number[]; under: number[] }> = new Map();
  const awayTotal: Map<number, { over: number[]; under: number[] }> = new Map();

  const fhMoneyline: { home: number[]; away: number[] } = { home: [], away: [] };
  const fhTotal: Map<number, { over: number[]; under: number[] }> = new Map();
  const shMoneyline: { home: number[]; away: number[] } = { home: [], away: [] };
  const shTotal: Map<number, { over: number[]; under: number[] }> = new Map();

  const oddEven: { odd: number[]; even: number[] } = { odd: [], even: [] };
  const doubleChance: { hd: number[]; da: number[]; ha: number[] } = { hd: [], da: [], ha: [] };
  const highestHalf: { first: number[]; second: number[] } = { first: [], second: [] };

  for (const bm of bookmakers) {
    for (const bet of bm.bets || []) {
      const name = String(bet.name || '').toLowerCase().trim();
      const values: any[] = bet.values || [];

      // Helper: safely parse odds
      const parseOdd = (v: any): number | null => {
        if (!v || !v.odd) return null;
        const n = parseFloat(v.odd);
        return Number.isFinite(n) && n > 1.0 ? n : null;
      };

      if (name === 'home/away') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === 'Home') moneyline.home.push(o);
          else if (v.value === 'Away') moneyline.away.push(o);
        }
      } else if (name === '3way result') {
        // Same as home/away but with draw option
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === 'Home') moneyline.home.push(o);
          else if (v.value === 'Away') moneyline.away.push(o);
        }
      } else if (name === 'asian handicap') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          const parsed = parseHandicapValue(v.value);
          if (!parsed) continue;
          const { side, line } = parsed;
          if (!spread.has(line)) spread.set(line, { home: [], away: [] });
          spread.get(line)![side].push(o);
        }
      } else if (name === 'over/under') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          const parsed = parseTotalValue(v.value);
          if (!parsed) continue;
          const { side, line } = parsed;
          if (!total.has(line)) total.set(line, { over: [], under: [] });
          total.get(line)![side].push(o);
        }
      } else if (name === 'home team total points') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          const parsed = parseTotalValue(v.value);
          if (!parsed) continue;
          if (!homeTotal.has(parsed.line)) homeTotal.set(parsed.line, { over: [], under: [] });
          homeTotal.get(parsed.line)![parsed.side].push(o);
        }
      } else if (name === 'away team total points') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          const parsed = parseTotalValue(v.value);
          if (!parsed) continue;
          if (!awayTotal.has(parsed.line)) awayTotal.set(parsed.line, { over: [], under: [] });
          awayTotal.get(parsed.line)![parsed.side].push(o);
        }
      } else if (name === 'over/under 1st half') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          const parsed = parseTotalValue(v.value);
          if (!parsed) continue;
          if (!fhTotal.has(parsed.line)) fhTotal.set(parsed.line, { over: [], under: [] });
          fhTotal.get(parsed.line)![parsed.side].push(o);
        }
      } else if (name === '2nd half over/under' || name === 'over/under 2nd half') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          const parsed = parseTotalValue(v.value);
          if (!parsed) continue;
          if (!shTotal.has(parsed.line)) shTotal.set(parsed.line, { over: [], under: [] });
          shTotal.get(parsed.line)![parsed.side].push(o);
        }
      } else if (name === '1st half 3way result' || name === '1st half home/away') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === 'Home') fhMoneyline.home.push(o);
          else if (v.value === 'Away') fhMoneyline.away.push(o);
        }
      } else if (name === '2nd half 3way result' || name === '2nd half home/away') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === 'Home') shMoneyline.home.push(o);
          else if (v.value === 'Away') shMoneyline.away.push(o);
        }
      } else if (name === 'odd/even (including ot)' || name === 'odd/even') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === 'Odd') oddEven.odd.push(o);
          else if (v.value === 'Even') oddEven.even.push(o);
        }
      } else if (name === 'highest scoring half') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === '1st Half') highestHalf.first.push(o);
          else if (v.value === '2nd Half') highestHalf.second.push(o);
        }
      } else if (name === 'double chance') {
        for (const v of values) {
          const o = parseOdd(v);
          if (o === null) continue;
          if (v.value === 'Home/Draw') doubleChance.hd.push(o);
          else if (v.value === 'Draw/Away') doubleChance.da.push(o);
          else if (v.value === 'Home/Away') doubleChance.ha.push(o);
        }
      }
    }
  }

  // Average collected values
  const avg = (arr: number[]): number | undefined =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : undefined;

  if (moneyline.home.length > 0 || moneyline.away.length > 0) {
    parsed.moneyline = {
      home: avg(moneyline.home) ?? 0,
      away: avg(moneyline.away) ?? 0,
    };
  }

  // Spread: pick the most liquid line (most bookmaker data)
  if (spread.size > 0) {
    const mainLine = pickMostLiquid(spread);
    if (mainLine !== null) {
      const data = spread.get(mainLine)!;
      parsed.spread = {
        line: mainLine,
        home: avg(data.home) ?? 0,
        away: avg(data.away) ?? 0,
      };
    }
    // Store all alternate lines
    parsed.spreadAlts = Array.from(spread.entries())
      .map(([line, data]) => ({
        line,
        home: avg(data.home) ?? 0,
        away: avg(data.away) ?? 0,
      }))
      .filter((l) => l.home > 0 && l.away > 0)
      .sort((a, b) => a.line - b.line);
  }

  if (total.size > 0) {
    const mainLine = pickMostLiquid(total);
    if (mainLine !== null) {
      const data = total.get(mainLine)!;
      parsed.total = {
        line: mainLine,
        over: avg(data.over) ?? 0,
        under: avg(data.under) ?? 0,
      };
    }
    parsed.totalAlts = Array.from(total.entries())
      .map(([line, data]) => ({
        line,
        over: avg(data.over) ?? 0,
        under: avg(data.under) ?? 0,
      }))
      .filter((l) => l.over > 0 && l.under > 0)
      .sort((a, b) => a.line - b.line);
  }

  if (homeTotal.size > 0) {
    const mainLine = pickMostLiquid(homeTotal);
    if (mainLine !== null) {
      const data = homeTotal.get(mainLine)!;
      parsed.homeTotal = {
        line: mainLine,
        over: avg(data.over) ?? 0,
        under: avg(data.under) ?? 0,
      };
    }
  }

  if (awayTotal.size > 0) {
    const mainLine = pickMostLiquid(awayTotal);
    if (mainLine !== null) {
      const data = awayTotal.get(mainLine)!;
      parsed.awayTotal = {
        line: mainLine,
        over: avg(data.over) ?? 0,
        under: avg(data.under) ?? 0,
      };
    }
  }

  if (fhMoneyline.home.length > 0 || fhTotal.size > 0) {
    parsed.firstHalf = {};
    if (fhMoneyline.home.length > 0) {
      parsed.firstHalf.moneyline = {
        home: avg(fhMoneyline.home) ?? 0,
        away: avg(fhMoneyline.away) ?? 0,
      };
    }
    if (fhTotal.size > 0) {
      const mainLine = pickMostLiquid(fhTotal);
      if (mainLine !== null) {
        const data = fhTotal.get(mainLine)!;
        parsed.firstHalf.total = {
          line: mainLine,
          over: avg(data.over) ?? 0,
          under: avg(data.under) ?? 0,
        };
      }
    }
  }

  if (shMoneyline.home.length > 0 || shTotal.size > 0) {
    parsed.secondHalf = {};
    if (shMoneyline.home.length > 0) {
      parsed.secondHalf.moneyline = {
        home: avg(shMoneyline.home) ?? 0,
        away: avg(shMoneyline.away) ?? 0,
      };
    }
    if (shTotal.size > 0) {
      const mainLine = pickMostLiquid(shTotal);
      if (mainLine !== null) {
        const data = shTotal.get(mainLine)!;
        parsed.secondHalf.total = {
          line: mainLine,
          over: avg(data.over) ?? 0,
          under: avg(data.under) ?? 0,
        };
      }
    }
  }

  if (oddEven.odd.length > 0) {
    parsed.oddEven = {
      odd: avg(oddEven.odd) ?? 0,
      even: avg(oddEven.even) ?? 0,
    };
  }

  if (doubleChance.hd.length > 0 || doubleChance.ha.length > 0) {
    parsed.doubleChance = {
      homeOrDraw: avg(doubleChance.hd) ?? 0,
      drawOrAway: avg(doubleChance.da) ?? 0,
      homeOrAway: avg(doubleChance.ha) ?? 0,
    };
  }

  if (highestHalf.first.length > 0) {
    parsed.highestScoringHalf = {
      first: avg(highestHalf.first) ?? 0,
      second: avg(highestHalf.second) ?? 0,
    };
  }

  return parsed;
}

/**
 * Parse handicap value like "Home -5.5" or "Away +3" → { side, line }.
 */
function parseHandicapValue(value: string): { side: 'home' | 'away'; line: number } | null {
  const m = value.match(/^(Home|Away)\s+([+-]?\d+\.?\d*)$/i);
  if (!m) return null;
  return {
    side: m[1].toLowerCase() as 'home' | 'away',
    line: parseFloat(m[2]),
  };
}

/**
 * Parse total value like "Over 229.5" or "Under 225" → { side, line }.
 */
function parseTotalValue(value: string): { side: 'over' | 'under'; line: number } | null {
  const m = value.match(/^(Over|Under)\s+(\d+\.?\d*)$/i);
  if (!m) return null;
  return {
    side: m[1].toLowerCase() as 'over' | 'under',
    line: parseFloat(m[2]),
  };
}

/**
 * Pick the line with most bookmaker data (highest liquidity).
 * This is the "market main line" because it's where the money is.
 */
function pickMostLiquid(lines: Map<number, any>): number | null {
  let bestLine: number | null = null;
  let bestCount = -1;
  for (const [line, data] of lines) {
    const total = (Object.values(data) as number[][]).reduce((s, arr) => s + arr.length, 0);
    if (total > bestCount) {
      bestCount = total;
      bestLine = line;
    }
  }
  return bestLine;
}
