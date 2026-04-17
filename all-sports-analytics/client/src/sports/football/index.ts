/**
 * Football (Soccer) Sport Plugin — Enhanced
 *
 * Faz 2 zenginleştirme:
 *   - Orijinal Poisson model (predict) korundu
 *   - Ensemble: model + market-anchored + StatsVault 3 kaynak birleştirme
 *   - Risk tier sınıflandırma (Platinum/Gold/Silver/Bronze)
 *   - İddaa market whitelist (sadece gerçek marketler değerlendirilir)
 *   - Momentum/decay form analizi
 *   - StatsVault yüksek güvenilirlik filtresi
 *   - Banko seçimi
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
} from '../_core';
import {
  fullEnsemble1X2,
  combine2Way,
  combineSelection,
  type EnsembleResult,
  type ProbabilitySet,
} from '../_core/ensemble';
import {
  classifyRiskTier,
  tierLabelTR,
  suggestedStakePercent,
  type RiskTier,
  type RiskTierResult,
} from '../_core/riskTier';
import {
  fetchStatsVaultPrediction,
  fetchStatsVaultOdds,
  statsVaultToProbabilitySet,
  type StatsVaultPrediction,
} from '../_core/statsVaultProvider';
import {
  calculateMarketConsensus,
  qualifyBet,
  removeOverround,
  type MarketConsensus,
  type QualificationResult,
} from '../_core/marketAnchored';
import { footballConfig } from './config';

const client = new SportApiClient(footballConfig.apiBase, footballConfig.apiKey);

// ===== IDDAA MARKET WHITELIST =====
const IDDAA_WHITELIST = new Set([
  'Match Winner', 'Home/Away', 'Double Chance',
  'Goals Over/Under', 'Both Teams Score',
  'Asian Handicap', 'Handicap Result',
  'Exact Score', 'HT/FT Double',
  'First Half Winner', 'Odd/Even',
  'Total - Home', 'Total - Away',
  'Goals Over/Under First Half',
  'Corners Over Under', 'Cards Over/Under',
  'Winning Margin', 'Exact Goals Number',
  'Second Half Winner',
  'Both Teams To Score - First Half',
  'Both Teams To Score - Second Half',
  'First Half Double Chance',
]);

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

// ===== MOMENTUM FORM ANALYSIS (Eagle port) =====
function momentumFormScore(form: string | undefined): number {
  if (!form) return 50;
  const chars = form.split('').slice(-10);
  let score = 0;
  let maxScore = 0;
  chars.forEach((c, i) => {
    // Decay: son maçlar daha ağırlıklı (exponential)
    const weight = Math.pow(1.25, i);
    maxScore += weight * 3;
    if (c === 'W') score += weight * 3;
    else if (c === 'D') score += weight * 1;
  });
  return maxScore > 0 ? (score / maxScore) * 100 : 50;
}

// ===== CORE PREDICTION (Poisson model) =====
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

  if (homeStats?.goals) {
    homeAttack = parseFloat(homeStats.goals?.for?.average?.home) || homeAttack;
    homeDefense = parseFloat(homeStats.goals?.against?.average?.home) || homeDefense;
  }
  if (awayStats?.goals) {
    awayAttack = parseFloat(awayStats.goals?.for?.average?.away) || awayAttack;
    awayDefense = parseFloat(awayStats.goals?.against?.average?.away) || awayDefense;
  }

  // Momentum-weighted form (Eagle port: decay factor)
  const homeForm = momentumFormScore(homeStanding?.form);
  const awayForm = momentumFormScore(awayStanding?.form);

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
  Object.entries(outcomes.overUnder).forEach(([k, v]) => { overUnder[String(k)] = v; });

  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => { handicaps[String(k)] = v; });

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

// ===== ENHANCED PREDICTION (Ensemble + Risk Tier + StatsVault) =====
export interface EnhancedPrediction extends Prediction {
  ensemble: {
    matchResult: { posterior: ProbabilitySet; overallConfidence: number };
    overUnder25?: { posterior: { yes: number; no: number }; confidence: number };
    bttsEnsemble?: { posterior: { yes: number; no: number }; confidence: number };
    statsVault: StatsVaultPrediction | null;
    sourceCount: number;
  };
  bankoPicks: BankoPick[];
}

export interface BankoPick {
  market: string;
  iddaaName: string;
  selection: string;
  posterior: number;
  tier: RiskTierResult;
  qualification: QualificationResult;
  odds?: number;
}

export async function predictWithEnsemble(params: {
  game: NormalizedGame;
  homeStats?: any;
  awayStats?: any;
  h2h?: NormalizedGame[];
  homeStanding?: any;
  awayStanding?: any;
  odds?: NormalizedOdds;
}): Promise<EnhancedPrediction> {
  const basePrediction = predict(params);

  // Model probs (0-1)
  const modelProbs: ProbabilitySet = {
    home: basePrediction.homeWinProb / 100,
    draw: basePrediction.drawProb / 100,
    away: basePrediction.awayWinProb / 100,
  };

  // StatsVault (opsiyonel 3. kaynak)
  let statsVault: StatsVaultPrediction | null = null;
  try {
    statsVault = await fetchStatsVaultPrediction({
      client,
      sport: 'football',
      gameId: params.game.id,
    });
  } catch { /* opsiyonel */ }

  // Ensemble 1X2
  const matchResult = fullEnsemble1X2({
    modelProbs,
    odds: params.odds,
    marketBetNames: ['Match Winner', '1X2', 'Full Time Result'],
    statsVault,
    uncertainty: {
      sampleSize: params.h2h?.length,
      leagueTier: 'mid',
    },
  });

  // Ensemble O/U 2.5
  let overUnder25Ensemble: { posterior: { yes: number; no: number }; confidence: number } | undefined;
  if (params.odds) {
    const ou25Model = basePrediction.overUnder['2.5'];
    if (ou25Model) {
      const ou25Result = combine2Way({
        model: { yes: ou25Model.over, no: ou25Model.under },
        uncertainty: { sampleSize: params.h2h?.length },
      });
      overUnder25Ensemble = {
        posterior: ou25Result.posterior,
        confidence: ou25Result.overallConfidence,
      };
    }
  }

  // Ensemble BTTS
  let bttsEnsemble: { posterior: { yes: number; no: number }; confidence: number } | undefined;
  if (basePrediction.btts) {
    const bttsResult = combine2Way({
      model: { yes: basePrediction.btts.yes / 100, no: basePrediction.btts.no / 100 },
      uncertainty: { sampleSize: params.h2h?.length },
    });
    bttsEnsemble = {
      posterior: bttsResult.posterior,
      confidence: bttsResult.overallConfidence,
    };
  }

  // Banko picks: iddaa whitelist'teki marketlerde yüksek güvenli seçimler
  const bankoPicks: BankoPick[] = [];

  // 1X2 banko check
  const matchResultPosterior = matchResult.posterior;
  const selections = [
    { sel: 'Home', prob: matchResultPosterior.home, detail: matchResult.details.home },
    { sel: 'Draw', prob: matchResultPosterior.draw, detail: matchResult.details.draw },
    { sel: 'Away', prob: matchResultPosterior.away, detail: matchResult.details.away },
  ];

  for (const s of selections) {
    if (s.prob >= 0.60 && s.detail.banko) {
      const riskResult = classifyRiskTier({
        trueProbability: s.prob,
        edge: 0,
        odds: 1 / s.prob,
        sourceCount: s.detail.sourceCount,
        agreementScore: s.detail.agreementScore,
        statsVaultConfidence: statsVault?.confidence,
      });
      if (riskResult.tier !== 'reject') {
        bankoPicks.push({
          market: 'Match Winner',
          iddaaName: footballConfig.marketNameMapping['Match Winner'] ?? 'Maç Sonucu',
          selection: s.sel,
          posterior: s.prob,
          tier: riskResult,
          qualification: { qualified: true, breakdown: riskResult.breakdown as any },
        });
      }
    }
  }

  // O/U 2.5 banko check
  if (overUnder25Ensemble) {
    for (const dir of ['yes', 'no'] as const) {
      const prob = overUnder25Ensemble.posterior[dir];
      if (prob >= 0.65) {
        const riskResult = classifyRiskTier({
          trueProbability: prob,
          edge: 0.03,
          odds: 1 / prob,
          sourceCount: 2,
          agreementScore: overUnder25Ensemble.confidence,
        });
        if (riskResult.tier !== 'reject') {
          bankoPicks.push({
            market: 'Goals Over/Under',
            iddaaName: footballConfig.marketNameMapping['Goals Over/Under'] ?? 'Alt/Üst',
            selection: dir === 'yes' ? 'Üst 2.5' : 'Alt 2.5',
            posterior: prob,
            tier: riskResult,
            qualification: { qualified: true, breakdown: riskResult.breakdown as any },
          });
        }
      }
    }
  }

  // BTTS banko check
  if (bttsEnsemble) {
    for (const dir of ['yes', 'no'] as const) {
      const prob = bttsEnsemble.posterior[dir];
      if (prob >= 0.68) {
        const riskResult = classifyRiskTier({
          trueProbability: prob,
          edge: 0.03,
          odds: 1 / prob,
          sourceCount: 2,
          agreementScore: bttsEnsemble.confidence,
        });
        if (riskResult.tier !== 'reject') {
          bankoPicks.push({
            market: 'Both Teams Score',
            iddaaName: footballConfig.marketNameMapping['Both Teams Score'] ?? 'KG',
            selection: dir === 'yes' ? 'KG Var' : 'KG Yok',
            posterior: prob,
            tier: riskResult,
            qualification: { qualified: true, breakdown: riskResult.breakdown as any },
          });
        }
      }
    }
  }

  // Sort bankos: platinum first, then gold, etc.
  const tierOrder: RiskTier[] = ['platinum', 'gold', 'silver', 'bronze'];
  bankoPicks.sort((a, b) => tierOrder.indexOf(a.tier.tier) - tierOrder.indexOf(b.tier.tier));

  return {
    ...basePrediction,
    // Override with ensemble posteriors where available
    homeWinProb: matchResultPosterior.home * 100,
    drawProb: matchResultPosterior.draw * 100,
    awayWinProb: matchResultPosterior.away * 100,
    ensemble: {
      matchResult: {
        posterior: matchResultPosterior,
        overallConfidence: matchResult.overallConfidence,
      },
      overUnder25: overUnder25Ensemble,
      bttsEnsemble,
      statsVault,
      sourceCount: matchResult.details.home.sourceCount,
    },
    bankoPicks,
  };
}

// ===== MARKET EVALUATOR (unchanged) =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = betName.toLowerCase();
  const sel = selection.trim();

  // İddaa whitelist filtresi: sadece gerçek marketleri değerlendir
  if (!IDDAA_WHITELIST.has(betName) && !IDDAA_WHITELIST.has(betName.trim())) {
    const found = Array.from(IDDAA_WHITELIST).some(
      wl => wl.toLowerCase() === name
    );
    if (!found) return 0;
  }

  if (name === 'match winner' || name === '1x2') {
    if (sel === '1' || sel === 'Home' || sel === 'home') return prediction.homeWinProb / 100;
    if (sel === 'X' || sel === 'Draw' || sel === 'draw') return prediction.drawProb / 100;
    if (sel === '2' || sel === 'Away' || sel === 'away') return prediction.awayWinProb / 100;
  }
  if (name === 'home/away') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total === 0) return 0;
    if (sel === 'Home') return prediction.homeWinProb / total;
    if (sel === 'Away') return prediction.awayWinProb / total;
  }
  if (name === 'double chance' || name.includes('double chance')) {
    if (sel === 'Home/Draw' || sel === '1X' || sel === '1x') return (prediction.homeWinProb + prediction.drawProb) / 100;
    if (sel === 'Draw/Away' || sel === 'X2' || sel === 'x2') return (prediction.drawProb + prediction.awayWinProb) / 100;
    if (sel === 'Home/Away' || sel === '12') return (prediction.homeWinProb + prediction.awayWinProb) / 100;
  }
  if (name === 'both teams score' || name === 'both teams to score') {
    if (sel === 'Yes') return (prediction.btts?.yes ?? 0) / 100;
    if (sel === 'No') return (prediction.btts?.no ?? 0) / 100;
  }
  if (name === 'goals over/under' || name === 'over/under') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;
    }
  }
  if (name.includes('handicap') && !name.includes('asian')) {
    const match = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (match) {
      const side = match[1];
      const line = parseFloat(match[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) return side === 'Home' ? hc.home : hc.away;
    }
  }
  if (name === 'asian handicap' || name.includes('asian handicap')) {
    const splitMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)\s*\/\s*([-+]?[\d.]+)/);
    if (splitMatch) {
      return splitHandicapProb(
        prediction.expectedHomeScore,
        prediction.expectedAwayScore,
        parseFloat(splitMatch[2]),
        parseFloat(splitMatch[3]),
        splitMatch[1] === 'Home'
      );
    }
    const match = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (match) {
      const hc = prediction.handicaps?.[match[2]];
      if (hc) {
        const total = (hc.home ?? 0) + (hc.away ?? 0);
        if (total === 0) return 0;
        return match[1] === 'Home' ? hc.home / total : hc.away / total;
      }
    }
  }
  if (name === 'exact score' || name === 'correct score') {
    const parts = sel.split(/[-:]/).map(s => parseInt(s.trim()));
    if (parts.length === 2) {
      const found = prediction.mostLikelyScores.find(s => s.home === parts[0] && s.away === parts[1]);
      if (found) return found.probability;
    }
  }
  if (name === 'odd/even') {
    const oddProb = prediction.mostLikelyScores.filter(s => (s.home + s.away) % 2 === 1).reduce((a, b) => a + b.probability, 0);
    const evenProb = prediction.mostLikelyScores.filter(s => (s.home + s.away) % 2 === 0).reduce((a, b) => a + b.probability, 0);
    const total = oddProb + evenProb;
    if (total > 0) {
      if (sel === 'Odd') return oddProb / total;
      if (sel === 'Even') return evenProb / total;
    }
  }
  if (name === 'total - home') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const lambda = prediction.expectedHomeScore;
      let pOver = 0;
      for (let k = Math.ceil(line); k <= 12; k++) pOver += Math.exp(-lambda) * Math.pow(lambda, k) / factorialMini(k);
      return dir === 'over' ? pOver : 1 - pOver;
    }
  }
  if (name === 'total - away') {
    const match = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const lambda = prediction.expectedAwayScore;
      let pOver = 0;
      for (let k = Math.ceil(line); k <= 12; k++) pOver += Math.exp(-lambda) * Math.pow(lambda, k) / factorialMini(k);
      return dir === 'over' ? pOver : 1 - pOver;
    }
  }
  if (name === 'first half winner') {
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

// ===== BET RESULT EVALUATOR (unchanged) =====
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
    if (h === a) return 'void';
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
