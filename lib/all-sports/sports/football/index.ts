/**
 * Football (Soccer) Sport Plugin
 * v3.football.api-sports.io
 *
 * Karakteristik:
 * - Düşük skorlu (~2.5 gol ort)
 * - Draw izinli
 * - İki yarı (45 dk + 45 dk)
 * - En popüler iddaa sporu
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import { SportApiClient, deriveOutcomes, calculateFormScore, analyzeH2H, splitHandicapProb } from '../_core';
import { footballConfig } from './config';

const client = new SportApiClient(footballConfig.apiBase, footballConfig.apiKey);

// ===== NORMALIZER =====
function normalizeFixture(fixture: any): NormalizedGame {
  const status = fixture.fixture.status;
  return {
    id: fixture.fixture.id,
    sport: 'football',
    date: fixture.fixture.date,
    timestamp: fixture.fixture.timestamp,
    status: {
      short: status.short,
      long: status.long,
      live: ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(status.short),
      finished: ['FT', 'AET', 'PEN'].includes(status.short),
      upcoming: status.short === 'NS' || status.short === 'TBD',
    },
    league: {
      id: fixture.league.id,
      name: fixture.league.name,
      logo: fixture.league.logo,
      country: fixture.league.country,
      season: fixture.league.season,
    },
    teams: {
      home: { id: fixture.teams.home.id, name: fixture.teams.home.name, logo: fixture.teams.home.logo },
      away: { id: fixture.teams.away.id, name: fixture.teams.away.name, logo: fixture.teams.away.logo },
    },
    scores: {
      home: fixture.goals?.home ?? null,
      away: fixture.goals?.away ?? null,
    },
    periods: {
      first: fixture.score?.halftime ? `${fixture.score.halftime.home}-${fixture.score.halftime.away}` : null,
      second: fixture.score?.fulltime ? `${fixture.score.fulltime.home}-${fixture.score.fulltime.away}` : null,
      extra: fixture.score?.extratime ? `${fixture.score.extratime.home}-${fixture.score.extratime.away}` : null,
      penalty: fixture.score?.penalty ? `${fixture.score.penalty.home}-${fixture.score.penalty.away}` : null,
    },
  };
}

function normalizeOdds(odd: any): NormalizedOdds {
  return {
    gameId: odd.fixture.id,
    bookmakers: (odd.bookmakers || []).map((bm: any) => ({
      id: bm.id,
      name: bm.name,
      bets: (bm.bets || []).map((bet: any) => ({
        id: bet.id,
        name: bet.name,
        values: (bet.values || []).map((v: any) => ({
          value: String(v.value),
          odd: parseFloat(v.odd),
        })),
      })),
    })),
  };
}

// ===== PREDICTION =====
function predict(params: {
  game: NormalizedGame;
  homeStats?: any;
  awayStats?: any;
  h2h?: NormalizedGame[];
  homeStanding?: any;
  awayStanding?: any;
}): Prediction {
  const { game, homeStats, awayStats, h2h = [], homeStanding, awayStanding } = params;

  let homeAttack = footballConfig.avgScoreHome;
  let homeDefense = footballConfig.avgScoreAway;
  let awayAttack = footballConfig.avgScoreAway;
  let awayDefense = footballConfig.avgScoreHome;

  // Team statistics - football-api format
  if (homeStats?.goals) {
    const homeForGoals = parseFloat(homeStats.goals?.for?.average?.home) || homeAttack;
    const homeAgainstGoals = parseFloat(homeStats.goals?.against?.average?.home) || homeDefense;
    homeAttack = homeForGoals;
    homeDefense = homeAgainstGoals;
  }
  if (awayStats?.goals) {
    const awayForGoals = parseFloat(awayStats.goals?.for?.average?.away) || awayAttack;
    const awayAgainstGoals = parseFloat(awayStats.goals?.against?.average?.away) || awayDefense;
    awayAttack = awayForGoals;
    awayDefense = awayAgainstGoals;
  }

  const homeForm = calculateFormScore(homeStanding?.form);
  const awayForm = calculateFormScore(awayStanding?.form);

  let h2hAdjust = 0;
  if (h2h.length > 0) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    h2hAdjust = (h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate) * 0.3;
  }

  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const adv = footballConfig.homeAdvantage;

  const expectedHome = Math.max(0.3, ((homeAttack + awayDefense) / 2) * adv * Math.pow(formFactor, 0.3) + h2hAdjust);
  const expectedAway = Math.max(0.3, ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.15) - h2hAdjust * 0.5);

  const outcomes = deriveOutcomes(expectedHome, expectedAway, {
    maxGoals: 10,
    ouLines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    handicapLines: [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5],
  });

  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2h.length >= 3) confidence += 15;
  if (homeStanding) confidence += 7.5;
  if (awayStanding) confidence += 7.5;
  confidence = Math.min(95, confidence);

  const overUnder: Record<string, { over: number; under: number }> = {};
  Object.entries(outcomes.overUnder).forEach(([k, v]) => {
    overUnder[String(k)] = v;
  });

  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => {
    handicaps[String(k)] = v;
  });

  return {
    homeWinProb: outcomes.homeWin * 100,
    drawProb: outcomes.draw * 100,
    awayWinProb: outcomes.awayWin * 100,
    expectedHomeScore: expectedHome,
    expectedAwayScore: expectedAway,
    expectedTotalScore: expectedHome + expectedAway,
    overUnder,
    btts: { yes: outcomes.btts.yes * 100, no: outcomes.btts.no * 100 },
    mostLikelyScores: outcomes.exactScores.slice(0, 10),
    handicaps,
    confidence,
    homeForm,
    awayForm,
  };
}

// ===== MARKET EVALUATOR =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = betName.toLowerCase();
  const sel = selection.trim();

  // 1X2
  if (name === 'match winner' || name === '1x2') {
    if (sel === '1' || sel === 'Home' || sel === 'home') return prediction.homeWinProb / 100;
    if (sel === 'X' || sel === 'Draw' || sel === 'draw') return prediction.drawProb / 100;
    if (sel === '2' || sel === 'Away' || sel === 'away') return prediction.awayWinProb / 100;
  }

  // Home/Away (Draw No Bet)
  if (name === 'home/away') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total === 0) return 0;
    if (sel === 'Home') return prediction.homeWinProb / total;
    if (sel === 'Away') return prediction.awayWinProb / total;
  }

  // Double Chance
  if (name === 'double chance' || name.includes('double chance')) {
    if (sel === 'Home/Draw' || sel === '1X' || sel === '1x') return (prediction.homeWinProb + prediction.drawProb) / 100;
    if (sel === 'Draw/Away' || sel === 'X2' || sel === 'x2') return (prediction.drawProb + prediction.awayWinProb) / 100;
    if (sel === 'Home/Away' || sel === '12') return (prediction.homeWinProb + prediction.awayWinProb) / 100;
  }

  // Both Teams Score (BTTS)
  if (name === 'both teams score' || name === 'both teams to score') {
    if (sel === 'Yes') return (prediction.btts?.yes ?? 0) / 100;
    if (sel === 'No') return (prediction.btts?.no ?? 0) / 100;
  }

  // Goals Over/Under
  if (name === 'goals over/under' || name === 'over/under') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;
    }
  }

  // Handicap (standard lines like -1, -0.5, 0, 0.5)
  if (name.includes('handicap') && !name.includes('asian')) {
    const match = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (match) {
      const side = match[1];
      const line = parseFloat(match[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        return side === 'Home' ? hc.home : hc.away;
      }
    }
  }

  // Asian Handicap (including split: "-0.5/-1", "0/-0.5" format)
  if (name === 'asian handicap' || name.includes('asian handicap')) {
    // Split handicap: "-0.5/-1" or "Home -0.5, -1"
    const splitMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)\s*\/\s*([-+]?[\d.]+)/);
    if (splitMatch) {
      const side = splitMatch[1];
      const l1 = parseFloat(splitMatch[2]);
      const l2 = parseFloat(splitMatch[3]);
      return splitHandicapProb(
        prediction.expectedHomeScore,
        prediction.expectedAwayScore,
        l1,
        l2,
        side === 'Home'
      );
    }
    // Single line
    const match = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (match) {
      const side = match[1];
      const line = parseFloat(match[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        // Exclude push in standard Asian handicap
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush === 0) return 0;
        return side === 'Home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }
    }
  }

  // Exact Score
  if (name === 'exact score' || name === 'correct score') {
    const parts = sel.split(/[-:]/).map(s => parseInt(s.trim()));
    if (parts.length === 2) {
      const found = prediction.mostLikelyScores.find(s => s.home === parts[0] && s.away === parts[1]);
      if (found) return found.probability;
    }
  }

  // Odd/Even
  if (name === 'odd/even') {
    // Derive from expected total & mostLikelyScores
    const oddProb = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 1)
      .reduce((a, b) => a + b.probability, 0);
    const evenProb = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 0)
      .reduce((a, b) => a + b.probability, 0);
    const total = oddProb + evenProb;
    if (total > 0) {
      if (sel === 'Odd') return oddProb / total;
      if (sel === 'Even') return evenProb / total;
    }
  }

  // Team Total - Home
  if (name === 'total - home') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      // Poisson P(X > line) for home only
      const lambda = prediction.expectedHomeScore;
      let pOver = 0;
      for (let k = Math.ceil(line); k <= 12; k++) {
        pOver += Math.exp(-lambda) * Math.pow(lambda, k) / factorialMini(k);
      }
      return dir === 'over' ? pOver : 1 - pOver;
    }
  }

  // Team Total - Away
  if (name === 'total - away') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const lambda = prediction.expectedAwayScore;
      let pOver = 0;
      for (let k = Math.ceil(line); k <= 12; k++) {
        pOver += Math.exp(-lambda) * Math.pow(lambda, k) / factorialMini(k);
      }
      return dir === 'over' ? pOver : 1 - pOver;
    }
  }

  // First Half Winner
  if (name === 'first half winner') {
    // ~50% of game goals happen in 1st half, usually slightly less (45%)
    const firstHalfHome = prediction.expectedHomeScore * 0.45;
    const firstHalfAway = prediction.expectedAwayScore * 0.45;
    const o = deriveOutcomes(firstHalfHome, firstHalfAway, { maxGoals: 7, ouLines: [], handicapLines: [] });
    if (sel === '1' || sel === 'Home') return o.homeWin;
    if (sel === 'X' || sel === 'Draw') return o.draw;
    if (sel === '2' || sel === 'Away') return o.awayWin;
  }

  return 0;
}

function factorialMini(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// ===== BET RESULT EVALUATOR =====
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;
  if (!game.status.finished || game.scores.home === null || game.scores.away === null) return 'pending';

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = betName.toLowerCase();
  const sel = selection.trim();

  if (name === 'match winner' || name === '1x2') {
    if (sel === '1' || sel === 'Home') return h > a ? 'won' : 'lost';
    if (sel === 'X' || sel === 'Draw') return h === a ? 'won' : 'lost';
    if (sel === '2' || sel === 'Away') return a > h ? 'won' : 'lost';
  }

  if (name === 'goals over/under' || name === 'over/under') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      return dir === 'over' ? (total > line ? 'won' : 'lost') : (total < line ? 'won' : 'lost');
    }
  }

  if (name === 'both teams score' || name === 'both teams to score') {
    const scored = h > 0 && a > 0;
    if (sel === 'Yes') return scored ? 'won' : 'lost';
    if (sel === 'No') return !scored ? 'won' : 'lost';
  }

  if (name === 'double chance') {
    if (sel === 'Home/Draw' || sel === '1X') return h >= a ? 'won' : 'lost';
    if (sel === 'Draw/Away' || sel === 'X2') return a >= h ? 'won' : 'lost';
    if (sel === 'Home/Away' || sel === '12') return h !== a ? 'won' : 'lost';
  }

  if (name === 'exact score' || name === 'correct score') {
    const p = sel.split(/[-:]/).map(s => parseInt(s.trim()));
    if (p.length === 2) return h === p[0] && a === p[1] ? 'won' : 'lost';
  }

  if (name === 'odd/even') {
    if (sel === 'Odd') return total % 2 === 1 ? 'won' : 'lost';
    if (sel === 'Even') return total % 2 === 0 ? 'won' : 'lost';
  }

  if (name === 'asian handicap' || name.includes('handicap')) {
    // Single line
    const single = sel.match(/(Home|Away)\s*([-+]?[\d.]+)$/);
    if (single) {
      const side = single[1];
      const line = parseFloat(single[2]);
      const diff = side === 'Home' ? h - a + line : a - h + line;
      if (diff > 0) return 'won';
      if (diff < 0) return 'lost';
      return 'void';
    }
  }

  if (name === 'home/away') {
    if (h === a) return 'void'; // Draw = push
    if (sel === 'Home') return h > a ? 'won' : 'lost';
    if (sel === 'Away') return a > h ? 'won' : 'lost';
  }

  return 'void';
}

// ===== API DATA FETCHERS =====
async function getGamesByDate(date: string): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('fixtures', { date });
  return (res.response || []).map(normalizeFixture);
}

async function getGameById(id: number): Promise<NormalizedGame | null> {
  const res = await client.fetch<any[]>('fixtures', { id });
  const g = res.response?.[0];
  return g ? normalizeFixture(g) : null;
}

async function getLiveGames(): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('fixtures', { live: 'all' }, 60000);
  return (res.response || []).map(normalizeFixture);
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  const res = await client.fetch<any[]>('odds', { fixture: gameId });
  const o = res.response?.[0];
  return o ? normalizeOdds(o) : null;
}

async function getH2H(homeTeamId: number, awayTeamId: number): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('fixtures/headtohead', { h2h: `${homeTeamId}-${awayTeamId}` });
  return (res.response || []).map(normalizeFixture);
}

async function getStandings(leagueId: number, season: number): Promise<any[]> {
  const res = await client.fetch<any[]>('standings', { league: leagueId, season });
  return res.response?.[0]?.league?.standings?.flat() || [];
}

async function getTeamStatistics(teamId: number, leagueId: number, season: number): Promise<any> {
  const res = await client.fetch<any>('teams/statistics', { team: teamId, league: leagueId, season });
  return res.response;
}

// ===== PLUGIN EXPORT =====
export const footballPlugin: SportPlugin = {
  config: footballConfig,
  getGamesByDate,
  getGameById,
  getLiveGames,
  getOddsForGame,
  getH2H,
  getStandings,
  getTeamStatistics,
  predict,
  evaluateMarket,
  evaluateBetResult,
};
