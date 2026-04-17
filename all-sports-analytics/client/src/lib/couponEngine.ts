/**
 * Multi-Sport Coupon Engine — Market-Anchored Bayesian
 *
 * ESKI PIPELINE SILINDI. Yeni pipeline:
 *
 *   1. İddaa market whitelist (eski)
 *   2. Her selection için aynı bet type'da tüm bookmaker quotes topla
 *   3. Overround düzeltilmiş market consensus hesapla (= Bayesian prior)
 *   4. Model tahminini piyasa prior'ına ±5% clamp et
 *   5. Uncertainty factor uygula (sample size, spread, data freshness)
 *   6. Quality-First criteria'dan geçir (strict)
 *   7. Geçerse → ValueBet
 *
 * Beklenen sonuç: Günde 2-5 bet, %55-60 hit rate (prev %16), +ROI mümkün.
 */

import type {
  CouponBet,
  ValueBet,
  CouponFilterConfig,
  SportPlugin,
  NormalizedGame,
  NormalizedOdds,
  SportId,
} from '../sports/_core/types';
import {
  calculateMarketConsensus,
  qualifyBet,
  QUALITY_FIRST_DEFAULTS,
  type MarketConsensus,
  type QualityFirstCriteria,
} from '../sports/_core/marketAnchored';
import { kellyStake } from '../sports/_core/kelly';
import { isIddaaMarket, getIddaaName } from './iddaaMarkets';

/**
 * Quality-First Filter Config - eski filter'ı override ediyor
 */
export const DEFAULT_FILTERS: CouponFilterConfig = {
  minOdds: QUALITY_FIRST_DEFAULTS.minOdds,       // 1.60
  maxOdds: QUALITY_FIRST_DEFAULTS.maxOdds,       // 2.20
  minProbability: QUALITY_FIRST_DEFAULTS.minPosterior * 100, // 58%
  minEdge: 0,  // Artık kullanılmıyor — qualifyBet() içinde max 5% edge
  allowDraws: true,
  allowedSports: [
    'football', 'hockey', 'basketball', 'nba', 'handball',
    'americanFootball', 'baseball', 'volleyball', 'rugby',
    'mma', 'afl', 'formula1',
  ],
  maxBetsPerCoupon: 5,
  minBetsPerCoupon: 2,
};

/**
 * Her market için bookmaker quotes'ları grupla
 * Bu, consensus hesabı için gerekli (aynı market'teki tüm selection'ların odds'ları)
 */
interface MarketGroup {
  betName: string;                                     // api bet name (e.g. 'Match Winner')
  selections: Map<string, BookmakerSelectionQuote[]>;  // selection value → bookmaker quotes
  allSelectionValues: Set<string>;
}

interface BookmakerSelectionQuote {
  bookmakerId: number;
  bookmakerName: string;
  odds: number;
  allOddsInThisBookmakerMarket: number[];  // same market's all odds for overround calc
}

/**
 * Maç odds'larını market bazında grupla
 */
function groupOddsByMarket(odds: NormalizedOdds): Map<string, MarketGroup> {
  const groups = new Map<string, MarketGroup>();

  for (const bm of odds.bookmakers) {
    for (const bet of bm.bets) {
      let group = groups.get(bet.name);
      if (!group) {
        group = {
          betName: bet.name,
          selections: new Map(),
          allSelectionValues: new Set(),
        };
        groups.set(bet.name, group);
      }

      const allOddsThisBookmaker = bet.values.map(v => v.odd);

      for (const v of bet.values) {
        if (v.odd < 1.01) continue;
        let selQuotes = group.selections.get(v.value);
        if (!selQuotes) {
          selQuotes = [];
          group.selections.set(v.value, selQuotes);
        }
        selQuotes.push({
          bookmakerId: bm.id,
          bookmakerName: bm.name,
          odds: v.odd,
          allOddsInThisBookmakerMarket: allOddsThisBookmaker,
        });
        group.allSelectionValues.add(v.value);
      }
    }
  }

  return groups;
}

/**
 * Maçı analiz et ve qualified bet'leri döndür
 */
export async function analyzeGameMarkets(
  plugin: SportPlugin,
  game: NormalizedGame,
  filters: CouponFilterConfig,
  criteria: Partial<QualityFirstCriteria> = {}
): Promise<ValueBet[]> {
  const results: ValueBet[] = [];

  // ===== ODDS FETCH =====
  let odds: NormalizedOdds | null = null;
  try {
    odds = await plugin.getOddsForGame(game.id);
  } catch {
    return results;
  }
  if (!odds || odds.bookmakers.length === 0) return results;

  // ===== AUXILIARY DATA (model input) =====
  let homeStats: any = null;
  let awayStats: any = null;
  let h2h: NormalizedGame[] = [];

  try {
    if (plugin.getTeamStatistics && typeof game.league.season === 'number') {
      [homeStats, awayStats] = await Promise.all([
        plugin.getTeamStatistics(game.teams.home.id, game.league.id, game.league.season).catch(() => null),
        plugin.getTeamStatistics(game.teams.away.id, game.league.id, game.league.season).catch(() => null),
      ]);
    }
    h2h = await plugin.getH2H(game.teams.home.id, game.teams.away.id).catch(() => []);
  } catch {
    // continue
  }

  // ===== MODEL PREDICTION =====
  const prediction = plugin.predict({ game, homeStats, awayStats, h2h });

  // ===== GROUP ODDS BY MARKET =====
  const marketGroups = groupOddsByMarket(odds);

  // Sample size (h2h + stats olmalı)
  const sampleSize = (h2h?.length || 0) + (homeStats ? 10 : 0) + (awayStats ? 10 : 0);

  // ===== ITERATE MARKETS =====
  for (const [betName, group] of marketGroups) {
    // İddaa whitelist
    if (!isIddaaMarket(plugin.config.id, betName)) continue;

    const iddaaName = getIddaaName(plugin.config.id, betName);

    for (const [selection, quotes] of group.selections) {
      if (quotes.length < (criteria.minBookmakers ?? QUALITY_FIRST_DEFAULTS.minBookmakers)) continue;

      // Market consensus (fair probability with overround removed)
      const consensus = calculateMarketConsensus(
        quotes.map(q => ({
          selectionOdds: q.odds,
          allMarketOdds: q.allOddsInThisBookmakerMarket,
        }))
      );

      if (consensus.fairProb <= 0) continue;

      // Best odds for this selection
      const bestQuote = quotes.reduce((best, q) => q.odds > best.odds ? q : best, quotes[0]);
      const bestOdds = bestQuote.odds;
      const bestBookmaker = bestQuote.bookmakerName;

      // Model probability (from plugin's evaluateMarket)
      const modelProb = plugin.evaluateMarket({
        prediction,
        betName,
        selection,
        game,
      });

      if (modelProb <= 0 || modelProb > 1) continue;

      // ===== QUALIFICATION =====
      const modelDisagreement = Math.abs(modelProb - consensus.fairProb);

      const result = qualifyBet({
        odds: bestOdds,
        modelProb,
        consensus,
        uncertainty: {
          sampleSize,
          marketSpread: consensus.spread,
          bookmakerCount: consensus.bookmakerCount,
          dataFreshness: 0.9,
          leagueTier: 'mid',
          modelDisagreement,
        },
        criteria,
      });

      if (!result.qualified) {
        if (typeof console !== 'undefined' && typeof console.debug === 'function') {
          // Reduce noise — only log disqualified bets if they came close
          if (result.breakdown.edge > 0 && result.breakdown.posterior > 0.5) {
            console.debug(
              `[QFilter] ${plugin.config.id}/${betName}/${selection} @ ${bestOdds}: ${result.reason}`
            );
          }
        }
        continue;
      }

      // Kelly stake (% of bankroll) — fractional Kelly 25%
      const stake = kellyStake(result.breakdown.posterior, bestOdds, 0.25);

      results.push({
        gameId: game.id,
        sport: plugin.config.id,
        marketKind: 'over_under',
        betType: betName,
        iddaaName,
        selection,
        bookmaker: bestBookmaker,
        odds: bestOdds,
        impliedProb: result.breakdown.impliedProb,
        trueProbability: result.breakdown.posterior,
        edge: result.breakdown.edge,
        kellyStake: stake,
        rating: result.breakdown.confidence > 0.85
          ? 'excellent'
          : result.breakdown.confidence > 0.70
          ? 'good'
          : 'moderate',
        confidence: result.breakdown.confidence * 100,
        homeTeam: game.teams.home.name,
        awayTeam: game.teams.away.name,
        matchDate: game.date,
      });
    }
  }

  // Deduplicate: best posterior per (gameId+betType+selection)
  const best = new Map<string, ValueBet>();
  results.forEach(vb => {
    const key = `${vb.gameId}::${vb.betType}::${vb.selection}`;
    const existing = best.get(key);
    if (!existing || vb.trueProbability > existing.trueProbability) {
      best.set(key, vb);
    }
  });

  // Sort by (confidence * posterior) descending — best first
  return Array.from(best.values())
    .sort((a, b) => (b.trueProbability * b.confidence) - (a.trueProbability * a.confidence));
}

/**
 * Multi-sport parallel analysis
 */
export async function analyzeMultiSport(params: {
  sports: SportPlugin[];
  date: string;
  filters: CouponFilterConfig;
  criteria?: Partial<QualityFirstCriteria>;
  onProgress?: (sportId: SportId, done: number, total: number) => void;
}): Promise<{
  valueBets: ValueBet[];
  errors: { sport: SportId; error: string }[];
}> {
  const { sports, date, filters, onProgress, criteria } = params;
  const allValueBets: ValueBet[] = [];
  const errors: { sport: SportId; error: string }[] = [];

  let done = 0;

  for (const sport of sports) {
    if (!filters.allowedSports.includes(sport.config.id)) continue;

    try {
      const games = await sport.getGamesByDate(date);
      const upcomingGames = games.filter(g => g.status.upcoming || g.status.live);

      onProgress?.(sport.config.id, done, upcomingGames.length);

      const BATCH = 3;
      for (let i = 0; i < upcomingGames.length; i += BATCH) {
        const batch = upcomingGames.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(g => analyzeGameMarkets(sport, g, filters, criteria).catch(err => {
            console.error(`Error analyzing ${sport.config.id} game ${g.id}:`, err);
            return [] as ValueBet[];
          }))
        );
        results.forEach(r => allValueBets.push(...r));
        done += batch.length;
        onProgress?.(sport.config.id, done, upcomingGames.length);
      }
    } catch (err: any) {
      errors.push({ sport: sport.config.id, error: err.message || 'Unknown error' });
    }
  }

  return {
    valueBets: allValueBets.sort((a, b) =>
      (b.trueProbability * b.confidence) - (a.trueProbability * a.confidence)
    ),
    errors,
  };
}

/**
 * Sistem kupon olasılık (DP-based, n bet'ten k tutma prob)
 */
export function calculateSystemProbability(probs: number[], minWins: number): number {
  const n = probs.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  dp[0][0] = 1;

  for (let i = 1; i <= n; i++) {
    const p = probs[i - 1];
    for (let j = 0; j <= i; j++) {
      const winPath = j > 0 ? dp[i - 1][j - 1] * p : 0;
      const losePath = dp[i - 1][j] * (1 - p);
      dp[i][j] = winPath + losePath;
    }
  }

  let total = 0;
  for (let j = minWins; j <= n; j++) total += dp[n][j];
  return Math.min(1, total);
}

/**
 * Coupon Strategy
 */
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
  systemInfo?: {
    combinationType: string;
    combinations: number;
  };
}

/**
 * Quality-First Strategy Generation
 *
 * Azaltılmış strateji seti — sadece gerçekten mantıklı olanlar:
 *  1. Tipster Tek Bahis (günün en güvenli single)
 *  2. Güvenli Çiftleme (2 leg, yüksek prob)
 *  3. Sistem 3/5 (eğer 5 qualified bet varsa)
 *  4. Multi-Sport Çift (2 farklı spor)
 *
 * ESKI "Değer Kuponu / Yüksek Oran / Agresif" stratejileri KALDIRILDI —
 * bunlar screenshotta %16 tutan çöp strateji haline geldi.
 */
export function generateCouponStrategies(
  valueBets: ValueBet[],
  filters: CouponFilterConfig
): CouponStrategy[] {
  const allBets: CouponBet[] = valueBets.map(vb => ({
    gameId: vb.gameId,
    sport: vb.sport,
    sportDisplay: vb.sport,
    homeTeam: vb.homeTeam,
    awayTeam: vb.awayTeam,
    league: '',
    matchDate: vb.matchDate,
    betType: vb.betType,
    iddaaName: vb.iddaaName,
    selection: vb.selection,
    odds: vb.odds,
    trueProbability: vb.trueProbability,
    edge: vb.edge,
    confidence: vb.confidence,
    result: 'pending',
  }));

  const bestPerGame = new Map<string, CouponBet>();
  allBets.forEach(b => {
    const key = `${b.sport}-${b.gameId}`;
    const existing = bestPerGame.get(key);
    if (!existing || b.trueProbability * b.confidence > existing.trueProbability * existing.confidence) {
      bestPerGame.set(key, b);
    }
  });

  const ranked = Array.from(bestPerGame.values())
    .sort((a, b) => (b.trueProbability * b.confidence) - (a.trueProbability * a.confidence));

  const strategies: CouponStrategy[] = [];

  // ===== Strateji 1: Günün Tipster Bahsi (single, highest conviction) =====
  if (ranked.length >= 1) {
    const top = ranked[0];
    strategies.push({
      name: 'Günün Tipster Bahsi',
      description: `En yüksek güvenli tek bahis. Olasılık ${(top.trueProbability * 100).toFixed(1)}%, güven ${top.confidence.toFixed(0)}%.`,
      bets: [top],
      totalOdds: round(top.odds),
      expectedProbability: top.trueProbability * 100,
      expectedValue: top.odds * top.trueProbability,
      riskLevel: 'low',
      suggestedStake: 20,
      potentialReturn: round(top.odds * 20),
    });
  }

  // ===== Strateji 2: Güvenli Çiftleme (2 legs) =====
  if (ranked.length >= 2) {
    const twoLegs = ranked.slice(0, 2);
    const totalOdds = twoLegs.reduce((a, b) => a * b.odds, 1);
    const expectedProb = twoLegs.reduce((a, b) => a * b.trueProbability, 1);
    strategies.push({
      name: 'Güvenli Çiftleme',
      description: `En güvenli 2 bahis. Birleşik olasılık ${(expectedProb * 100).toFixed(1)}%.`,
      bets: twoLegs,
      totalOdds: round(totalOdds),
      expectedProbability: expectedProb * 100,
      expectedValue: totalOdds * expectedProb,
      riskLevel: 'low',
      suggestedStake: 10,
      potentialReturn: round(totalOdds * 10),
    });
  }

  // ===== Strateji 3: Üçleme (3 legs) =====
  if (ranked.length >= 3) {
    const threeLegs = ranked.slice(0, 3);
    const totalOdds = threeLegs.reduce((a, b) => a * b.odds, 1);
    const expectedProb = threeLegs.reduce((a, b) => a * b.trueProbability, 1);
    // Sadece expectedProb >= 30% olursa ver — düşükse mantıksız
    if (expectedProb >= 0.30) {
      strategies.push({
        name: 'Üçleme Kupon',
        description: `3 güvenli bahis. Birleşik olasılık ${(expectedProb * 100).toFixed(1)}%.`,
        bets: threeLegs,
        totalOdds: round(totalOdds),
        expectedProbability: expectedProb * 100,
        expectedValue: totalOdds * expectedProb,
        riskLevel: 'medium',
        suggestedStake: 5,
        potentialReturn: round(totalOdds * 5),
      });
    }
  }

  // ===== Strateji 4: Sistem 3/5 (risk dağıtıldı) =====
  if (ranked.length >= 5) {
    const fiveLegs = ranked.slice(0, 5);
    const probs = fiveLegs.map(b => b.trueProbability);
    const oddsArr = fiveLegs.map(b => b.odds);
    const avgOdds = oddsArr.reduce((a, b) => a + b, 0) / oddsArr.length;
    const systemOdds = Math.pow(avgOdds, 3);
    const systemProb = calculateSystemProbability(probs, 3);

    strategies.push({
      name: 'Sistem 3/5',
      description: `5 bahisten 3'ü tutması yeterli. 10 kombinasyon. Risk dağıtılmış.`,
      bets: fiveLegs,
      totalOdds: round(systemOdds),
      expectedProbability: systemProb * 100,
      expectedValue: systemOdds * systemProb,
      riskLevel: 'medium',
      suggestedStake: 5,
      potentialReturn: round(systemOdds * 5),
      systemInfo: { combinationType: '3/5', combinations: 10 },
    });
  }

  // ===== Strateji 5: Multi-Sport Çifleme =====
  const sportSet = new Set<SportId>();
  ranked.forEach(b => sportSet.add(b.sport));
  if (sportSet.size >= 2) {
    const bySport = new Map<SportId, CouponBet>();
    ranked.forEach(b => {
      const existing = bySport.get(b.sport);
      if (!existing || b.trueProbability > existing.trueProbability) bySport.set(b.sport, b);
    });
    const multiSportBets = Array.from(bySport.values()).slice(0, 2);
    if (multiSportBets.length === 2) {
      const totalOdds = multiSportBets.reduce((a, b) => a * b.odds, 1);
      const expectedProb = multiSportBets.reduce((a, b) => a * b.trueProbability, 1);
      strategies.push({
        name: 'Çok Sporlu Çifteme',
        description: `2 farklı spor. Tek kaynakta risk yok.`,
        bets: multiSportBets,
        totalOdds: round(totalOdds),
        expectedProbability: expectedProb * 100,
        expectedValue: totalOdds * expectedProb,
        riskLevel: 'low',
        suggestedStake: 10,
        potentialReturn: round(totalOdds * 10),
      });
    }
  }

  return strategies;
}

function round(n: number, d: number = 2): number {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
