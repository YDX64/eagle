/**
 * Engine → NormalizedPrediction adapter.
 *
 * Every sport engine in this project emits a slightly different shape:
 *  - Football engines: AdvancedPredictionEngine, EnhancedPredictionEngine,
 *    PredictionEngine (each returns match_winner + btts + over/under + cards + corners)
 *  - Basketball, Hockey, Handball, Volleyball, Baseball engines:
 *    SportPredictionResult (match_result + over/under + spread/handicap + value_bets
 *    + high/medium/high_risk_bets arrays)
 *
 * This module normalizes all of them into NormalizedPrediction so the persister
 * can write them uniformly to `predictions` + `picks`.
 */

import type {
  NormalizedPick,
  NormalizedPrediction,
  SportCode,
} from './types';
import { getMarket } from './market-taxonomy';

// ============================================================================
// Utilities
// ============================================================================

function lineCode(line: number): string {
  // 2.5 -> "25", 10.5 -> "105", -1.5 -> "MINUS_15"
  if (line < 0) return `MINUS_${Math.round(Math.abs(line) * 10)}`;
  return Math.round(line * 10).toString();
}

function probabilityToOdds(prob: number): number {
  if (prob <= 0) return 1000;
  if (prob >= 1) return 1;
  return Number((1 / prob).toFixed(3));
}

function computeEV(prob: number, odds: number | undefined): number | undefined {
  if (!odds || odds <= 1) return undefined;
  return Number((prob * odds - 1).toFixed(4));
}

function tierFromProb(p: number): 'platinum' | 'gold' | 'silver' | undefined {
  if (p >= 0.75) return 'platinum';
  if (p >= 0.65) return 'gold';
  if (p >= 0.55) return 'silver';
  return undefined;
}

// ============================================================================
// Sport engine output → market code mapping
// ============================================================================

/** Normalize an engine `market` + `selection` into a canonical market_taxonomy code. */
export function normalizeMarketCode(args: {
  sport: SportCode;
  market: string;
  selection: string;
  line?: number;
}): string {
  const { sport, market, selection, line } = args;
  const m = market.toLowerCase();
  const s = selection.toLowerCase();

  // ===== FOOTBALL =====
  if (sport === 'football') {
    if (m === '1x2' || m === 'match_winner' || m === 'match_result') {
      if (s === 'home' || s === 'home_win' || s === '1') return 'HOME_WIN';
      if (s === 'away' || s === 'away_win' || s === '2') return 'AWAY_WIN';
      if (s === 'draw' || s === 'x') return 'DRAW';
    }
    if (m === 'btts' || m === 'both_teams_score') {
      return s === 'yes' ? 'BTTS_YES' : 'BTTS_NO';
    }
    if (m === 'double_chance' || m === 'dc') {
      if (s === '1x' || s === 'home_draw') return 'DC_1X';
      if (s === 'x2' || s === 'draw_away') return 'DC_X2';
      if (s === '12' || s === 'home_away') return 'DC_12';
    }
    if (m === 'dnb' || m === 'draw_no_bet') {
      return s === 'home' ? 'DNB_HOME' : 'DNB_AWAY';
    }
    if (m === 'total' || m === 'totals' || m === 'over_under' || m === 'goals') {
      const lineVal = line ?? parseFloat(s.replace(/[^\d.]/g, ''));
      const code = lineCode(lineVal);
      if (s.includes('over')) return `OVER_${code}`;
      if (s.includes('under')) return `UNDER_${code}`;
    }
    if (m === 'team_total' || m === 'team_totals') {
      const lineVal = line ?? parseFloat(s.replace(/[^\d.]/g, ''));
      const code = lineCode(lineVal);
      if (s.includes('home') && s.includes('over')) return `HOME_OVER_${code}`;
      if (s.includes('home') && s.includes('under')) return `HOME_UNDER_${code}`;
      if (s.includes('away') && s.includes('over')) return `AWAY_OVER_${code}`;
      if (s.includes('away') && s.includes('under')) return `AWAY_UNDER_${code}`;
    }
    if (m === 'handicap' || m === 'ah' || m === 'asian_handicap') {
      const lineVal = Math.abs(line ?? 1);
      const code = Math.round(lineVal * 10).toString();
      if (s.includes('home') && (s.includes('+') || s.includes('plus'))) return `AH_HOME_PLUS_${code}`;
      if (s.includes('home') && (s.includes('-') || s.includes('minus'))) return `AH_HOME_MINUS_${code}`;
      if (s.includes('away') && (s.includes('+') || s.includes('plus'))) return `AH_AWAY_PLUS_${code}`;
      if (s.includes('away') && (s.includes('-') || s.includes('minus'))) return `AH_AWAY_MINUS_${code}`;
    }
    if (m === 'ht_ft' || m === 'half_full') {
      // Expect "HH", "HD", "HA", "DH", ..., "AA"
      return `HTFT_${selection.toUpperCase()}`;
    }
    if (m === 'first_half' || m === 'ht') {
      const lineVal = line ?? 0.5;
      const code = lineCode(lineVal);
      if (s.includes('over')) return `HT_OVER_${code}`;
      if (s.includes('under')) return `HT_UNDER_${code}`;
      if (s.includes('home')) return 'HT_HOME_WIN';
      if (s.includes('away')) return 'HT_AWAY_WIN';
      if (s.includes('draw')) return 'HT_DRAW';
    }
    if (m === 'cards') {
      const lineVal = line ?? 3.5;
      const code = lineCode(lineVal);
      return s.includes('over') ? `CARDS_OVER_${code}` : `CARDS_UNDER_${code}`;
    }
    if (m === 'corners') {
      const lineVal = line ?? 9.5;
      const code = lineCode(lineVal);
      return s.includes('over') ? `CORNERS_OVER_${code}` : `CORNERS_UNDER_${code}`;
    }
  }

  // ===== BASKETBALL =====
  if (sport === 'basketball' || sport === 'nba') {
    if (m === 'moneyline' || m === 'match_winner' || m === '1x2' || m === '2way') {
      if (s === 'home') return 'BB_HOME_WIN';
      if (s === 'away') return 'BB_AWAY_WIN';
    }
    if (m === 'total' || m === 'totals') {
      // selection may be "over_210.5" or "over"
      const lineVal = line ?? parseFloat(s.replace(/[^\d.]/g, '')) ?? 0;
      const code = lineCode(lineVal);
      if (s.includes('over')) return `BB_OVER_${code}`;
      if (s.includes('under')) return `BB_UNDER_${code}`;
    }
    if (m === 'spread' || m === 'handicap' || m === 'point_spread') {
      const parts = s.split('_');
      const numericPart = parts.find(p => /^-?\d/.test(p)) ?? '';
      const lineVal = line ?? parseFloat(numericPart);
      if (Number.isNaN(lineVal)) return `BB_SPREAD_${selection.toUpperCase()}`;
      const code = Math.round(Math.abs(lineVal) * 10).toString();
      if (s.includes('home')) return lineVal < 0 ? `BB_SPREAD_HOME_MINUS_${code}` : `BB_SPREAD_HOME_PLUS_${code}`;
      if (s.includes('away')) return lineVal > 0 ? `BB_SPREAD_AWAY_PLUS_${code}` : `BB_SPREAD_AWAY_MINUS_${code}`;
    }
  }

  // ===== HOCKEY =====
  if (sport === 'hockey') {
    if (m === 'match_result_3way' || (m === '1x2' && selection)) {
      if (s === 'home') return 'HO_HOME_WIN_REG';
      if (s === 'away') return 'HO_AWAY_WIN_REG';
      if (s === 'draw') return 'HO_DRAW_REG';
    }
    if (m === 'match_result_2way' || m === 'moneyline') {
      if (s === 'home') return 'HO_HOME_ML';
      if (s === 'away') return 'HO_AWAY_ML';
    }
    if (m.startsWith('total_goals_over_') || (m === 'total' && s.includes('over'))) {
      const lineVal = line ?? parseFloat((m + s).replace(/[^\d.]/g, '')) / 10;
      return `HO_OVER_${Math.round(lineVal * 10)}`;
    }
    if (m.startsWith('total_goals_under_') || (m === 'total' && s.includes('under'))) {
      const lineVal = line ?? parseFloat((m + s).replace(/[^\d.]/g, '')) / 10;
      return `HO_UNDER_${Math.round(lineVal * 10)}`;
    }
    if (m === 'puck_line') {
      if (s.includes('home')) return 'HO_PUCK_HOME_MINUS_15';
      if (s.includes('away')) return 'HO_PUCK_AWAY_PLUS_15';
    }
    if (m === 'btts') {
      return s === 'yes' ? 'HO_BTTS_YES' : 'HO_BTTS_NO';
    }
  }

  // ===== HANDBALL =====
  if (sport === 'handball') {
    if (m === 'moneyline' || m === '1x2' || m === 'match_winner') {
      if (s === 'home') return 'HB_HOME_WIN';
      if (s === 'away') return 'HB_AWAY_WIN';
      if (s === 'draw') return 'HB_DRAW';
    }
    if (m === 'total' || m === 'totals') {
      const lineVal = line ?? parseFloat(s.replace(/[^\d.]/g, ''));
      const code = lineCode(lineVal);
      return s.includes('over') ? `HB_OVER_${code}` : `HB_UNDER_${code}`;
    }
  }

  // ===== VOLLEYBALL =====
  if (sport === 'volleyball') {
    if (m === 'moneyline' || m === '1x2' || m === 'match_winner' || m === '2way') {
      if (s === 'home') return 'VB_HOME_WIN';
      if (s === 'away') return 'VB_AWAY_WIN';
    }
    if (m === 'correct_sets' || m === 'correct_score') {
      // e.g., "3-0", "0-3"
      const mapping: Record<string, string> = {
        '3-0': 'VB_CS_3_0_HOME',
        '3-1': 'VB_CS_3_1_HOME',
        '3-2': 'VB_CS_3_2_HOME',
        '0-3': 'VB_CS_0_3_AWAY',
        '1-3': 'VB_CS_1_3_AWAY',
        '2-3': 'VB_CS_2_3_AWAY',
      };
      return mapping[selection] ?? `VB_CS_${selection.replace('-', '_')}`;
    }
    if (m === 'total_sets') {
      const lineVal = line ?? parseFloat(s.replace(/[^\d.]/g, ''));
      const code = lineCode(lineVal);
      return s.includes('over') ? `VB_TOTAL_SETS_OVER_${code}` : `VB_TOTAL_SETS_UNDER_${code}`;
    }
  }

  // ===== BASEBALL =====
  if (sport === 'baseball') {
    if (m === 'moneyline' || m === '1x2' || m === '2way' || m === 'match_winner') {
      if (s === 'home') return 'BS_HOME_ML';
      if (s === 'away') return 'BS_AWAY_ML';
    }
    if (m === 'runline' || m === 'run_line' || m === 'handicap') {
      if (s.includes('home')) return 'BS_RUNLINE_HOME_MINUS_15';
      if (s.includes('away')) return 'BS_RUNLINE_AWAY_PLUS_15';
    }
    if (m === 'total' || m === 'totals') {
      const lineVal = line ?? parseFloat(s.replace(/[^\d.]/g, ''));
      const code = lineCode(lineVal);
      return s.includes('over') ? `BS_OVER_${code}` : `BS_UNDER_${code}`;
    }
  }

  // Fallback: unknown combination — make up a deterministic code so data is not lost.
  const fallback = `${sport.toUpperCase()}_${market.toUpperCase()}_${selection.toUpperCase()}`
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_');
  return fallback;
}

// ============================================================================
// Per-sport adapters (engine output → NormalizedPrediction)
// ============================================================================

/**
 * Adapts a multi-sport SportPredictionResult (from basketball/hockey/handball/
 * volleyball/baseball engines) into NormalizedPrediction.
 */
export function adaptSportResult(input: {
  sport: SportCode;
  api_game_id: number;
  home_team: string;
  away_team: string;
  league?: string;
  league_id?: number;
  match_date: Date | string;
  result: any; // SportPredictionResult
  engine_name?: string;
}): NormalizedPrediction {
  const { result, sport } = input;
  const picks: NormalizedPick[] = [];

  // 1. Main match-result probabilities
  if (result.match_result) {
    const mr = result.match_result;
    if (mr.home_win) {
      const prob = mr.home_win.probability > 1 ? mr.home_win.probability / 100 : mr.home_win.probability;
      picks.push({
        market: normalizeMarketCode({ sport, market: 'moneyline', selection: 'home' }),
        pick_label: `${input.home_team} kazanır`,
        probability: prob,
        market_odds: mr.home_win.odds,
        expected_value: computeEV(prob, mr.home_win.odds),
        category: 'main',
        is_high_confidence: prob >= 0.65,
      });
    }
    if (mr.away_win) {
      const prob = mr.away_win.probability > 1 ? mr.away_win.probability / 100 : mr.away_win.probability;
      picks.push({
        market: normalizeMarketCode({ sport, market: 'moneyline', selection: 'away' }),
        pick_label: `${input.away_team} kazanır`,
        probability: prob,
        market_odds: mr.away_win.odds,
        expected_value: computeEV(prob, mr.away_win.odds),
        category: 'main',
        is_high_confidence: prob >= 0.65,
      });
    }
    if (mr.draw) {
      const prob = mr.draw.probability > 1 ? mr.draw.probability / 100 : mr.draw.probability;
      picks.push({
        market: normalizeMarketCode({ sport, market: 'moneyline', selection: 'draw' }),
        pick_label: 'Beraberlik',
        probability: prob,
        market_odds: mr.draw.odds,
        expected_value: computeEV(prob, mr.draw.odds),
        category: 'main',
        is_high_confidence: prob >= 0.55,
      });
    }
  }

  // 2. High-confidence bets (with engine-provided recommendations)
  const bets = [
    ...(result.high_confidence_bets ?? []),
    ...(result.medium_risk_bets ?? []),
    ...(result.high_risk_bets ?? []),
  ];
  for (const bet of bets) {
    if (!bet.market || !bet.selection) continue;
    const prob = typeof bet.confidence === 'number'
      ? bet.confidence > 1 ? bet.confidence / 100 : bet.confidence
      : 0.55;
    const marketCode = normalizeMarketCode({
      sport,
      market: bet.market,
      selection: bet.selection,
      line: bet.line ?? bet.estimated_line,
    });
    const odds = bet.estimated_odds ?? bet.bookmaker_odds;
    picks.push({
      market: marketCode,
      market_label: getMarket(marketCode)?.display_name_tr ?? bet.title,
      pick_label: bet.recommendation ?? bet.description ?? bet.title,
      category: 'side',
      probability: prob,
      market_odds: odds,
      expected_value: computeEV(prob, odds),
      is_high_confidence: prob >= 0.65,
      score_value: bet.score_value,
    });
  }

  // 3. Value bets (if engine emitted them)
  if (Array.isArray(result.value_bets)) {
    for (const vb of result.value_bets) {
      if (!vb.is_value) continue;
      const prob = typeof vb.model_probability === 'number'
        ? vb.model_probability > 1 ? vb.model_probability / 100 : vb.model_probability
        : 0.55;
      const marketCode = normalizeMarketCode({
        sport,
        market: vb.market,
        selection: vb.selection,
        line: vb.line,
      });
      const odds = vb.bookmaker_odds;
      const already = picks.find(p => p.market === marketCode);
      if (already) {
        already.market_odds = already.market_odds ?? odds;
        already.expected_value = already.expected_value ?? computeEV(prob, odds);
        continue;
      }
      picks.push({
        market: marketCode,
        pick_label: `${vb.market} ${vb.selection} (value %${Math.round((vb.edge ?? 0))})`,
        category: 'side',
        probability: prob,
        market_odds: odds,
        expected_value: computeEV(prob, odds),
        is_high_confidence: (vb.edge ?? 0) > 7,
      });
    }
  }

  // Dedupe: keep one row per (market_code). Prefer one with odds, else higher prob.
  const dedup = new Map<string, NormalizedPick>();
  for (const p of picks) {
    const cur = dedup.get(p.market);
    if (!cur) {
      dedup.set(p.market, p);
    } else {
      const a = cur.market_odds ? 1 : 0;
      const b = p.market_odds ? 1 : 0;
      if (b > a || (b === a && p.probability > cur.probability)) dedup.set(p.market, p);
    }
  }
  const cleanPicks = Array.from(dedup.values());

  // Mark one pick as "best" — highest EV, else highest prob
  if (cleanPicks.length > 0) {
    const best = cleanPicks.reduce((a, b) => {
      const aScore = a.expected_value ?? a.probability - 0.5;
      const bScore = b.expected_value ?? b.probability - 0.5;
      return bScore > aScore ? b : a;
    });
    best.is_best = true;
  }

  const hwProb = cleanPicks.find(p => p.market.includes('HOME_WIN') || p.market.includes('HOME_ML'))?.probability;
  const awProb = cleanPicks.find(p => p.market.includes('AWAY_WIN') || p.market.includes('AWAY_ML'))?.probability;
  const dProb = cleanPicks.find(p => p.market === 'DRAW')?.probability;

  return {
    sport,
    api_game_id: input.api_game_id,
    home_team: input.home_team,
    away_team: input.away_team,
    league: input.league,
    league_id: input.league_id,
    match_date: input.match_date,
    home_win_prob: hwProb,
    away_win_prob: awProb,
    draw_prob: dProb,
    confidence: result.prediction_confidence ?? result.match_result?.confidence,
    picks: cleanPicks,
    engine_name: input.engine_name ?? `${sport}-engine`,
    engine_version: '2.0',
    raw_payload: {
      analysis_factors: result.analysis_factors,
      confidence_tier: result.confidence_tier,
    },
  };
}

/**
 * Adapts a football AdvancedPredictionEngine output into NormalizedPrediction.
 * The football engine returns a totally different shape than the multi-sport ones.
 */
export function adaptFootballPrediction(input: {
  api_game_id: number;
  home_team: string;
  away_team: string;
  league?: string;
  league_id?: number;
  match_date: Date | string;
  result: any; // AdvancedPrediction / Prediction
  engine_name?: string;
}): NormalizedPrediction {
  const { result } = input;
  const picks: NormalizedPick[] = [];

  // match winner
  const mw = result.match_winner ?? result.matchResult ?? {};
  const homeWin = mw.home_win ?? mw.homeWin ?? result.home_win_probability;
  const draw = mw.draw ?? result.draw_probability;
  const awayWin = mw.away_win ?? mw.awayWin ?? result.away_win_probability;

  if (typeof homeWin === 'number') {
    const prob = homeWin > 1 ? homeWin / 100 : homeWin;
    picks.push({
      market: 'HOME_WIN',
      pick_label: `${input.home_team} kazanır`,
      probability: prob,
      category: 'main',
      is_high_confidence: prob >= 0.6,
    });
  }
  if (typeof draw === 'number') {
    const prob = draw > 1 ? draw / 100 : draw;
    picks.push({
      market: 'DRAW',
      pick_label: 'Beraberlik',
      probability: prob,
      category: 'main',
      is_high_confidence: prob >= 0.5,
    });
  }
  if (typeof awayWin === 'number') {
    const prob = awayWin > 1 ? awayWin / 100 : awayWin;
    picks.push({
      market: 'AWAY_WIN',
      pick_label: `${input.away_team} kazanır`,
      probability: prob,
      category: 'main',
      is_high_confidence: prob >= 0.6,
    });
  }

  // BTTS
  const btts = result.btts ?? result.bothTeamsScore ?? result.both_teams_score;
  if (btts && (typeof btts.yes === 'number' || typeof btts.no === 'number')) {
    const yesProb = (btts.yes ?? 0) > 1 ? btts.yes / 100 : btts.yes;
    const noProb = (btts.no ?? 0) > 1 ? btts.no / 100 : btts.no;
    if (typeof yesProb === 'number') {
      picks.push({
        market: 'BTTS_YES',
        pick_label: 'Karşılıklı Gol Var',
        probability: yesProb,
        category: 'main',
        is_high_confidence: yesProb >= 0.65,
      });
    }
    if (typeof noProb === 'number') {
      picks.push({
        market: 'BTTS_NO',
        pick_label: 'Karşılıklı Gol Yok',
        probability: noProb,
        category: 'main',
        is_high_confidence: noProb >= 0.65,
      });
    }
  }

  // Over/Under (various lines)
  const ou = result.over_under ?? result.overUnder ?? {};
  if (ou && typeof ou === 'object') {
    for (const [key, val] of Object.entries(ou)) {
      if (!val || typeof val !== 'object') continue;
      const v = val as any;
      const match = key.match(/^(over|under)_?(\d+(?:\.\d+)?)/i);
      if (!match) continue;
      const [, side, lineStr] = match;
      const line = parseFloat(lineStr);
      const code = lineCode(line);
      const prob = typeof v.probability === 'number' ? v.probability : typeof v === 'number' ? v : undefined;
      if (typeof prob !== 'number') continue;
      const normalized = prob > 1 ? prob / 100 : prob;
      picks.push({
        market: side.toLowerCase() === 'over' ? `OVER_${code}` : `UNDER_${code}`,
        pick_label: `${line} ${side.toLowerCase() === 'over' ? 'Üst' : 'Alt'}`,
        probability: normalized,
        category: 'main',
        is_high_confidence: normalized >= 0.65,
      });
    }
  }

  // Over/Under 2.5 direct (common)
  if (typeof result.over_2_5 === 'number') {
    const prob = result.over_2_5 > 1 ? result.over_2_5 / 100 : result.over_2_5;
    picks.push({
      market: 'OVER_25',
      pick_label: '2.5 Üst',
      probability: prob,
      category: 'main',
      is_high_confidence: prob >= 0.65,
    });
  }
  if (typeof result.under_2_5 === 'number') {
    const prob = result.under_2_5 > 1 ? result.under_2_5 / 100 : result.under_2_5;
    picks.push({
      market: 'UNDER_25',
      pick_label: '2.5 Alt',
      probability: prob,
      category: 'main',
      is_high_confidence: prob >= 0.65,
    });
  }

  // Cards / Corners
  for (const [k, lineBase] of [['cards', 3.5], ['corners', 9.5]] as const) {
    const obj = (result as any)[k];
    if (!obj) continue;
    for (const field of ['over', 'under']) {
      const prob = obj[field];
      if (typeof prob !== 'number') continue;
      const p = prob > 1 ? prob / 100 : prob;
      const code = lineCode(lineBase);
      const prefix = k.toUpperCase();
      picks.push({
        market: `${prefix}_${field === 'over' ? 'OVER' : 'UNDER'}_${code}`,
        pick_label: `${k === 'cards' ? 'Kart' : 'Korner'} ${lineBase} ${field === 'over' ? 'Üst' : 'Alt'}`,
        probability: p,
        category: 'special',
        is_high_confidence: p >= 0.65,
      });
    }
  }

  // High-confidence recommendations array (any engine)
  const recs = result.high_confidence_bets ?? result.recommendations ?? [];
  for (const rec of recs) {
    if (!rec.market || !rec.selection) continue;
    const prob = typeof rec.confidence === 'number'
      ? (rec.confidence > 1 ? rec.confidence / 100 : rec.confidence)
      : 0.55;
    const code = normalizeMarketCode({
      sport: 'football',
      market: rec.market,
      selection: rec.selection,
      line: rec.line,
    });
    const existing = picks.find(p => p.market === code);
    if (existing) {
      existing.is_high_confidence = existing.is_high_confidence || prob >= 0.65;
      continue;
    }
    picks.push({
      market: code,
      pick_label: rec.recommendation ?? rec.description,
      category: 'side',
      probability: prob,
      market_odds: rec.estimated_odds ?? rec.bookmaker_odds,
      expected_value: computeEV(prob, rec.estimated_odds ?? rec.bookmaker_odds),
      is_high_confidence: prob >= 0.65,
    });
  }

  // Mark one best pick
  if (picks.length > 0) {
    const best = picks.reduce((a, b) => {
      const aScore = a.expected_value ?? a.probability - 0.5;
      const bScore = b.expected_value ?? b.probability - 0.5;
      return bScore > aScore ? b : a;
    });
    best.is_best = true;
  }

  return {
    sport: 'football',
    api_game_id: input.api_game_id,
    home_team: input.home_team,
    away_team: input.away_team,
    league: input.league,
    league_id: input.league_id,
    match_date: input.match_date,
    home_win_prob: typeof homeWin === 'number' ? (homeWin > 1 ? homeWin / 100 : homeWin) : undefined,
    draw_prob: typeof draw === 'number' ? (draw > 1 ? draw / 100 : draw) : undefined,
    away_win_prob: typeof awayWin === 'number' ? (awayWin > 1 ? awayWin / 100 : awayWin) : undefined,
    confidence: result.confidence ?? result.overall_confidence ?? result.prediction_confidence,
    picks,
    engine_name: input.engine_name ?? 'football-advanced',
    engine_version: '2.0',
    raw_payload: {
      risk: result.risk,
      momentum: result.momentum,
      confidence_tier: result.confidence_tier,
    },
  };
}
