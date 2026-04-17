/**
 * Hockey (Ice Hockey) Sport Plugin — Enhanced
 *
 * Faz 2 zenginleştirme:
 *   - Goalie form adjustment (save%, GAA trend)
 *   - Power play / penalty kill impact (PP%, PK%)
 *   - Faceoff win rate puck possession proxy
 *   - Back-to-back game fatigue penalty
 *   - Ensemble integration (model + market + StatsVault)
 *   - Player prop analysis (gol, asist, SOG)
 *   - Risk tier sınıflandırma
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import {
  SportApiClient,
  deriveOutcomes,
  calculateFormScore,
  analyzeH2H,
  splitHandicapProb,
  poissonProb,
} from '../_core';
import {
  fullEnsemble1X2,
  combine2Way,
  type ProbabilitySet,
} from '../_core/ensemble';
import {
  classifyRiskTier,
  type RiskTierResult,
} from '../_core/riskTier';
import { hockeyConfig } from './config';
import {
  analyzeHockeyTeamDeep,
  totalGoalAdjustment,
  analyzeHockeyPlayerProps,
  type HockeyTeamDeepAnalysis,
  type GoalieForm,
  type SpecialTeamsStats,
} from './hockeyPlayers';

const client = new SportApiClient(hockeyConfig.apiBase, hockeyConfig.apiKey);

// Hockey status code sets
const LIVE_STATUSES = new Set(['P1', 'P2', 'P3', 'OT', 'PT', 'BT', 'LIVE']);
const FINISHED_STATUSES = new Set(['FT', 'AOT', 'AP']);
const UPCOMING_STATUSES = new Set(['NS', 'TBD']);

// Each of 3 periods: ~1/3 of total goals expected
const PERIOD_FACTOR = 1 / 3;

// ===== NORMALIZER =====
function normalizeGame(game: any): NormalizedGame {
  const status = game.status ?? { short: 'NS', long: 'Not Started' };
  const short = status.short ?? 'NS';

  return {
    id: game.id,
    sport: 'hockey',
    date: game.date,
    timestamp: game.timestamp ?? Math.floor(new Date(game.date).getTime() / 1000),
    status: {
      short,
      long: status.long ?? short,
      live: LIVE_STATUSES.has(short),
      finished: FINISHED_STATUSES.has(short),
      upcoming: UPCOMING_STATUSES.has(short),
    },
    league: {
      id: game.league?.id,
      name: game.league?.name,
      logo: game.league?.logo,
      country: game.country?.name ?? game.league?.country,
      season: game.league?.season,
    },
    teams: {
      home: {
        id: game.teams?.home?.id,
        name: game.teams?.home?.name,
        logo: game.teams?.home?.logo,
      },
      away: {
        id: game.teams?.away?.id,
        name: game.teams?.away?.name,
        logo: game.teams?.away?.logo,
      },
    },
    scores: {
      home: game.scores?.home ?? null,
      away: game.scores?.away ?? null,
    },
    periods: {
      first: game.periods?.first ?? null,
      second: game.periods?.second ?? null,
      third: game.periods?.third ?? null,
      overtime: game.periods?.overtime ?? null,
      penalties: game.periods?.penalties ?? null,
    },
    events: game.events ?? false,
  };
}

function normalizeOdds(odd: any): NormalizedOdds {
  return {
    gameId: odd.game?.id ?? odd.gameId,
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

// ===== PREDICTION (Enhanced with goalie/PP/PK/faceoff/B2B) =====
function predict(params: {
  game: NormalizedGame;
  homeStats?: any;
  awayStats?: any;
  h2h?: NormalizedGame[];
  homeStanding?: any;
  awayStanding?: any;
}): Prediction {
  const { game, homeStats, awayStats, h2h = [], homeStanding, awayStanding } = params;

  let homeAttack = hockeyConfig.avgScoreHome;
  let homeDefense = hockeyConfig.avgScoreAway;
  let awayAttack = hockeyConfig.avgScoreAway;
  let awayDefense = hockeyConfig.avgScoreHome;

  if (homeStats?.goals) {
    const forHome = parseFloat(homeStats.goals?.for?.average?.home);
    const againstHome = parseFloat(homeStats.goals?.against?.average?.home);
    if (!isNaN(forHome) && forHome > 0) homeAttack = forHome;
    if (!isNaN(againstHome) && againstHome > 0) homeDefense = againstHome;
  }
  if (awayStats?.goals) {
    const forAway = parseFloat(awayStats.goals?.for?.average?.away);
    const againstAway = parseFloat(awayStats.goals?.against?.average?.away);
    if (!isNaN(forAway) && forAway > 0) awayAttack = forAway;
    if (!isNaN(againstAway) && againstAway > 0) awayDefense = againstAway;
  }

  const homeForm = calculateFormScore(homeStanding?.form);
  const awayForm = calculateFormScore(awayStanding?.form);

  let h2hAdjust = 0;
  if (h2h.length > 0) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    h2hAdjust = (h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate) * 0.3;
  }

  // ===== HOCKEY-SPECIFIC DEEP ADJUSTMENTS =====
  const homeDeep = analyzeHockeyTeamDeep({
    teamStats: homeStats,
    game,
    recentGames: h2h,
    teamId: game.teams.home.id,
  });
  const awayDeep = analyzeHockeyTeamDeep({
    teamStats: awayStats,
    game,
    recentGames: h2h,
    teamId: game.teams.away.id,
  });

  const homeAdj = totalGoalAdjustment(homeDeep);
  const awayAdj = totalGoalAdjustment(awayDeep);

  // Goalie: iyi ev goalie → deplasman daha az gol atar
  // PP/PK: iyi ev PP → ev daha fazla gol atar
  // Faceoff: iyi faceoff → daha fazla puck possession → daha fazla gol
  // B2B: yorgun takım → daha az atak, daha çok gol yeme
  homeAttack += homeAdj.attackAdjust;
  awayDefense += awayAdj.defenseAdjust;
  awayAttack += awayAdj.attackAdjust;
  homeDefense += homeAdj.defenseAdjust;

  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const adv = hockeyConfig.homeAdvantage;

  const expectedHome = Math.max(
    0.5,
    ((homeAttack + awayDefense) / 2) * adv * Math.pow(formFactor, 0.3) + h2hAdjust
  );
  const expectedAway = Math.max(
    0.5,
    ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.15) - h2hAdjust * 0.5
  );

  const outcomes = deriveOutcomes(expectedHome, expectedAway, {
    maxGoals: 12,
    ouLines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
    handicapLines: [-3.5, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3.5],
  });

  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2h.length >= 3) confidence += 15;
  if (homeStanding) confidence += 7.5;
  if (awayStanding) confidence += 7.5;
  // Deep analysis bonus: her sinyal katmanı ekstra güven
  if (homeDeep.goalie) confidence += 2;
  if (homeDeep.specialTeams) confidence += 2;
  if (homeDeep.backToBack.isBackToBack) confidence += 1;
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

// ===== PERIOD HELPERS =====
function periodOverProb(expectedPeriodTotal: number, line: number): number {
  // P(X > line) for Poisson, discrete math: line 2.5 => k >= 3
  let pUnder = 0;
  const threshold = Math.floor(line);
  for (let k = 0; k <= threshold; k++) {
    pUnder += poissonProb(expectedPeriodTotal, k);
  }
  return Math.max(0, Math.min(1, 1 - pUnder));
}

function periodBttsProb(lambdaHome: number, lambdaAway: number): number {
  // BTTS = P(home>=1) * P(away>=1) under independent Poissons
  const pHomeScores = 1 - Math.exp(-lambdaHome);
  const pAwayScores = 1 - Math.exp(-lambdaAway);
  return pHomeScores * pAwayScores;
}

function detectPeriodFromBetName(name: string): number | null {
  const m = name.match(/period\s*(\d)/i);
  if (m) {
    const p = parseInt(m[1]);
    if (p >= 1 && p <= 3) return p;
  }
  return null;
}

// ===== MARKET EVALUATOR =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = betName.trim();
  const nameLower = name.toLowerCase();
  const sel = selection.trim();

  const periodNum = detectPeriodFromBetName(nameLower);
  const isPeriodBet = periodNum !== null;

  // Match-level per-team expected goals
  const lambdaHome = prediction.expectedHomeScore;
  const lambdaAway = prediction.expectedAwayScore;
  // Per-period expected goals (~1/3 of match total)
  const periodHome = lambdaHome * PERIOD_FACTOR;
  const periodAway = lambdaAway * PERIOD_FACTOR;
  const periodTotal = periodHome + periodAway;

  // ===== 3Way Result (match winner in regulation) =====
  if ((nameLower === '3way result' || nameLower === 'match winner' || nameLower === '1x2') && !isPeriodBet) {
    if (sel === '1' || sel === 'Home' || sel.toLowerCase() === 'home') return prediction.homeWinProb / 100;
    if (sel === 'X' || sel === 'Draw' || sel.toLowerCase() === 'draw') return prediction.drawProb / 100;
    if (sel === '2' || sel === 'Away' || sel.toLowerCase() === 'away') return prediction.awayWinProb / 100;
  }

  // ===== Home/Away (Draw No Bet) =====
  if (nameLower === 'home/away' && !isPeriodBet) {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total === 0) return 0;
    if (sel === 'Home' || sel === '1' || sel.toLowerCase() === 'home') return prediction.homeWinProb / total;
    if (sel === 'Away' || sel === '2' || sel.toLowerCase() === 'away') return prediction.awayWinProb / total;
  }

  // ===== Double Chance =====
  if (nameLower === 'double chance' && !isPeriodBet) {
    if (sel === 'Home/Draw' || sel === '1X' || sel === '1x')
      return (prediction.homeWinProb + prediction.drawProb) / 100;
    if (sel === 'Draw/Away' || sel === 'X2' || sel === 'x2')
      return (prediction.drawProb + prediction.awayWinProb) / 100;
    if (sel === 'Home/Away' || sel === '12')
      return (prediction.homeWinProb + prediction.awayWinProb) / 100;
  }

  // ===== Both Teams To Score =====
  if (nameLower.startsWith('both teams to score') || nameLower === 'both teams score') {
    if (isPeriodBet) {
      const pYes = periodBttsProb(periodHome, periodAway);
      if (sel === 'Yes') return pYes;
      if (sel === 'No') return 1 - pYes;
    } else {
      if (sel === 'Yes') return (prediction.btts?.yes ?? 0) / 100;
      if (sel === 'No') return (prediction.btts?.no ?? 0) / 100;
    }
  }

  // ===== Over/Under =====
  if (nameLower.startsWith('over/under') || nameLower === 'goals over/under') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      if (isNaN(line)) return 0;

      if (isPeriodBet) {
        const pOver = periodOverProb(periodTotal, line);
        return dir === 'over' ? pOver : 1 - pOver;
      }

      // Match-level: try direct lookup
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;

      // Fallback for non-precomputed lines: use Poisson on total directly
      const totalLambda = lambdaHome + lambdaAway;
      let pUnder = 0;
      const threshold = Math.floor(line);
      for (let k = 0; k <= threshold; k++) {
        pUnder += poissonProb(totalLambda, k);
      }
      const pOver = Math.max(0, Math.min(1, 1 - pUnder));
      return dir === 'over' ? pOver : 1 - pOver;
    }
  }

  // ===== Asian Handicap (including split lines like "-1.5/-2") =====
  if (nameLower === 'asian handicap' || nameLower.includes('asian handicap')) {
    // Split handicap: "Home -1.5/-2" or "-1.5, -2"
    const splitMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)\s*[\/,]\s*([-+]?[\d.]+)/i);
    if (splitMatch) {
      const side = splitMatch[1];
      const l1 = parseFloat(splitMatch[2]);
      const l2 = parseFloat(splitMatch[3]);
      return splitHandicapProb(lambdaHome, lambdaAway, l1, l2, side.toLowerCase() === 'home');
    }

    // Single-line format: "Home -1.5" or "Away +2"
    const singleMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (singleMatch) {
      const side = singleMatch[1];
      const line = parseFloat(singleMatch[2]);
      if (isNaN(line)) return 0;

      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        // Asian exclusion: push stakes returned; use no-push normalization
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush === 0) return 0;
        return side.toLowerCase() === 'home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }

      // Fallback: compute from Poisson matrix directly
      return splitHandicapProb(lambdaHome, lambdaAway, line, line, side.toLowerCase() === 'home');
    }

    // Just numeric like "-1.5"
    const numericMatch = sel.match(/^([-+]?[\d.]+)$/);
    if (numericMatch) {
      const line = parseFloat(numericMatch[1]);
      if (!isNaN(line)) {
        const hc = prediction.handicaps?.[String(line)];
        if (hc) {
          const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
          if (totalNonPush === 0) return 0;
          return hc.home / totalNonPush;
        }
      }
    }
  }

  // ===== Odd/Even (match total goals) =====
  if (nameLower === 'odd/even' && !isPeriodBet) {
    const oddProb = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 1)
      .reduce((acc, s) => acc + s.probability, 0);
    const evenProb = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 0)
      .reduce((acc, s) => acc + s.probability, 0);
    const total = oddProb + evenProb;
    if (total > 0) {
      if (sel === 'Odd' || sel.toLowerCase() === 'odd') return oddProb / total;
      if (sel === 'Even' || sel.toLowerCase() === 'even') return evenProb / total;
    }
  }

  return 0;
}

// ===== BET RESULT EVALUATOR =====
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;

  if (!game.status.finished || game.scores.home === null || game.scores.away === null) {
    return 'pending';
  }

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = betName.trim().toLowerCase();
  const sel = selection.trim();

  const periodNum = detectPeriodFromBetName(name);
  const isPeriodBet = periodNum !== null;

  // Resolve period score ("H-A" format in game.periods.first/second/third)
  let periodHomeScore: number | null = null;
  let periodAwayScore: number | null = null;
  if (isPeriodBet) {
    const key = periodNum === 1 ? 'first' : periodNum === 2 ? 'second' : 'third';
    const raw = game.periods?.[key];
    if (typeof raw === 'string' && raw.includes('-')) {
      const parts = raw.split('-').map(s => parseInt(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        periodHomeScore = parts[0];
        periodAwayScore = parts[1];
      }
    }
    // No period data available — can't settle period bets
    if (periodHomeScore === null || periodAwayScore === null) return 'pending';
  }

  // ===== 3Way Result =====
  // 3Way hockey: "Uzatma Dahil Değil" — uses regulation result.
  // If game ended in OT/SO (AOT/AP), use the third-period cumulative score if available;
  // otherwise treat as draw (since regulation didn't determine winner).
  if (name === '3way result' || name === 'match winner' || name === '1x2') {
    // For AOT/AP, reg time score = sum of periods 1+2+3
    let regHome = h;
    let regAway = a;
    if (game.status.short === 'AOT' || game.status.short === 'AP') {
      const first = game.periods?.first;
      const second = game.periods?.second;
      const third = game.periods?.third;
      let sumH = 0, sumA = 0, haveAll = true;
      [first, second, third].forEach(p => {
        if (typeof p === 'string' && p.includes('-')) {
          const parts = p.split('-').map(s => parseInt(s.trim()));
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            sumH += parts[0];
            sumA += parts[1];
          } else {
            haveAll = false;
          }
        } else {
          haveAll = false;
        }
      });
      if (haveAll) {
        regHome = sumH;
        regAway = sumA;
      } else {
        // Fallback: OT/SO winner doesn't count in regulation-only market — treat as draw
        regHome = h;
        regAway = a;
        if (game.status.short === 'AP') {
          // Shootout: regulation ended tied (handled below by equality check)
        }
      }
    }

    if (sel === '1' || sel === 'Home' || sel.toLowerCase() === 'home')
      return regHome > regAway ? 'won' : 'lost';
    if (sel === 'X' || sel === 'Draw' || sel.toLowerCase() === 'draw')
      return regHome === regAway ? 'won' : 'lost';
    if (sel === '2' || sel === 'Away' || sel.toLowerCase() === 'away')
      return regAway > regHome ? 'won' : 'lost';
  }

  // ===== Home/Away (Draw No Bet) =====
  if (name === 'home/away' && !isPeriodBet) {
    if (h === a) return 'void'; // regulation draw = push
    if (sel === 'Home' || sel === '1' || sel.toLowerCase() === 'home') return h > a ? 'won' : 'lost';
    if (sel === 'Away' || sel === '2' || sel.toLowerCase() === 'away') return a > h ? 'won' : 'lost';
  }

  // ===== Double Chance =====
  if (name === 'double chance' && !isPeriodBet) {
    if (sel === 'Home/Draw' || sel === '1X' || sel === '1x') return h >= a ? 'won' : 'lost';
    if (sel === 'Draw/Away' || sel === 'X2' || sel === 'x2') return a >= h ? 'won' : 'lost';
    if (sel === 'Home/Away' || sel === '12') return h !== a ? 'won' : 'lost';
  }

  // ===== Over/Under =====
  if (name.startsWith('over/under') || name === 'goals over/under') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      if (isNaN(line)) return 'void';

      let scoreTotal: number;
      if (isPeriodBet) {
        scoreTotal = (periodHomeScore ?? 0) + (periodAwayScore ?? 0);
      } else {
        scoreTotal = total;
      }

      if (scoreTotal === line) return 'void'; // integer line push (e.g. 6)
      if (dir === 'over') return scoreTotal > line ? 'won' : 'lost';
      if (dir === 'under') return scoreTotal < line ? 'won' : 'lost';
    }
  }

  // ===== Both Teams To Score =====
  if (name.startsWith('both teams to score') || name === 'both teams score') {
    let scored: boolean;
    if (isPeriodBet) {
      scored = (periodHomeScore ?? 0) > 0 && (periodAwayScore ?? 0) > 0;
    } else {
      scored = h > 0 && a > 0;
    }
    if (sel === 'Yes') return scored ? 'won' : 'lost';
    if (sel === 'No') return !scored ? 'won' : 'lost';
  }

  // ===== Asian Handicap =====
  if (name === 'asian handicap' || name.includes('asian handicap')) {
    // Split: "Home -1.5/-2"
    const splitMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)\s*[\/,]\s*([-+]?[\d.]+)/i);
    if (splitMatch) {
      const side = splitMatch[1].toLowerCase();
      const l1 = parseFloat(splitMatch[2]);
      const l2 = parseFloat(splitMatch[3]);
      const diff1 = side === 'home' ? h - a + l1 : a - h + l1;
      const diff2 = side === 'home' ? h - a + l2 : a - h + l2;
      const score1 = diff1 > 0 ? 1 : diff1 === 0 ? 0.5 : 0;
      const score2 = diff2 > 0 ? 1 : diff2 === 0 ? 0.5 : 0;
      const combined = (score1 + score2) / 2;
      if (combined === 1) return 'won';
      if (combined === 0) return 'lost';
      return 'void'; // half-win/half-loss treated as void (simplified settlement)
    }

    // Single line: "Home -1.5"
    const singleMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (singleMatch) {
      const side = singleMatch[1].toLowerCase();
      const line = parseFloat(singleMatch[2]);
      if (isNaN(line)) return 'void';
      const diff = side === 'home' ? h - a + line : a - h + line;
      if (diff > 0) return 'won';
      if (diff < 0) return 'lost';
      return 'void';
    }
  }

  // ===== Odd/Even =====
  if (name === 'odd/even' && !isPeriodBet) {
    if (sel === 'Odd' || sel.toLowerCase() === 'odd') return total % 2 === 1 ? 'won' : 'lost';
    if (sel === 'Even' || sel.toLowerCase() === 'even') return total % 2 === 0 ? 'won' : 'lost';
  }

  return 'void';
}

// ===== API DATA FETCHERS =====
async function getGamesByDate(date: string): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games', { date });
  return (res.response || []).map(normalizeGame);
}

async function getGameById(id: number): Promise<NormalizedGame | null> {
  const res = await client.fetch<any[]>('games', { id });
  const g = res.response?.[0];
  return g ? normalizeGame(g) : null;
}

async function getLiveGames(): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games', { live: 'all' }, 60 * 1000);
  return (res.response || []).map(normalizeGame);
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  const res = await client.fetch<any[]>('odds', { game: gameId });
  const o = res.response?.[0];
  return o ? normalizeOdds(o) : null;
}

async function getH2H(homeTeamId: number, awayTeamId: number): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games/h2h', { h2h: `${homeTeamId}-${awayTeamId}` });
  return (res.response || []).map(normalizeGame);
}

async function getStandings(leagueId: number, season: number): Promise<any[]> {
  const res = await client.fetch<any[]>('standings', { league: leagueId, season });
  // Hockey standings come as array of groups (StandingGroup[])
  const groups = res.response || [];
  return groups.flat();
}

async function getTeamStatistics(teamId: number, leagueId: number, season: number): Promise<any> {
  const res = await client.fetch<any>('teams/statistics', {
    team: teamId,
    league: leagueId,
    season,
  });
  return res.response;
}

// ===== PLUGIN EXPORT =====
export const hockeyPlugin: SportPlugin = {
  config: hockeyConfig,
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
