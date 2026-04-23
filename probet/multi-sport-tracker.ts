/**
 * Multi-Sport Prediction Tracking Adapter
 *
 * Normalizes sport-specific prediction shapes (basketball, hockey, volleyball,
 * handball) into the unified StoredPrediction shape used by prediction-store.
 *
 * Each sport has a different native prediction format. This adapter extracts
 * the common fields (match info, best pick, market odds) and saves them to
 * the same postgres tracking DB so backtest stats can compare sports side
 * by side.
 */

import { savePredictionAsync, type StoredPrediction } from './prediction-store';

type SupportedSport = 'basketball' | 'hockey' | 'volleyball' | 'handball';

// ─────────────────────────────────────────────────────────────────────────────
// Basketball adapter
// ─────────────────────────────────────────────────────────────────────────────
interface BasketballLike {
  game_id: number;
  game_info: {
    home_team: string;
    away_team: string;
    league: string;
    date: string;
    status: string;
  };
  match_result: {
    home_win: { probability: number; odds: number };
    away_win: { probability: number; odds: number };
    predicted_winner: string;
    confidence: number;
  };
  total_points?: {
    lines?: Array<{
      line: number;
      over_probability: number;
      under_probability: number;
      over_odds: number;
      under_odds: number;
    }>;
  };
}

// Normalize probability to 0-1 range.
// Some sport engines return 0-100 (percentage), others return 0-1.
function normProb(p: number): number {
  if (!Number.isFinite(p) || p < 0) return 0;
  if (p > 1.0) return p / 100;
  return p;
}

function trackBasketball(pred: BasketballLike): void {
  const m = pred.match_result;
  const homeProb = normProb(m.home_win.probability);
  const awayProb = normProb(m.away_win.probability);
  const bestIsHome = homeProb >= awayProb;

  const topPicks: StoredPrediction['topPicks'] = [
    {
      market: bestIsHome ? 'HOME_WIN' : 'AWAY_WIN',
      marketLabel: bestIsHome ? 'MS 1' : 'MS 2',
      pickLabel: `${bestIsHome ? pred.game_info.home_team : pred.game_info.away_team} kazanır`,
      category: 'MAÇ_SONUCU',
      probability: bestIsHome ? homeProb : awayProb,
      marketOdds: bestIsHome ? m.home_win.odds : m.away_win.odds,
      expectedValue:
        (bestIsHome ? homeProb : awayProb) * (bestIsHome ? m.home_win.odds : m.away_win.odds) - 1,
    },
    {
      market: bestIsHome ? 'AWAY_WIN' : 'HOME_WIN',
      marketLabel: bestIsHome ? 'MS 2' : 'MS 1',
      pickLabel: `${bestIsHome ? pred.game_info.away_team : pred.game_info.home_team} kazanır`,
      category: 'MAÇ_SONUCU',
      probability: bestIsHome ? awayProb : homeProb,
      marketOdds: bestIsHome ? m.away_win.odds : m.home_win.odds,
      expectedValue:
        (bestIsHome ? awayProb : homeProb) * (bestIsHome ? m.away_win.odds : m.home_win.odds) - 1,
    },
  ];

  // Add best over/under line if available (highest-confidence line).
  // Basketball uses total points (e.g. 208.5), not goals — we use the line
  // value in the market key for unique identification per line.
  if (pred.total_points?.lines && pred.total_points.lines.length > 0) {
    const sortedLines = [...pred.total_points.lines].sort((a, b) => {
      const ap = Math.max(normProb(a.over_probability), normProb(a.under_probability));
      const bp = Math.max(normProb(b.over_probability), normProb(b.under_probability));
      return bp - ap;
    });
    const best = sortedLines[0];
    const overProb = normProb(best.over_probability);
    const underProb = normProb(best.under_probability);
    const overBetter = overProb >= underProb;
    const lineKey = String(best.line).replace('.', '_');
    topPicks.push({
      market: overBetter ? `BB_OVER_${lineKey}` : `BB_UNDER_${lineKey}`,
      marketLabel: `${best.line} ${overBetter ? 'Üst' : 'Alt'}`,
      pickLabel: `Toplam sayı ${overBetter ? '≥' : '<'} ${best.line}`,
      category: 'GOL_TOPLAMI',
      probability: overBetter ? overProb : underProb,
      marketOdds: overBetter ? best.over_odds : best.under_odds,
      expectedValue:
        (overBetter ? overProb : underProb) * (overBetter ? best.over_odds : best.under_odds) - 1,
    });
  }

  savePredictionAsync({
    sport: 'basketball',
    fixtureId: pred.game_id,
    homeTeam: pred.game_info.home_team,
    awayTeam: pred.game_info.away_team,
    league: pred.game_info.league,
    matchDate: pred.game_info.date,
    homeWinProb: homeProb,
    drawProb: 0, // Basketball has no draws
    awayWinProb: awayProb,
    confidence: m.confidence,
    bestPick: topPicks[0]!,
    topPicks,
    highConfidencePicks: topPicks.filter((p) => p.probability >= 0.65),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hockey / Volleyball / Handball adapter — same general shape
// ─────────────────────────────────────────────────────────────────────────────
interface GenericSportPrediction {
  game_id: number;
  game_info?: {
    home_team: string;
    away_team: string;
    league: string;
    date: string;
  };
  match_result?: {
    home_win?: { probability: number; odds: number };
    draw?: { probability: number; odds: number };
    away_win?: { probability: number; odds: number };
    predicted_winner?: string;
    confidence?: number;
  };
}

function trackGenericSport(sport: SupportedSport, pred: GenericSportPrediction): void {
  if (!pred.game_info || !pred.match_result) return;

  const gi = pred.game_info;
  const mr = pred.match_result;
  const homeProb = normProb(mr.home_win?.probability ?? 0);
  const drawProb = normProb(mr.draw?.probability ?? 0);
  const awayProb = normProb(mr.away_win?.probability ?? 0);

  const picks: StoredPrediction['topPicks'] = [];
  if (mr.home_win) {
    picks.push({
      market: 'HOME_WIN',
      marketLabel: 'MS 1',
      pickLabel: `${gi.home_team} kazanır`,
      category: 'MAÇ_SONUCU',
      probability: homeProb,
      marketOdds: mr.home_win.odds,
      expectedValue: homeProb * mr.home_win.odds - 1,
    });
  }
  if (mr.draw) {
    picks.push({
      market: 'DRAW',
      marketLabel: 'MS X',
      pickLabel: 'Beraberlik',
      category: 'MAÇ_SONUCU',
      probability: drawProb,
      marketOdds: mr.draw.odds,
      expectedValue: drawProb * mr.draw.odds - 1,
    });
  }
  if (mr.away_win) {
    picks.push({
      market: 'AWAY_WIN',
      marketLabel: 'MS 2',
      pickLabel: `${gi.away_team} kazanır`,
      category: 'MAÇ_SONUCU',
      probability: awayProb,
      marketOdds: mr.away_win.odds,
      expectedValue: awayProb * mr.away_win.odds - 1,
    });
  }

  if (picks.length === 0) return;

  // Sort by probability descending
  picks.sort((a, b) => b.probability - a.probability);

  savePredictionAsync({
    sport,
    fixtureId: pred.game_id,
    homeTeam: gi.home_team,
    awayTeam: gi.away_team,
    league: gi.league,
    matchDate: gi.date,
    homeWinProb: homeProb,
    drawProb,
    awayWinProb: awayProb,
    confidence: mr.confidence ?? Math.max(homeProb, drawProb, awayProb),
    bestPick: picks[0]!,
    topPicks: picks,
    highConfidencePicks: picks.filter((p) => p.probability >= 0.65),
  });
}

/**
 * Universal dispatcher — call from route-factory after a prediction is
 * generated. Swallows all errors (tracking never breaks user responses).
 */
export function trackSportPrediction(sport: SupportedSport, pred: any): void {
  try {
    if (sport === 'basketball') {
      trackBasketball(pred as BasketballLike);
    } else {
      trackGenericSport(sport, pred as GenericSportPrediction);
    }
  } catch (err) {
    console.error(`[multi-sport-tracker] ${sport} track failed:`, err);
  }
}
