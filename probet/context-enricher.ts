/**
 * ProBet Context Enricher
 *
 * Fetches additional contextual data for a fixture from API-Football
 * and condenses it into compact features that boost prediction quality.
 *
 * Endpoints used:
 *   - /injuries        → key player absences
 *   - /odds            → bookmaker consensus + value-bet detection
 *   - /predictions     → API-Football's own prediction (used as ensemble member)
 *   - /fixtures/lineups (optional, slow) — starting XI
 *
 * All fetches are cached aggressively because:
 *   1. They're per-fixture (no league-level reuse)
 *   2. They cost API quota
 *   3. Their values rarely change between fetches in a short window
 */

import { ApiFootballService, type Fixture } from '../api-football';

/**
 * Raw decimal bookmaker odds (averaged across bookmakers).
 * These are the LIVE pre-match odds — used for pattern matching, value bets,
 * and live odds display in the UI.
 */
export interface LiveRawOdds {
  // 1X2
  home: number | null;
  draw: number | null;
  away: number | null;
  // Double Chance
  dc_1x: number | null;
  dc_12: number | null;
  dc_x2: number | null;
  // Draw No Bet
  dnb_home: number | null;
  dnb_away: number | null;
  // Total Goals
  over_05: number | null;
  under_05: number | null;
  over_15: number | null;
  under_15: number | null;
  over_25: number | null;
  under_25: number | null;
  over_35: number | null;
  under_35: number | null;
  over_45: number | null;
  // BTTS
  btts_yes: number | null;
  btts_no: number | null;
  // Half-time markets
  ht_05_over: number | null;
  ht_05_under: number | null;
  ht_15_over: number | null;
  ht_15_under: number | null;
  ht_home: number | null;
  ht_draw: number | null;
  ht_away: number | null;
  ht_btts_yes: number | null;
  // HTFT (9 outcomes) — keys: '1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'
  htft: Record<string, number | null>;
  // Asian Handicap
  ah_home_minus_05: number | null;
  ah_away_plus_05: number | null;
  ah_home_minus_1: number | null;
  ah_away_plus_1: number | null;
  // Correct scores (top 10 most-quoted)
  correct_scores: Record<string, number>;
}

const EMPTY_RAW_ODDS: LiveRawOdds = {
  home: null, draw: null, away: null,
  dc_1x: null, dc_12: null, dc_x2: null,
  dnb_home: null, dnb_away: null,
  over_05: null, under_05: null,
  over_15: null, under_15: null,
  over_25: null, under_25: null,
  over_35: null, under_35: null,
  over_45: null,
  btts_yes: null, btts_no: null,
  ht_05_over: null, ht_05_under: null,
  ht_15_over: null, ht_15_under: null,
  ht_home: null, ht_draw: null, ht_away: null,
  ht_btts_yes: null,
  htft: {},
  ah_home_minus_05: null, ah_away_plus_05: null,
  ah_home_minus_1: null, ah_away_plus_1: null,
  correct_scores: {},
};

export interface ContextExtras {
  // === Injuries ===
  homeInjuredCount: number;
  awayInjuredCount: number;
  homeInjuredKeyPlayers: string[]; // names
  awayInjuredKeyPlayers: string[];
  injuryImpactHome: number; // 0..1, higher = worse for home
  injuryImpactAway: number;

  // === Bookmaker odds (1X2 implied probabilities) ===
  bookmakerHomeProb: number | null;
  bookmakerDrawProb: number | null;
  bookmakerAwayProb: number | null;
  bookmakerOver25Prob: number | null;
  bookmakerUnder25Prob: number | null;
  bookmakerBttsYesProb: number | null;
  bookmakerBttsNoProb: number | null;
  bookmakerCount: number; // how many bookmakers were consulted

  // === Raw decimal odds (15 markets) for pattern matching + UI display ===
  rawOdds: LiveRawOdds;

  // === API-Football prediction (their own model) ===
  apiPredictionWinner: 'HOME' | 'DRAW' | 'AWAY' | null;
  apiPredictionAdvice: string | null;
  apiPredictionPercentHome: number | null;
  apiPredictionPercentDraw: number | null;
  apiPredictionPercentAway: number | null;

  // === Lineups ===
  hasLineups: boolean;
  homeFormation: string | null;
  awayFormation: string | null;

  // === Source flags (which extras were available) ===
  sources: {
    injuries: boolean;
    odds: boolean;
    predictions: boolean;
    lineups: boolean;
  };
}

const EMPTY_EXTRAS: ContextExtras = {
  homeInjuredCount: 0,
  awayInjuredCount: 0,
  homeInjuredKeyPlayers: [],
  awayInjuredKeyPlayers: [],
  injuryImpactHome: 0,
  injuryImpactAway: 0,
  bookmakerHomeProb: null,
  bookmakerDrawProb: null,
  bookmakerAwayProb: null,
  bookmakerOver25Prob: null,
  bookmakerUnder25Prob: null,
  bookmakerBttsYesProb: null,
  bookmakerBttsNoProb: null,
  bookmakerCount: 0,
  rawOdds: { ...EMPTY_RAW_ODDS, htft: {}, correct_scores: {} },
  apiPredictionWinner: null,
  apiPredictionAdvice: null,
  apiPredictionPercentHome: null,
  apiPredictionPercentDraw: null,
  apiPredictionPercentAway: null,
  hasLineups: false,
  homeFormation: null,
  awayFormation: null,
  sources: { injuries: false, odds: false, predictions: false, lineups: false },
};

// Per-process cache for extras (5 min TTL — these change rarely)
const extrasCache = new Map<number, { fetchedAt: number; data: ContextExtras }>();
const EXTRAS_TTL_MS = 5 * 60 * 1000;

/**
 * Average a list of decimal odds. Returns null if list is empty.
 */
function averageOdds(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  const valid = values.filter((v) => Number.isFinite(v) && v > 1.0);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * Find a value entry by trying multiple matchers (case-insensitive).
 */
function findValue(values: any[], matchers: string[]): number | null {
  if (!Array.isArray(values)) return null;
  for (const matcher of matchers) {
    const match = values.find((v: any) => {
      const val = (v?.value || '').toString().toLowerCase().trim();
      return val === matcher.toLowerCase() || val.includes(matcher.toLowerCase());
    });
    if (match?.odd) {
      const parsed = parseFloat(match.odd);
      if (Number.isFinite(parsed) && parsed > 1.0) return parsed;
    }
  }
  return null;
}

/**
 * Average bookmaker odds across multiple bookmakers and convert to implied probabilities.
 * Removes the bookmaker margin (overround). Also extracts raw decimal odds for
 * 15+ markets used by pattern matching and live UI display.
 */
function processOdds(oddsResponse: any[]): Partial<ContextExtras> {
  if (!oddsResponse || oddsResponse.length === 0) return {};

  const bookmakers = oddsResponse[0]?.bookmakers || [];
  if (bookmakers.length === 0) return {};

  // Collect raw odds from all bookmakers (we'll average at the end)
  const collected: Record<string, number[]> = {
    home: [], draw: [], away: [],
    dc_1x: [], dc_12: [], dc_x2: [],
    dnb_home: [], dnb_away: [],
    over_05: [], under_05: [],
    over_15: [], under_15: [],
    over_25: [], under_25: [],
    over_35: [], under_35: [],
    over_45: [],
    btts_yes: [], btts_no: [],
    ht_05_over: [], ht_05_under: [],
    ht_15_over: [], ht_15_under: [],
    ht_home: [], ht_draw: [], ht_away: [],
    ht_btts_yes: [],
    ah_home_minus_05: [], ah_away_plus_05: [],
    ah_home_minus_1: [], ah_away_plus_1: [],
  };
  // HTFT keys: '1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'
  const htftCollected: Record<string, number[]> = {};
  // Correct scores: e.g. '1-0', '2-1', ...
  const csCollected: Record<string, number[]> = {};

  for (const bm of bookmakers) {
    for (const bet of bm.bets || []) {
      const rawName = (bet.name || '').toString();
      const name = rawName.toLowerCase().trim();
      const values = bet.values || [];

      // 1X2 / Match Winner
      if (name === 'match winner' || name === '1x2' || name === 'match-winner') {
        const h = findValue(values, ['Home', '1']);
        const d = findValue(values, ['Draw', 'X']);
        const a = findValue(values, ['Away', '2']);
        if (h) collected.home.push(h);
        if (d) collected.draw.push(d);
        if (a) collected.away.push(a);
      }

      // Double Chance
      if (name === 'double chance') {
        const v1x = findValue(values, ['Home/Draw', '1X', '1/X']);
        const v12 = findValue(values, ['Home/Away', '12', '1/2']);
        const vx2 = findValue(values, ['Draw/Away', 'X2', 'X/2']);
        if (v1x) collected.dc_1x.push(v1x);
        if (v12) collected.dc_12.push(v12);
        if (vx2) collected.dc_x2.push(vx2);
      }

      // Draw No Bet
      if (name === 'draw no bet' || name === 'dnb') {
        const h = findValue(values, ['Home', '1']);
        const a = findValue(values, ['Away', '2']);
        if (h) collected.dnb_home.push(h);
        if (a) collected.dnb_away.push(a);
      }

      // Over/Under (Goals)
      if (name === 'goals over/under' || name === 'over/under') {
        for (const v of values) {
          const val = (v?.value || '').toString().toLowerCase();
          const odd = parseFloat(v?.odd);
          if (!Number.isFinite(odd) || odd <= 1.0) continue;
          if (val === 'over 0.5') collected.over_05.push(odd);
          else if (val === 'under 0.5') collected.under_05.push(odd);
          else if (val === 'over 1.5') collected.over_15.push(odd);
          else if (val === 'under 1.5') collected.under_15.push(odd);
          else if (val === 'over 2.5') collected.over_25.push(odd);
          else if (val === 'under 2.5') collected.under_25.push(odd);
          else if (val === 'over 3.5') collected.over_35.push(odd);
          else if (val === 'under 3.5') collected.under_35.push(odd);
          else if (val === 'over 4.5') collected.over_45.push(odd);
        }
      }

      // BTTS
      if (name === 'both teams to score' || name === 'both teams score') {
        const yes = findValue(values, ['Yes']);
        const no = findValue(values, ['No']);
        if (yes) collected.btts_yes.push(yes);
        if (no) collected.btts_no.push(no);
      }

      // First Half — Over/Under Goals
      if (name === 'first half goals' || name === '1st half over/under' || name === 'first half - over/under') {
        for (const v of values) {
          const val = (v?.value || '').toString().toLowerCase();
          const odd = parseFloat(v?.odd);
          if (!Number.isFinite(odd) || odd <= 1.0) continue;
          if (val === 'over 0.5') collected.ht_05_over.push(odd);
          else if (val === 'under 0.5') collected.ht_05_under.push(odd);
          else if (val === 'over 1.5') collected.ht_15_over.push(odd);
          else if (val === 'under 1.5') collected.ht_15_under.push(odd);
        }
      }

      // First Half Winner (HT 1X2)
      if (name === 'first half winner' || name === '1st half winner' || name === 'half time') {
        const h = findValue(values, ['Home', '1']);
        const d = findValue(values, ['Draw', 'X']);
        const a = findValue(values, ['Away', '2']);
        if (h) collected.ht_home.push(h);
        if (d) collected.ht_draw.push(d);
        if (a) collected.ht_away.push(a);
      }

      // First Half BTTS
      if (name === '1st half btts' || name === 'first half - both teams to score') {
        const yes = findValue(values, ['Yes']);
        if (yes) collected.ht_btts_yes.push(yes);
      }

      // HT/FT (Halftime/Fulltime double)
      if (name === 'ht/ft double' || name === 'halftime/fulltime' || name === 'ht/ft' || name === 'half time/full time') {
        for (const v of values) {
          const valRaw = (v?.value || '').toString();
          const val = valRaw.toLowerCase().replace(/\s/g, '');
          const odd = parseFloat(v?.odd);
          if (!Number.isFinite(odd) || odd <= 1.0) continue;
          // Map possible value forms to canonical "X/Y" key
          let key: string | null = null;
          if (val === 'home/home' || val === '1/1') key = '1/1';
          else if (val === 'home/draw' || val === '1/x') key = '1/X';
          else if (val === 'home/away' || val === '1/2') key = '1/2';
          else if (val === 'draw/home' || val === 'x/1') key = 'X/1';
          else if (val === 'draw/draw' || val === 'x/x') key = 'X/X';
          else if (val === 'draw/away' || val === 'x/2') key = 'X/2';
          else if (val === 'away/home' || val === '2/1') key = '2/1';
          else if (val === 'away/draw' || val === '2/x') key = '2/X';
          else if (val === 'away/away' || val === '2/2') key = '2/2';
          if (key) {
            if (!htftCollected[key]) htftCollected[key] = [];
            htftCollected[key].push(odd);
          }
        }
      }

      // Correct Score (top 10)
      if (name === 'correct score' || name === 'exact score') {
        for (const v of values) {
          const val = (v?.value || '').toString().trim().replace(/:/g, '-').replace(/\s/g, '');
          const odd = parseFloat(v?.odd);
          if (!Number.isFinite(odd) || odd <= 1.0) continue;
          // Only accept "N-M" form
          if (/^\d+-\d+$/.test(val)) {
            if (!csCollected[val]) csCollected[val] = [];
            csCollected[val].push(odd);
          }
        }
      }

      // Asian Handicap
      if (name === 'asian handicap') {
        for (const v of values) {
          const valRaw = (v?.value || '').toString().toLowerCase();
          const odd = parseFloat(v?.odd);
          if (!Number.isFinite(odd) || odd <= 1.0) continue;
          if (valRaw === 'home -0.5' || valRaw === 'home (-0.5)') collected.ah_home_minus_05.push(odd);
          else if (valRaw === 'away +0.5' || valRaw === 'away (+0.5)') collected.ah_away_plus_05.push(odd);
          else if (valRaw === 'home -1' || valRaw === 'home (-1.0)') collected.ah_home_minus_1.push(odd);
          else if (valRaw === 'away +1' || valRaw === 'away (+1.0)') collected.ah_away_plus_1.push(odd);
        }
      }
    }
  }

  // Build raw odds object — average across bookmakers
  const rawOdds: LiveRawOdds = {
    home: averageOdds(collected.home),
    draw: averageOdds(collected.draw),
    away: averageOdds(collected.away),
    dc_1x: averageOdds(collected.dc_1x),
    dc_12: averageOdds(collected.dc_12),
    dc_x2: averageOdds(collected.dc_x2),
    dnb_home: averageOdds(collected.dnb_home),
    dnb_away: averageOdds(collected.dnb_away),
    over_05: averageOdds(collected.over_05),
    under_05: averageOdds(collected.under_05),
    over_15: averageOdds(collected.over_15),
    under_15: averageOdds(collected.under_15),
    over_25: averageOdds(collected.over_25),
    under_25: averageOdds(collected.under_25),
    over_35: averageOdds(collected.over_35),
    under_35: averageOdds(collected.under_35),
    over_45: averageOdds(collected.over_45),
    btts_yes: averageOdds(collected.btts_yes),
    btts_no: averageOdds(collected.btts_no),
    ht_05_over: averageOdds(collected.ht_05_over),
    ht_05_under: averageOdds(collected.ht_05_under),
    ht_15_over: averageOdds(collected.ht_15_over),
    ht_15_under: averageOdds(collected.ht_15_under),
    ht_home: averageOdds(collected.ht_home),
    ht_draw: averageOdds(collected.ht_draw),
    ht_away: averageOdds(collected.ht_away),
    ht_btts_yes: averageOdds(collected.ht_btts_yes),
    htft: {},
    ah_home_minus_05: averageOdds(collected.ah_home_minus_05),
    ah_away_plus_05: averageOdds(collected.ah_away_plus_05),
    ah_home_minus_1: averageOdds(collected.ah_home_minus_1),
    ah_away_plus_1: averageOdds(collected.ah_away_plus_1),
    correct_scores: {},
  };
  // Average HTFT
  for (const [key, odds] of Object.entries(htftCollected)) {
    rawOdds.htft[key] = averageOdds(odds);
  }
  // Average correct scores
  for (const [key, odds] of Object.entries(csCollected)) {
    const avg = averageOdds(odds);
    if (avg !== null) rawOdds.correct_scores[key] = avg;
  }

  // Build implied probability estimates from raw odds (overround removed)
  const result: Partial<ContextExtras> = {
    bookmakerCount: bookmakers.length,
    rawOdds,
  };

  // 1X2 implied probabilities (overround-removed)
  if (rawOdds.home && rawOdds.draw && rawOdds.away) {
    const ih = 1 / rawOdds.home;
    const id = 1 / rawOdds.draw;
    const ia = 1 / rawOdds.away;
    const margin = ih + id + ia;
    result.bookmakerHomeProb = ih / margin;
    result.bookmakerDrawProb = id / margin;
    result.bookmakerAwayProb = ia / margin;
  }

  // Over/Under 2.5 implied probability
  if (rawOdds.over_25 && rawOdds.under_25) {
    const io = 1 / rawOdds.over_25;
    const iu = 1 / rawOdds.under_25;
    const margin = io + iu;
    result.bookmakerOver25Prob = io / margin;
    result.bookmakerUnder25Prob = iu / margin;
  }

  // BTTS implied probability
  if (rawOdds.btts_yes && rawOdds.btts_no) {
    const iy = 1 / rawOdds.btts_yes;
    const inn = 1 / rawOdds.btts_no;
    const margin = iy + inn;
    result.bookmakerBttsYesProb = iy / margin;
    result.bookmakerBttsNoProb = inn / margin;
  }

  return result;
}

/**
 * Build a flat snapshot from rawOdds — for matching against odds-patterns
 * conditions. Maps to the OddsMarketKey format.
 */
export function rawOddsToSnapshot(rawOdds: LiveRawOdds | null): Record<string, number> {
  if (!rawOdds) return {};
  const snap: Record<string, number> = {};
  const set = (key: string, v: number | null | undefined) => {
    if (v !== null && v !== undefined && Number.isFinite(v) && v > 1.0) {
      snap[key] = v;
    }
  };
  set('MS1_CLOSE', rawOdds.home);
  set('MSX_CLOSE', rawOdds.draw);
  set('MS2_CLOSE', rawOdds.away);
  set('DC_1X_CLOSE', rawOdds.dc_1x);
  set('DC_12_CLOSE', rawOdds.dc_12);
  set('DC_X2_CLOSE', rawOdds.dc_x2);
  set('DNB_1_CLOSE', rawOdds.dnb_home);
  set('DNB_2_CLOSE', rawOdds.dnb_away);
  set('OVER_05_CLOSE', rawOdds.over_05);
  set('UNDER_05_CLOSE', rawOdds.under_05);
  set('OVER_15_CLOSE', rawOdds.over_15);
  set('UNDER_15_CLOSE', rawOdds.under_15);
  set('OVER_25_CLOSE', rawOdds.over_25);
  set('UNDER_25_CLOSE', rawOdds.under_25);
  set('OVER_35_CLOSE', rawOdds.over_35);
  set('UNDER_35_CLOSE', rawOdds.under_35);
  set('OVER_45_CLOSE', rawOdds.over_45);
  set('BTTS_YES_CLOSE', rawOdds.btts_yes);
  set('BTTS_NO_CLOSE', rawOdds.btts_no);
  set('HT_05_OVER_CLOSE', rawOdds.ht_05_over);
  set('HT_05_UNDER_CLOSE', rawOdds.ht_05_under);
  set('HT_15_OVER_CLOSE', rawOdds.ht_15_over);
  set('HT_15_UNDER_CLOSE', rawOdds.ht_15_under);
  set('HT_MS1_CLOSE', rawOdds.ht_home);
  set('HT_MSX_CLOSE', rawOdds.ht_draw);
  set('HT_MS2_CLOSE', rawOdds.ht_away);
  set('HT_BTTS_CLOSE', rawOdds.ht_btts_yes);
  set('HTFT_11_CLOSE', rawOdds.htft['1/1'] ?? null);
  set('HTFT_1X_CLOSE', rawOdds.htft['1/X'] ?? null);
  set('HTFT_12_CLOSE', rawOdds.htft['1/2'] ?? null);
  set('HTFT_X1_CLOSE', rawOdds.htft['X/1'] ?? null);
  set('HTFT_XX_CLOSE', rawOdds.htft['X/X'] ?? null);
  set('HTFT_X2_CLOSE', rawOdds.htft['X/2'] ?? null);
  set('HTFT_21_CLOSE', rawOdds.htft['2/1'] ?? null);
  set('HTFT_2X_CLOSE', rawOdds.htft['2/X'] ?? null);
  set('HTFT_22_CLOSE', rawOdds.htft['2/2'] ?? null);
  return snap;
}

function processInjuries(
  injuries: any[],
  homeId: number,
  awayId: number
): Partial<ContextExtras> {
  if (!injuries || injuries.length === 0) return {};

  const homeInjured: string[] = [];
  const awayInjured: string[] = [];
  for (const i of injuries) {
    const teamId = i.team?.id;
    const playerName = i.player?.name || 'Unknown';
    if (teamId === homeId) homeInjured.push(playerName);
    else if (teamId === awayId) awayInjured.push(playerName);
  }
  // Impact = number of injured / 11 starters, capped at 1
  const injuryImpactHome = Math.min(homeInjured.length / 11, 1);
  const injuryImpactAway = Math.min(awayInjured.length / 11, 1);
  return {
    homeInjuredCount: homeInjured.length,
    awayInjuredCount: awayInjured.length,
    homeInjuredKeyPlayers: homeInjured.slice(0, 5),
    awayInjuredKeyPlayers: awayInjured.slice(0, 5),
    injuryImpactHome,
    injuryImpactAway,
  };
}

function processPredictions(pred: any): Partial<ContextExtras> {
  if (!pred || !pred.predictions) return {};

  const winner = pred.predictions.winner?.id;
  const advice = pred.predictions.advice ?? null;
  const percent = pred.predictions.percent || {};
  const home = percent.home ? parseFloat(percent.home.replace('%', '')) / 100 : null;
  const draw = percent.draw ? parseFloat(percent.draw.replace('%', '')) / 100 : null;
  const away = percent.away ? parseFloat(percent.away.replace('%', '')) / 100 : null;

  let winnerLabel: 'HOME' | 'DRAW' | 'AWAY' | null = null;
  if (winner) {
    if (winner === pred.teams?.home?.id) winnerLabel = 'HOME';
    else if (winner === pred.teams?.away?.id) winnerLabel = 'AWAY';
  }
  if (!winnerLabel && draw && home && away) {
    if (draw > home && draw > away) winnerLabel = 'DRAW';
  }

  return {
    apiPredictionWinner: winnerLabel,
    apiPredictionAdvice: advice,
    apiPredictionPercentHome: home,
    apiPredictionPercentDraw: draw,
    apiPredictionPercentAway: away,
  };
}

function processLineups(lineups: any[]): Partial<ContextExtras> {
  if (!lineups || lineups.length < 2) return {};
  return {
    hasLineups: true,
    homeFormation: lineups[0]?.formation ?? null,
    awayFormation: lineups[1]?.formation ?? null,
  };
}

/**
 * Fetch ALL extras for a fixture in parallel and merge.
 * Failures in any single endpoint are silently ignored.
 */
export async function fetchContextExtras(fixture: Fixture): Promise<ContextExtras> {
  const fixtureId = fixture.fixture.id;
  const homeId = fixture.teams.home.id;
  const awayId = fixture.teams.away.id;

  // Cache check
  const cached = extrasCache.get(fixtureId);
  if (cached && Date.now() - cached.fetchedAt < EXTRAS_TTL_MS) {
    return cached.data;
  }

  // Parallel fetches
  const [injuries, odds, predictions, lineups] = await Promise.allSettled([
    ApiFootballService.getInjuries({ fixture: fixtureId }),
    ApiFootballService.getOdds(fixtureId),
    ApiFootballService.getPredictions(fixtureId),
    ApiFootballService.getLineups(fixtureId),
  ]);

  const extras: ContextExtras = { ...EMPTY_EXTRAS };

  if (injuries.status === 'fulfilled' && injuries.value.length > 0) {
    Object.assign(extras, processInjuries(injuries.value, homeId, awayId));
    extras.sources.injuries = true;
  }

  if (odds.status === 'fulfilled' && odds.value.length > 0) {
    Object.assign(extras, processOdds(odds.value));
    extras.sources.odds = true;
  }

  if (predictions.status === 'fulfilled' && predictions.value) {
    Object.assign(extras, processPredictions(predictions.value));
    extras.sources.predictions = true;
  }

  if (lineups.status === 'fulfilled' && lineups.value.length >= 2) {
    Object.assign(extras, processLineups(lineups.value));
    extras.sources.lineups = true;
  }

  extrasCache.set(fixtureId, { fetchedAt: Date.now(), data: extras });
  return extras;
}

/**
 * Compute the value-bet edge between model probability and bookmaker implied probability.
 * Positive edge → model thinks the outcome is more likely than the market suggests.
 *
 * Returns null if no bookmaker data is available.
 */
export function computeValueEdge(
  modelProb: number,
  bookmakerProb: number | null
): number | null {
  if (bookmakerProb === null || bookmakerProb <= 0) return null;
  return modelProb - bookmakerProb;
}
