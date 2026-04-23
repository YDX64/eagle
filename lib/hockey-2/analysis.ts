/**
 * AWA Stats - Gelişmiş Analiz Motoru & Tahmin Algoritmaları
 * Arctic Futurism Theme
 * 
 * Algoritmalar:
 * 1. ELO Rating System (Takım güç sıralaması)
 * 2. Poisson Distribution (Gol tahminleri)
 * 3. Form Analysis (Son maç performansı)
 * 4. Head-to-Head Analysis (Karşılıklı geçmiş)
 * 5. Home/Away Advantage (Ev sahibi avantajı)
 * 6. Value Bet Detection (Değerli bahis tespiti)
 * 7. Kelly Criterion (Optimal bahis miktarı)
 * 8. Coupon Strategy (Sistem kupon önerileri)
 */

import type { Game, Standing, TeamStatistics, OddsResponse, BookmakerOdds, BetOdds, GameEvent } from './api';

// ===== ELO RATING SYSTEM =====
export interface EloRating {
  teamId: number;
  teamName: string;
  rating: number;
  trend: 'up' | 'down' | 'stable';
}

const BASE_ELO = 1500;
const K_FACTOR = 32;

export function calculateEloFromStandings(standings: Standing[]): EloRating[] {
  return standings.map(s => {
    const winRate = parseFloat(s.games.win.percentage);
    const goalDiff = s.goals.for - s.goals.against;
    const gamesPlayed = s.games.played;
    
    // ELO = Base + (WinRate * 400) + (GoalDiff / GamesPlayed * 50) + (Points * 2)
    const rating = Math.round(
      BASE_ELO + 
      (winRate * 400) + 
      (gamesPlayed > 0 ? (goalDiff / gamesPlayed) * 50 : 0) + 
      (s.points * 2)
    );

    const formArr = s.form ? s.form.split('') : [];
    const recentWins = formArr.slice(-3).filter(f => f === 'W').length;
    const trend: 'up' | 'down' | 'stable' = recentWins >= 2 ? 'up' : recentWins === 0 ? 'down' : 'stable';

    return { teamId: s.team.id, teamName: s.team.name, rating, trend };
  }).sort((a, b) => b.rating - a.rating);
}

// ===== POISSON DISTRIBUTION =====
function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export interface ScorePrediction {
  homeGoals: number;
  awayGoals: number;
  probability: number;
}

export interface MatchPrediction {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  overUnder25: { over: number; under: number };
  overUnder35: { over: number; under: number };
  overUnder45: { over: number; under: number };
  overUnder55: { over: number; under: number };
  btts: { yes: number; no: number };
  mostLikelyScores: ScorePrediction[];
  confidence: number;
  homeForm: number;
  awayForm: number;
}

export function predictMatch(
  homeStats: TeamStatistics | null,
  awayStats: TeamStatistics | null,
  h2hGames: Game[],
  homeStanding: Standing | null,
  awayStanding: Standing | null
): MatchPrediction {
  // Varsayılan değerler
  let homeAttack = 2.8;
  let homeDefense = 2.5;
  let awayAttack = 2.5;
  let awayDefense = 2.8;
  let homeFormScore = 50;
  let awayFormScore = 50;

  // Takım istatistiklerinden gol ortalamaları
  if (homeStats) {
    homeAttack = parseFloat(homeStats.goals.for.average.home) || 2.8;
    homeDefense = parseFloat(homeStats.goals.against.average.home) || 2.5;
  }
  if (awayStats) {
    awayAttack = parseFloat(awayStats.goals.for.average.away) || 2.5;
    awayDefense = parseFloat(awayStats.goals.against.average.away) || 2.8;
  }

  // Form analizi
  if (homeStanding?.form) {
    homeFormScore = calculateFormScore(homeStanding.form);
  }
  if (awayStanding?.form) {
    awayFormScore = calculateFormScore(awayStanding.form);
  }

  // H2H düzeltmesi
  let h2hAdjustment = 0;
  if (h2hGames.length > 0) {
    const h2hResult = analyzeH2H(h2hGames, homeStats?.team?.id || 0);
    h2hAdjustment = (h2hResult.homeWinRate - h2hResult.awayWinRate) * 0.3;
  }

  // Ev sahibi avantajı (%8-12 arası)
  const homeAdvantage = 1.1;

  // Beklenen goller (Poisson lambda)
  const formFactor = (homeFormScore / awayFormScore);
  const expectedHomeGoals = Math.max(0.5, ((homeAttack + awayDefense) / 2) * homeAdvantage * Math.pow(formFactor, 0.3) + h2hAdjustment);
  const expectedAwayGoals = Math.max(0.5, ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.15) - h2hAdjustment * 0.5);

  // Poisson dağılımı ile olasılık hesaplama
  let homeWin = 0, draw = 0, awayWin = 0;
  let over25 = 0, over35 = 0, over45 = 0, over55 = 0;
  let bttsYes = 0;
  const scores: ScorePrediction[] = [];

  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const prob = poissonProbability(expectedHomeGoals, h) * poissonProbability(expectedAwayGoals, a);
      
      if (h > a) homeWin += prob;
      else if (h === a) draw += prob;
      else awayWin += prob;

      if (h + a > 2.5) over25 += prob;
      if (h + a > 3.5) over35 += prob;
      if (h + a > 4.5) over45 += prob;
      if (h + a > 5.5) over55 += prob;
      if (h > 0 && a > 0) bttsYes += prob;

      if (h <= 6 && a <= 6) {
        scores.push({ homeGoals: h, awayGoals: a, probability: prob });
      }
    }
  }

  // Normalize
  const total = homeWin + draw + awayWin;
  homeWin /= total;
  draw /= total;
  awayWin /= total;

  // En olası skorlar
  const topScores = scores.sort((a, b) => b.probability - a.probability).slice(0, 8);

  // Güven skoru (veri kalitesine göre)
  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2hGames.length >= 3) confidence += 15;
  if (homeStanding) confidence += 7.5;
  if (awayStanding) confidence += 7.5;
  confidence = Math.min(95, confidence);

  return {
    homeWinProb: homeWin * 100,
    drawProb: draw * 100,
    awayWinProb: awayWin * 100,
    expectedHomeGoals,
    expectedAwayGoals,
    expectedTotalGoals: expectedHomeGoals + expectedAwayGoals,
    overUnder25: { over: over25 * 100, under: (1 - over25) * 100 },
    overUnder35: { over: over35 * 100, under: (1 - over35) * 100 },
    overUnder45: { over: over45 * 100, under: (1 - over45) * 100 },
    overUnder55: { over: over55 * 100, under: (1 - over55) * 100 },
    btts: { yes: bttsYes * 100, no: (1 - bttsYes) * 100 },
    mostLikelyScores: topScores,
    confidence,
    homeForm: homeFormScore,
    awayForm: awayFormScore,
  };
}

// ===== FORM ANALYSIS =====
function calculateFormScore(form: string): number {
  const weights = [1, 1.2, 1.5, 1.8, 2.2]; // Son maçlara daha fazla ağırlık
  const chars = form.split('').slice(-5);
  let score = 0;
  let maxScore = 0;
  
  chars.forEach((c, i) => {
    const weight = weights[i] || 1;
    maxScore += weight * 3;
    if (c === 'W') score += weight * 3;
    else if (c === 'D') score += weight * 1;
    // L = 0
  });

  return maxScore > 0 ? (score / maxScore) * 100 : 50;
}

// ===== HEAD TO HEAD ANALYSIS =====
export interface H2HAnalysis {
  totalGames: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  homeWinRate: number;
  awayWinRate: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  avgTotalGoals: number;
  over25Rate: number;
  bttsRate: number;
  recentResults: { date: string; homeTeam: string; awayTeam: string; score: string; winner: string }[];
}

export function analyzeH2H(games: Game[], homeTeamId: number): H2HAnalysis {
  let homeWins = 0, draws = 0, awayWins = 0;
  let totalHomeGoals = 0, totalAwayGoals = 0;
  let over25Count = 0, bttsCount = 0;

  const recentResults = games.slice(0, 10).map(g => {
    const isHome = g.teams.home.id === homeTeamId;
    const hGoals = g.scores.home || 0;
    const aGoals = g.scores.away || 0;

    if (isHome) {
      totalHomeGoals += hGoals;
      totalAwayGoals += aGoals;
      if (hGoals > aGoals) homeWins++;
      else if (hGoals === aGoals) draws++;
      else awayWins++;
    } else {
      totalHomeGoals += aGoals;
      totalAwayGoals += hGoals;
      if (aGoals > hGoals) homeWins++;
      else if (hGoals === aGoals) draws++;
      else awayWins++;
    }

    if (hGoals + aGoals > 2.5) over25Count++;
    if (hGoals > 0 && aGoals > 0) bttsCount++;

    return {
      date: g.date,
      homeTeam: g.teams.home.name,
      awayTeam: g.teams.away.name,
      score: `${hGoals}-${aGoals}`,
      winner: hGoals > aGoals ? g.teams.home.name : hGoals < aGoals ? g.teams.away.name : 'Berabere',
    };
  });

  const total = games.length || 1;

  return {
    totalGames: games.length,
    homeWins,
    draws,
    awayWins,
    homeWinRate: homeWins / total,
    awayWinRate: awayWins / total,
    avgHomeGoals: totalHomeGoals / total,
    avgAwayGoals: totalAwayGoals / total,
    avgTotalGoals: (totalHomeGoals + totalAwayGoals) / total,
    over25Rate: over25Count / total,
    bttsRate: bttsCount / total,
    recentResults,
  };
}

// ===== VALUE BET DETECTION =====
export interface ValueBet {
  betType: string;
  selection: string;
  bookmaker: string;
  odds: number;
  impliedProb: number;
  trueProbability: number;
  edge: number; // (trueProbability - impliedProbability) / impliedProbability
  kellyStake: number;
  rating: 'excellent' | 'good' | 'moderate' | 'low';
  confidence: number;
}

export function detectValueBets(
  prediction: MatchPrediction,
  oddsData: OddsResponse | null
): ValueBet[] {
  if (!oddsData || !oddsData.bookmakers) return [];

  const valueBets: ValueBet[] = [];

  oddsData.bookmakers.forEach(bm => {
    bm.bets.forEach(bet => {
      const detectedBets = analyzeBetForValue(bet, bm.name, prediction);
      valueBets.push(...detectedBets);
    });
  });

  // Edge'e göre sırala
  return valueBets.sort((a, b) => b.edge - a.edge);
}

function analyzeBetForValue(bet: BetOdds, bookmaker: string, prediction: MatchPrediction): ValueBet[] {
  const results: ValueBet[] = [];

  bet.values.forEach(v => {
    const odds = parseFloat(v.odd);
    if (isNaN(odds) || odds <= 1) return;

    const impliedProb = 1 / odds;
    let trueProbability = 0;
    let betType = bet.name;
    let selection = v.value;

    // Periyot bazlı bahisleri tespit et - bunlar için farklı lambda kullan
    const isPeriodBet = bet.name.includes('Period') || bet.name.includes('period') || bet.name.includes('min.');
    // Periyot bazlı goller: maç genelinin ~1/3'ü
    const periodFactor = 0.33;
    const periodHomeGoals = prediction.expectedHomeGoals * periodFactor;
    const periodAwayGoals = prediction.expectedAwayGoals * periodFactor;
    const periodTotalGoals = periodHomeGoals + periodAwayGoals;

    // 3Way Result (sadece maç geneli)
    if (bet.name === '3Way Result' && !isPeriodBet) {
      if (v.value === 'Home') trueProbability = prediction.homeWinProb / 100;
      else if (v.value === 'Draw') trueProbability = prediction.drawProb / 100;
      else if (v.value === 'Away') trueProbability = prediction.awayWinProb / 100;
    }
    // 1x2 Periyot bazlı
    else if (isPeriodBet && (bet.name.includes('1x2') || bet.name.includes('3Way'))) {
      // Periyot bazlı olasılıklar: daha dengeli
      const pHomeWin = calculatePeriodWinProb(periodHomeGoals, periodAwayGoals);
      const pAwayWin = calculatePeriodWinProb(periodAwayGoals, periodHomeGoals);
      const pDraw = 1 - pHomeWin - pAwayWin;
      if (v.value === 'Home') trueProbability = pHomeWin;
      else if (v.value === 'Draw') trueProbability = Math.max(0.1, pDraw);
      else if (v.value === 'Away') trueProbability = pAwayWin;
    }
    // Home/Away
    else if (bet.name === 'Home/Away' && !isPeriodBet) {
      const totalNonDraw = prediction.homeWinProb + prediction.awayWinProb;
      if (v.value === 'Home') trueProbability = prediction.homeWinProb / totalNonDraw;
      else if (v.value === 'Away') trueProbability = prediction.awayWinProb / totalNonDraw;
    }
    // Over/Under - Maç geneli (sadece "Over/Under" veya "Over/Under (Reg Time)")
    else if ((bet.name === 'Over/Under' || bet.name === 'Over/Under (Reg Time)') && !isPeriodBet) {
      const line = parseFloat(v.value.replace('Over ', '').replace('Under ', ''));
      if (v.value.startsWith('Over')) {
        if (line === 2.5) trueProbability = prediction.overUnder25.over / 100;
        else if (line === 3.5) trueProbability = prediction.overUnder35.over / 100;
        else if (line === 4.5) trueProbability = prediction.overUnder45.over / 100;
        else if (line === 5.5) trueProbability = prediction.overUnder55.over / 100;
      } else if (v.value.startsWith('Under')) {
        if (line === 2.5) trueProbability = prediction.overUnder25.under / 100;
        else if (line === 3.5) trueProbability = prediction.overUnder35.under / 100;
        else if (line === 4.5) trueProbability = prediction.overUnder45.under / 100;
        else if (line === 5.5) trueProbability = prediction.overUnder55.under / 100;
      }
    }
    // Over/Under - Periyot bazlı
    else if (bet.name.includes('Over/Under') && isPeriodBet) {
      const line = parseFloat(v.value.replace('Over ', '').replace('Under ', ''));
      if (!isNaN(line)) {
        const periodOU = calculatePeriodOverUnder(periodTotalGoals, line);
        if (v.value.startsWith('Over')) trueProbability = periodOU;
        else if (v.value.startsWith('Under')) trueProbability = 1 - periodOU;
      }
    }
    // Both Teams To Score - Maç geneli
    else if (bet.name === 'Both Teams To Score' && !isPeriodBet) {
      if (v.value === 'Yes') trueProbability = prediction.btts.yes / 100;
      else if (v.value === 'No') trueProbability = prediction.btts.no / 100;
    }
    // Both Teams To Score - Periyot bazlı
    else if (bet.name.includes('Both Teams') && isPeriodBet) {
      const periodBtts = (1 - Math.exp(-periodHomeGoals)) * (1 - Math.exp(-periodAwayGoals));
      if (v.value === 'Yes') trueProbability = periodBtts;
      else if (v.value === 'No') trueProbability = 1 - periodBtts;
    }
    // Double Chance
    else if (bet.name === 'Double Chance') {
      if (v.value === '1X' || v.value === 'Home/Draw') trueProbability = (prediction.homeWinProb + prediction.drawProb) / 100;
      else if (v.value === 'X2' || v.value === 'Draw/Away') trueProbability = (prediction.drawProb + prediction.awayWinProb) / 100;
      else if (v.value === '12' || v.value === 'Home/Away') trueProbability = (prediction.homeWinProb + prediction.awayWinProb) / 100;
    }

    if (trueProbability > 0) {
      const edge = (trueProbability - impliedProb) / impliedProb;
      const kellyStake = calculateKelly(trueProbability, odds);

      if (edge > 0.03) { // En az %3 edge
        let rating: 'excellent' | 'good' | 'moderate' | 'low' = 'low';
        if (edge > 0.25) rating = 'excellent';
        else if (edge > 0.15) rating = 'good';
        else if (edge > 0.08) rating = 'moderate';

        results.push({
          betType,
          selection,
          bookmaker,
          odds,
          impliedProb: impliedProb * 100,
          trueProbability: trueProbability * 100,
          edge: edge * 100,
          kellyStake: kellyStake * 100,
          rating,
          confidence: prediction.confidence,
        });
      }
    }
  });

  return results;
}

// ===== PERIOD HELPER FUNCTIONS =====
function calculatePeriodWinProb(teamGoals: number, opponentGoals: number): number {
  // Poisson kullanarak bir periyotta bir takımın kazanma olasılığı
  let winProb = 0;
  for (let t = 1; t <= 6; t++) {
    for (let o = 0; o < t; o++) {
      winProb += poissonProbability(teamGoals, t) * poissonProbability(opponentGoals, o);
    }
  }
  return winProb;
}

function calculatePeriodOverUnder(expectedGoals: number, line: number): number {
  // Poisson kullanarak periyot Over olasılığı
  let underProb = 0;
  const threshold = Math.floor(line);
  for (let k = 0; k <= threshold; k++) {
    underProb += poissonProbability(expectedGoals, k);
  }
  return 1 - underProb;
}

// ===== KELLY CRITERION =====
function calculateKelly(probability: number, odds: number): number {
  // Kelly = (bp - q) / b
  // b = odds - 1 (net odds)
  // p = probability of winning
  // q = 1 - p
  const b = odds - 1;
  const p = probability;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  
  // Fractional Kelly (%25) - daha güvenli
  return Math.max(0, kelly * 0.25);
}

// ===== COUPON STRATEGY =====
export interface CouponBet {
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  betType: string;
  selection: string;
  odds: number;
  trueProbability: number;
  edge: number;
  confidence: number;
}

export interface CouponStrategy {
  name: string;
  description: string;
  bets: CouponBet[];
  totalOdds: number;
  expectedProbability: number;
  expectedValue: number;
  riskLevel: 'low' | 'medium' | 'high' | 'very-high';
  suggestedStake: number;
  potentialReturn: number;
}

export function generateCouponStrategies(
  allValueBets: { gameId: number; homeTeam: string; awayTeam: string; valueBets: ValueBet[] }[]
): CouponStrategy[] {
  const strategies: CouponStrategy[] = [];

  // Tüm value bet'leri düzleştir
  const flatBets: CouponBet[] = [];
  allValueBets.forEach(g => {
    g.valueBets.forEach(vb => {
      flatBets.push({
        gameId: g.gameId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        betType: vb.betType,
        selection: vb.selection,
        odds: vb.odds,
        trueProbability: vb.trueProbability,
        edge: vb.edge,
        confidence: vb.confidence,
      });
    });
  });

  // Her maçtan en iyi bahisi seç (tekrar etmesin)
  const bestPerGame = new Map<number, CouponBet>();
  flatBets.forEach(b => {
    const existing = bestPerGame.get(b.gameId);
    if (!existing || b.edge > existing.edge) {
      bestPerGame.set(b.gameId, b);
    }
  });
  const uniqueBets = Array.from(bestPerGame.values()).sort((a, b) => b.edge - a.edge);

  // Strateji 1: Güvenli Kupon (Yüksek olasılık, düşük oran)
  const safeBets = uniqueBets.filter(b => b.trueProbability > 55 && b.odds < 2.5).slice(0, 4);
  if (safeBets.length >= 2) {
    const totalOdds = safeBets.reduce((acc, b) => acc * b.odds, 1);
    const expectedProb = safeBets.reduce((acc, b) => acc * (b.trueProbability / 100), 1);
    strategies.push({
      name: 'Güvenli Kupon',
      description: 'Yüksek olasılıklı, düşük riskli bahislerden oluşan kupon. Düzenli kazanç hedefler.',
      bets: safeBets,
      totalOdds: Math.round(totalOdds * 100) / 100,
      expectedProbability: expectedProb * 100,
      expectedValue: totalOdds * expectedProb,
      riskLevel: 'low',
      suggestedStake: 5,
      potentialReturn: Math.round(totalOdds * 5 * 100) / 100,
    });
  }

  // Strateji 2: Değer Kuponu (Yüksek edge, orta oran)
  const valueBetsList = uniqueBets.filter(b => b.edge > 10 && b.odds >= 1.5 && b.odds <= 4).slice(0, 5);
  if (valueBetsList.length >= 2) {
    const totalOdds = valueBetsList.reduce((acc, b) => acc * b.odds, 1);
    const expectedProb = valueBetsList.reduce((acc, b) => acc * (b.trueProbability / 100), 1);
    strategies.push({
      name: 'Değer Kuponu',
      description: 'En yüksek edge değerine sahip bahisler. Uzun vadede kar garantisi.',
      bets: valueBetsList,
      totalOdds: Math.round(totalOdds * 100) / 100,
      expectedProbability: expectedProb * 100,
      expectedValue: totalOdds * expectedProb,
      riskLevel: 'medium',
      suggestedStake: 3,
      potentialReturn: Math.round(totalOdds * 3 * 100) / 100,
    });
  }

  // Strateji 3: Yüksek Oranlı Kupon (Yüksek oranlar, yüksek risk)
  const highOddsBets = uniqueBets.filter(b => b.odds >= 2.5 && b.edge > 5).slice(0, 4);
  if (highOddsBets.length >= 2) {
    const totalOdds = highOddsBets.reduce((acc, b) => acc * b.odds, 1);
    const expectedProb = highOddsBets.reduce((acc, b) => acc * (b.trueProbability / 100), 1);
    strategies.push({
      name: 'Yüksek Oranlı Kupon',
      description: 'Yüksek oranlarla büyük kazanç potansiyeli. Risk yüksek ama edge pozitif.',
      bets: highOddsBets,
      totalOdds: Math.round(totalOdds * 100) / 100,
      expectedProbability: expectedProb * 100,
      expectedValue: totalOdds * expectedProb,
      riskLevel: 'high',
      suggestedStake: 1,
      potentialReturn: Math.round(totalOdds * 1 * 100) / 100,
    });
  }

  // Strateji 4: Sistem Kuponu (3/4 veya 4/5 kombinasyonlar)
  const systemBets = uniqueBets.filter(b => b.edge > 8).slice(0, 5);
  if (systemBets.length >= 4) {
    const avgOdds = systemBets.reduce((acc, b) => acc + b.odds, 0) / systemBets.length;
    // 3/5 sistem: 10 kombinasyon
    const combCount = systemBets.length === 5 ? 10 : systemBets.length === 4 ? 4 : 1;
    const systemOdds = Math.pow(avgOdds, 3); // Ortalama 3'lü kombinasyon
    strategies.push({
      name: `Sistem Kuponu (3/${systemBets.length})`,
      description: `${systemBets.length} bahisten 3'ünün tutması yeterli. ${combCount} kombinasyon. Kayıp riski minimize edilir.`,
      bets: systemBets,
      totalOdds: Math.round(systemOdds * 100) / 100,
      expectedProbability: calculateSystemProbability(systemBets.map(b => b.trueProbability / 100), 3) * 100,
      expectedValue: systemOdds * calculateSystemProbability(systemBets.map(b => b.trueProbability / 100), 3),
      riskLevel: 'medium',
      suggestedStake: 2,
      potentialReturn: Math.round(systemOdds * 2 * 100) / 100,
    });
  }

  // Strateji 5: Agresif Yüksek Oran Kuponu
  const aggressiveBets = uniqueBets.filter(b => b.odds >= 3.0).slice(0, 3);
  if (aggressiveBets.length >= 2) {
    const totalOdds = aggressiveBets.reduce((acc, b) => acc * b.odds, 1);
    const expectedProb = aggressiveBets.reduce((acc, b) => acc * (b.trueProbability / 100), 1);
    strategies.push({
      name: 'Agresif Yüksek Oran',
      description: 'Çok yüksek oranlarla maksimum kazanç. Küçük yatırım, büyük dönüş potansiyeli.',
      bets: aggressiveBets,
      totalOdds: Math.round(totalOdds * 100) / 100,
      expectedProbability: expectedProb * 100,
      expectedValue: totalOdds * expectedProb,
      riskLevel: 'very-high',
      suggestedStake: 0.5,
      potentialReturn: Math.round(totalOdds * 0.5 * 100) / 100,
    });
  }

  return strategies;
}

// Sistem kuponu olasılık hesaplama (n'den k'sinin tutma olasılığı)
function calculateSystemProbability(probs: number[], minWins: number): number {
  const n = probs.length;
  let totalProb = 0;

  // Tüm kombinasyonları hesapla
  function combinations(arr: number[], k: number, start: number, current: number[]): number[][] {
    if (current.length === k) return [current.slice()];
    const results: number[][] = [];
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      results.push(...combinations(arr, k, i + 1, current));
      current.pop();
    }
    return results;
  }

  for (let wins = minWins; wins <= n; wins++) {
    const combos = combinations(probs, wins, 0, []);
    combos.forEach(combo => {
      let prob = 1;
      probs.forEach((p, i) => {
        if (combo.includes(p)) prob *= p;
        else prob *= (1 - p);
      });
      totalProb += prob;
    });
  }

  return Math.min(1, totalProb);
}

// ===== ODDS COMPARISON =====
export interface OddsComparison {
  betType: string;
  selections: {
    value: string;
    bestOdds: number;
    bestBookmaker: string;
    worstOdds: number;
    worstBookmaker: string;
    allOdds: { bookmaker: string; odds: number }[];
    avgOdds: number;
  }[];
}

export function compareOdds(bookmakers: BookmakerOdds[]): OddsComparison[] {
  const betMap = new Map<string, Map<string, { bookmaker: string; odds: number }[]>>();

  bookmakers.forEach(bm => {
    bm.bets.forEach(bet => {
      if (!betMap.has(bet.name)) betMap.set(bet.name, new Map());
      const selMap = betMap.get(bet.name)!;
      
      bet.values.forEach(v => {
        if (!selMap.has(v.value)) selMap.set(v.value, []);
        selMap.get(v.value)!.push({ bookmaker: bm.name, odds: parseFloat(v.odd) });
      });
    });
  });

  const comparisons: OddsComparison[] = [];
  betMap.forEach((selMap, betType) => {
    const selections = Array.from(selMap.entries()).map(([value, odds]) => {
      const sorted = odds.sort((a, b) => b.odds - a.odds);
      const avg = odds.reduce((acc, o) => acc + o.odds, 0) / odds.length;
      return {
        value,
        bestOdds: sorted[0].odds,
        bestBookmaker: sorted[0].bookmaker,
        worstOdds: sorted[sorted.length - 1].odds,
        worstBookmaker: sorted[sorted.length - 1].bookmaker,
        allOdds: sorted,
        avgOdds: Math.round(avg * 100) / 100,
      };
    });
    comparisons.push({ betType, selections });
  });

  return comparisons;
}

// ===== MATCH ANALYSIS SUMMARY =====
export interface MatchAnalysisSummary {
  prediction: MatchPrediction;
  h2h: H2HAnalysis | null;
  valueBets: ValueBet[];
  oddsComparison: OddsComparison[];
  recommendation: string;
  riskLevel: string;
  topPick: ValueBet | null;
}
