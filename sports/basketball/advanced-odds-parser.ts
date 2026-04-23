/**
 * Advanced Basketball Odds Parser
 *
 * API-Basketball (v1.basketball.api-sports.io) exposes 24+ bet types per game.
 * This module parses every market the bookmakers offer into a typed, unified
 * structure ready for prediction engine consumption.
 *
 * Market IDs encountered in production (from live API):
 *   1  — 3Way Result (1 X 2)
 *   2  — Home/Away (moneyline, no draw)
 *   3  — Asian Handicap (spread)
 *   4  — Over/Under (full-time total)
 *   5  — Over/Under 1st Half
 *   6  — Double Chance (1X, X2, 12)
 *   7  — 1st Half 3Way Result
 *   8  — Asian Handicap First Half
 *   9  — Asian Handicap 2nd Qtr
 *   10 — Odd/Even (Including OT)
 *   11 — Odd/Even 1st Half
 *   12 — 3Way Result - 1st Qtr
 *   13 — Double Chance - 1st Qtr
 *   14 — Odd/Even (1st Quarter)
 *   16 — Over/Under 1st Quarter
 *   17 — Home Team Total Points (game)
 *   18 — Away Team Total Points (game)
 *   19 — Home Team Total Points 1st Half
 *   20 — Away Team Total Points 1st Half
 *   21 — Home Team Total Points 1st Quarter
 *   22 — Away Team Total Points 1st Quarter
 *   23 — Asian Handicap 1st Qtr
 *   24 — 2nd Half Over/Under
 *
 * The exact IDs may differ between bookmakers — this parser falls back to
 * market NAME matching when IDs don't match expectations.
 */

export interface BasketballRawOdds {
  // ─── Match Result ───
  moneyline?: { home: number; away: number };         // Home/Away
  threeWay?: { home: number; draw: number; away: number }; // 3Way (with draw, rare)
  doubleChance?: { home_or_draw: number; home_or_away: number; draw_or_away: number };

  // ─── Spreads (Asian Handicap) ───
  spread?: { line: number; home: number; away: number };        // Main spread
  spreadAlternates?: Array<{ line: number; home: number; away: number }>;
  firstHalfSpread?: { line: number; home: number; away: number };
  secondQtrSpread?: { line: number; home: number; away: number };
  firstQtrSpread?: { line: number; home: number; away: number };

  // ─── Totals ───
  total?: { line: number; over: number; under: number };         // Full game
  totalAlternates?: Array<{ line: number; over: number; under: number }>;
  firstHalfTotal?: { line: number; over: number; under: number };
  secondHalfTotal?: { line: number; over: number; under: number };
  firstQtrTotal?: { line: number; over: number; under: number };

  // ─── Team Totals ───
  homeTotal?: { line: number; over: number; under: number };            // Home team total
  awayTotal?: { line: number; over: number; under: number };            // Away team total
  homeFirstHalfTotal?: { line: number; over: number; under: number };
  awayFirstHalfTotal?: { line: number; over: number; under: number };
  homeFirstQtrTotal?: { line: number; over: number; under: number };
  awayFirstQtrTotal?: { line: number; over: number; under: number };

  // ─── 1st Half 3Way ───
  firstHalf3Way?: { home: number; draw: number; away: number };
  firstQtr3Way?: { home: number; draw: number; away: number };
  firstQtrDoubleChance?: { home_or_draw: number; home_or_away: number; draw_or_away: number };

  // ─── Odd/Even ───
  oddEven?: { odd: number; even: number };             // Total points odd/even (incl. OT)
  firstHalfOddEven?: { odd: number; even: number };
  firstQtrOddEven?: { odd: number; even: number };

  // ─── Metadata ───
  bookmaker: string | null;
  bookmakerCount: number;
  rawMarkets: Array<{ id: number; name: string; values: any[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────────────────────────────────────
export function parseBasketballOdds(rawResponse: any[]): BasketballRawOdds | null {
  if (!rawResponse || rawResponse.length === 0) return null;
  const gameOdds = rawResponse[0];
  const bookmakers = gameOdds?.bookmakers;
  if (!bookmakers || bookmakers.length === 0) return null;

  // Average odds across all bookmakers for stability
  const collected: Record<string, number[]> = {};
  const rawMarkets: BasketballRawOdds['rawMarkets'] = [];

  // Also collect line-value maps (for spread/total with multiple lines)
  const spreadLines: Map<number, { home: number[]; away: number[] }> = new Map();
  const totalLines: Map<number, { over: number[]; under: number[] }> = new Map();

  for (const bm of bookmakers) {
    for (const bet of bm.bets || []) {
      const id = bet.id;
      const name = String(bet.name || '').toLowerCase().trim();
      const values: any[] = bet.values || [];
      if (values.length === 0) continue;

      rawMarkets.push({ id, name: bet.name, values });

      // Dispatch by name matching (more robust than ID since bookmakers vary)
      if (name === 'home/away' || (id === 2 && !name.includes('1st') && !name.includes('qtr'))) {
        parseMoneylineInto(values, collected, 'ml');
      } else if (name === '3way result' || (id === 1 && !name.includes('1st') && !name.includes('qtr'))) {
        parse3WayInto(values, collected, '3w');
      } else if (name === 'double chance') {
        parseDoubleChanceInto(values, collected, 'dc');
      }
      // Spreads
      else if (name === 'asian handicap' && !name.includes('1st') && !name.includes('qtr')) {
        parseSpreadInto(values, spreadLines);
      } else if (name === 'asian handicap first half') {
        parseSpreadInto(values, spreadLines, '_fh');
      } else if (name === 'asian handicap 2nd qtr') {
        parseSpreadInto(values, spreadLines, '_q2');
      } else if (name === 'asian handicap 1st qtr') {
        parseSpreadInto(values, spreadLines, '_q1');
      }
      // Totals
      else if (name === 'over/under' && !name.includes('1st') && !name.includes('qtr') && !name.includes('half') && !name.includes('2nd')) {
        parseTotalInto(values, totalLines);
      } else if (name === 'over/under 1st half') {
        parseTotalInto(values, totalLines, '_fh');
      } else if (name === '2nd half over/under') {
        parseTotalInto(values, totalLines, '_sh');
      } else if (name === 'over/under 1st qtr') {
        parseTotalInto(values, totalLines, '_q1');
      }
      // Team totals
      else if (name === 'home team total points' || name === 'home team totals') {
        parseTeamTotalInto(values, collected, 'home_total');
      } else if (name === 'away team total points' || name === 'away team totals') {
        parseTeamTotalInto(values, collected, 'away_total');
      } else if (name === 'home team total goals(1st half)' || name === 'home team total points (1st half)') {
        parseTeamTotalInto(values, collected, 'home_fh_total');
      } else if (name === 'away team total goals(1st half)' || name === 'away team total points (1st half)') {
        parseTeamTotalInto(values, collected, 'away_fh_total');
      } else if (name === 'home team total points (1st quarter)') {
        parseTeamTotalInto(values, collected, 'home_q1_total');
      } else if (name === 'away team total points (1st quarter)') {
        parseTeamTotalInto(values, collected, 'away_q1_total');
      }
      // 1st Half / 1st Qtr 3Way
      else if (name === '1st half 3way result') {
        parse3WayInto(values, collected, '3w_fh');
      } else if (name === '3way result - 1st qtr') {
        parse3WayInto(values, collected, '3w_q1');
      } else if (name === 'double chance (1st quarter)') {
        parseDoubleChanceInto(values, collected, 'dc_q1');
      }
      // Odd/Even
      else if (name === 'odd/even (including ot)' || name === 'odd/even') {
        parseOddEvenInto(values, collected, 'oe');
      } else if (name === 'odd/even 1st half') {
        parseOddEvenInto(values, collected, 'oe_fh');
      } else if (name === 'odd/even (1st quarter)') {
        parseOddEvenInto(values, collected, 'oe_q1');
      }
    }
  }

  // Average collected values
  const avg = (arr: number[]): number | undefined => {
    const valid = (arr || []).filter((v) => Number.isFinite(v) && v > 1.0);
    if (valid.length === 0) return undefined;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
  };

  const getObj = <T extends Record<string, number | undefined>>(prefix: string, fields: string[]): T | undefined => {
    const out: Record<string, number | undefined> = {};
    let hasAny = false;
    for (const f of fields) {
      const v = avg(collected[`${prefix}_${f}`] || []);
      if (v !== undefined) {
        out[f] = v;
        hasAny = true;
      }
    }
    return hasAny ? (out as T) : undefined;
  };

  // Pick the "main" spread line (most liquid = one with most odds entries)
  const pickMainLine = <T>(
    lines: Map<number, any>,
    buildFn: (line: number, data: any) => T
  ): T | undefined => {
    if (lines.size === 0) return undefined;
    let bestLine = 0;
    let bestCount = -1;
    for (const [line, data] of lines) {
      const total = (Object.values(data) as any[][]).reduce(
        (s, arr) => s + (arr?.length || 0),
        0
      );
      if (total > bestCount) {
        bestCount = total;
        bestLine = line;
      }
    }
    return buildFn(bestLine, lines.get(bestLine));
  };

  // Filter lines by suffix (e.g. _fh for first half)
  const filterLinesBySuffix = <T>(
    lines: Map<number, any>,
    suffix: string,
    buildFn: (line: number, data: any) => T
  ): T | undefined => {
    const filtered = new Map<number, any>();
    for (const [line, data] of lines) {
      if ((data as any).__suffix === suffix) {
        filtered.set(line, data);
      }
    }
    return pickMainLine(filtered, buildFn);
  };

  const buildSpread = (line: number, data: any) => ({
    line,
    home: avg(data.home || []) ?? 0,
    away: avg(data.away || []) ?? 0,
  });

  const buildTotal = (line: number, data: any) => ({
    line,
    over: avg(data.over || []) ?? 0,
    under: avg(data.under || []) ?? 0,
  });

  // Main spread = all entries without suffix
  const mainSpreadLines = new Map<number, any>();
  const fhSpreadLines = new Map<number, any>();
  const q2SpreadLines = new Map<number, any>();
  const q1SpreadLines = new Map<number, any>();
  for (const [line, data] of spreadLines) {
    const suffix = (data as any).__suffix || '';
    if (suffix === '') mainSpreadLines.set(line, data);
    else if (suffix === '_fh') fhSpreadLines.set(line, data);
    else if (suffix === '_q2') q2SpreadLines.set(line, data);
    else if (suffix === '_q1') q1SpreadLines.set(line, data);
  }

  const mainTotalLines = new Map<number, any>();
  const fhTotalLines = new Map<number, any>();
  const shTotalLines = new Map<number, any>();
  const q1TotalLines = new Map<number, any>();
  for (const [line, data] of totalLines) {
    const suffix = (data as any).__suffix || '';
    if (suffix === '') mainTotalLines.set(line, data);
    else if (suffix === '_fh') fhTotalLines.set(line, data);
    else if (suffix === '_sh') shTotalLines.set(line, data);
    else if (suffix === '_q1') q1TotalLines.set(line, data);
  }

  const allSpreadAlts: Array<{ line: number; home: number; away: number }> = [];
  for (const [line, data] of mainSpreadLines) {
    allSpreadAlts.push(buildSpread(line, data));
  }
  allSpreadAlts.sort((a, b) => Math.abs(a.line) - Math.abs(b.line));

  const allTotalAlts: Array<{ line: number; over: number; under: number }> = [];
  for (const [line, data] of mainTotalLines) {
    allTotalAlts.push(buildTotal(line, data));
  }
  allTotalAlts.sort((a, b) => a.line - b.line);

  return {
    moneyline: getObj('ml', ['home', 'away']),
    threeWay: getObj('3w', ['home', 'draw', 'away']),
    doubleChance: getObj('dc', ['home_or_draw', 'home_or_away', 'draw_or_away']),

    spread: pickMainLine(mainSpreadLines, buildSpread),
    spreadAlternates: allSpreadAlts.length > 1 ? allSpreadAlts : undefined,
    firstHalfSpread: pickMainLine(fhSpreadLines, buildSpread),
    secondQtrSpread: pickMainLine(q2SpreadLines, buildSpread),
    firstQtrSpread: pickMainLine(q1SpreadLines, buildSpread),

    total: pickMainLine(mainTotalLines, buildTotal),
    totalAlternates: allTotalAlts.length > 1 ? allTotalAlts : undefined,
    firstHalfTotal: pickMainLine(fhTotalLines, buildTotal),
    secondHalfTotal: pickMainLine(shTotalLines, buildTotal),
    firstQtrTotal: pickMainLine(q1TotalLines, buildTotal),

    homeTotal: getObj('home_total', ['line', 'over', 'under']),
    awayTotal: getObj('away_total', ['line', 'over', 'under']),
    homeFirstHalfTotal: getObj('home_fh_total', ['line', 'over', 'under']),
    awayFirstHalfTotal: getObj('away_fh_total', ['line', 'over', 'under']),
    homeFirstQtrTotal: getObj('home_q1_total', ['line', 'over', 'under']),
    awayFirstQtrTotal: getObj('away_q1_total', ['line', 'over', 'under']),

    firstHalf3Way: getObj('3w_fh', ['home', 'draw', 'away']),
    firstQtr3Way: getObj('3w_q1', ['home', 'draw', 'away']),
    firstQtrDoubleChance: getObj('dc_q1', ['home_or_draw', 'home_or_away', 'draw_or_away']),

    oddEven: getObj('oe', ['odd', 'even']),
    firstHalfOddEven: getObj('oe_fh', ['odd', 'even']),
    firstQtrOddEven: getObj('oe_q1', ['odd', 'even']),

    bookmaker: bookmakers[0]?.name || null,
    bookmakerCount: bookmakers.length,
    rawMarkets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-market parsers (collect odds into the average buckets)
// ─────────────────────────────────────────────────────────────────────────────
function parseMoneylineInto(values: any[], out: Record<string, number[]>, prefix: string) {
  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;
    if (label === 'home' || label === '1') (out[`${prefix}_home`] ||= []).push(odd);
    else if (label === 'away' || label === '2') (out[`${prefix}_away`] ||= []).push(odd);
  }
}

function parse3WayInto(values: any[], out: Record<string, number[]>, prefix: string) {
  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;
    if (label === 'home' || label === '1') (out[`${prefix}_home`] ||= []).push(odd);
    else if (label === 'draw' || label === 'x') (out[`${prefix}_draw`] ||= []).push(odd);
    else if (label === 'away' || label === '2') (out[`${prefix}_away`] ||= []).push(odd);
  }
}

function parseDoubleChanceInto(values: any[], out: Record<string, number[]>, prefix: string) {
  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim().replace(/\s/g, '');
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;
    if (label === 'home/draw' || label === '1x') (out[`${prefix}_home_or_draw`] ||= []).push(odd);
    else if (label === 'home/away' || label === '12') (out[`${prefix}_home_or_away`] ||= []).push(odd);
    else if (label === 'draw/away' || label === 'x2') (out[`${prefix}_draw_or_away`] ||= []).push(odd);
  }
}

function parseSpreadInto(
  values: any[],
  lines: Map<number, { home: number[]; away: number[]; __suffix?: string }>,
  suffix: string = ''
) {
  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;

    const numMatch = label.match(/([+-]?\d+(?:\.\d+)?)/);
    if (!numMatch) continue;
    const rawLine = parseFloat(numMatch[1]);
    const lowerLabel = label.toLowerCase();

    let line: number;
    let isHome: boolean;
    if (lowerLabel.includes('home')) {
      line = rawLine; // Home spread
      isHome = true;
    } else if (lowerLabel.includes('away')) {
      line = -rawLine; // Away spread inverts
      isHome = false;
    } else {
      continue;
    }

    // Round to 0.5 precision for bucketing
    const bucketed = Math.round(line * 2) / 2;
    if (!lines.has(bucketed)) {
      lines.set(bucketed, { home: [], away: [], __suffix: suffix });
    }
    const bucket = lines.get(bucketed)!;
    if (isHome) bucket.home.push(odd);
    else bucket.away.push(odd);
  }
}

function parseTotalInto(
  values: any[],
  lines: Map<number, { over: number[]; under: number[]; __suffix?: string }>,
  suffix: string = ''
) {
  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;

    const numMatch = label.match(/(\d+(?:\.\d+)?)/);
    if (!numMatch) continue;
    const line = parseFloat(numMatch[1]);
    const bucketed = Math.round(line * 2) / 2;

    if (!lines.has(bucketed)) {
      lines.set(bucketed, { over: [], under: [], __suffix: suffix });
    }
    const bucket = lines.get(bucketed)!;
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.includes('over')) bucket.over.push(odd);
    else if (lowerLabel.includes('under')) bucket.under.push(odd);
  }
}

/**
 * Team totals come as a single over/under pair with an embedded line, e.g.
 * "Over 110.5" / "Under 110.5". We take the first line found.
 */
function parseTeamTotalInto(values: any[], out: Record<string, number[]>, prefix: string) {
  let line = 0;
  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;

    const numMatch = label.match(/(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const n = parseFloat(numMatch[1]);
      if (line === 0) line = n;
    }

    const lowerLabel = label.toLowerCase();
    if (lowerLabel.includes('over')) (out[`${prefix}_over`] ||= []).push(odd);
    else if (lowerLabel.includes('under')) (out[`${prefix}_under`] ||= []).push(odd);
  }
  if (line > 0) (out[`${prefix}_line`] ||= []).push(line);
}

function parseOddEvenInto(values: any[], out: Record<string, number[]>, prefix: string) {
  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) continue;
    if (label === 'odd') (out[`${prefix}_odd`] ||= []).push(odd);
    else if (label === 'even') (out[`${prefix}_even`] ||= []).push(odd);
  }
}
