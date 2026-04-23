/**
 * Odds Movement Analysis Engine
 *
 * Professional-grade odds analysis that detects:
 * - Steam moves (sharp bettor activity)
 * - Reverse line movement
 * - Value betting opportunities (our model vs market)
 * - Opening vs closing odds drift
 * - Market consensus signals
 * - Kelly Criterion staking recommendations
 *
 * This is the most impactful algorithm for profitable betting:
 * when the market moves AGAINST public sentiment, it signals sharp money.
 */

import { ApiFootballService, type FixtureOdds, type OddsBookmaker } from './api-football';

export interface OddsSnapshot {
  home: number;
  draw: number;
  away: number;
  timestamp: string;
  bookmaker: string;
}

export interface MarketConsensus {
  home_implied: number;
  draw_implied: number;
  away_implied: number;
  overround: number; // The bookmaker margin
  fair_home: number; // Margin-removed probability
  fair_draw: number;
  fair_away: number;
}

export interface ValueBet {
  market: string;
  selection: string;
  our_probability: number;
  market_probability: number;
  edge: number; // our_probability - market_probability
  best_odds: number;
  bookmaker: string;
  kelly_stake: number; // Kelly Criterion % of bankroll
  expected_value: number; // EV per unit staked
  confidence: 'strong' | 'moderate' | 'marginal';
}

export interface OddsMovement {
  market: string;
  direction: 'shortening' | 'drifting' | 'stable';
  magnitude: number; // percentage change
  signal: 'steam_move' | 'reverse_line' | 'public_money' | 'neutral';
  description: string;
}

export interface OddsAnalysis {
  // Market consensus from multiple bookmakers
  market_consensus: MarketConsensus;

  // Best available odds for each outcome
  best_odds: {
    home: { odds: number; bookmaker: string };
    draw: { odds: number; bookmaker: string };
    away: { odds: number; bookmaker: string };
  };

  // Over/Under odds analysis
  over_under: {
    over_2_5: { odds: number; implied_probability: number; bookmaker: string } | null;
    under_2_5: { odds: number; implied_probability: number; bookmaker: string } | null;
    over_1_5: { odds: number; implied_probability: number; bookmaker: string } | null;
    under_1_5: { odds: number; implied_probability: number; bookmaker: string } | null;
    over_3_5: { odds: number; implied_probability: number; bookmaker: string } | null;
    under_3_5: { odds: number; implied_probability: number; bookmaker: string } | null;
  };

  // BTTS odds
  btts: {
    yes: { odds: number; implied_probability: number; bookmaker: string } | null;
    no: { odds: number; implied_probability: number; bookmaker: string } | null;
  };

  // Double Chance odds
  double_chance: {
    home_draw: { odds: number; implied_probability: number } | null;
    home_away: { odds: number; implied_probability: number } | null;
    draw_away: { odds: number; implied_probability: number } | null;
  };

  // Value bets detected
  value_bets: ValueBet[];

  // Odds movement signals
  movements: OddsMovement[];

  // Overall market signal
  market_signal: {
    direction: string;
    strength: 'strong' | 'moderate' | 'weak';
    description: string;
  };

  // Data quality
  bookmakers_count: number;
  data_available: boolean;
}

export class OddsAnalysisEngine {

  // ═══════════════════════════════════════
  // PROBABILITY CONVERSION
  // ═══════════════════════════════════════

  /**
   * Convert decimal odds to implied probability
   * implied_probability = 1 / odds (expressed as percentage)
   */
  private static oddsToImplied(odds: number): number {
    if (odds < 1.01) return 100;
    if (odds > 1000) return 0.1;
    return (1 / odds) * 100;
  }

  /**
   * Clamp decimal odds to valid range [1.01, 1000]
   */
  private static clampOdds(odds: number): number {
    return Math.max(1.01, Math.min(1000, odds));
  }

  /**
   * Remove bookmaker overround to get fair probabilities
   * Overround = sum of implied probabilities - 100
   * Fair probability = implied_probability / sum_of_all_implied * 100
   */
  private static removeMargain(home: number, draw: number, away: number): {
    fair_home: number;
    fair_draw: number;
    fair_away: number;
    overround: number;
  } {
    const total = home + draw + away;
    if (total <= 0) {
      return { fair_home: 33.33, fair_draw: 33.33, fair_away: 33.34, overround: 0 };
    }
    // Overround accounts for all outcomes: sum of implied probs - 100%
    const overround = total - 100;
    return {
      fair_home: (home / total) * 100,
      fair_draw: (draw / total) * 100,
      fair_away: (away / total) * 100,
      overround: Math.round(overround * 100) / 100
    };
  }

  /**
   * Kelly Criterion calculation for optimal stake sizing
   * Formula: f* = (bp - q) / b
   * where b = decimal odds - 1, p = our probability, q = 1 - p
   * Uses quarter Kelly (kelly/4) for safety, capped at 5% max stake
   */
  private static kellyStake(ourProbability: number, decimalOdds: number): number {
    const p = ourProbability / 100;
    const q = 1 - p;
    const b = decimalOdds - 1;

    if (b <= 0) return 0;

    const kelly = (b * p - q) / b;
    // Use quarter Kelly (kelly/4) for safety, cap at 5% max stake
    const fractionalKelly = Math.max(0, kelly * 0.25);
    const cappedKelly = Math.min(fractionalKelly, 0.05); // 5% max of bankroll
    return Math.round(cappedKelly * 10000) / 100; // Percentage
  }

  /**
   * Expected Value per unit staked
   * EV = (our_probability * market_odds) - 1
   * Positive EV means profitable in the long run
   */
  private static expectedValue(ourProbability: number, decimalOdds: number): number {
    const p = ourProbability / 100;
    // EV = (p * odds) - 1  (equivalent to p*(odds-1) - (1-p))
    const ev = (p * decimalOdds) - 1;
    return Math.round(ev * 10000) / 100; // Percentage
  }

  // ═══════════════════════════════════════
  // ODDS EXTRACTION
  // ═══════════════════════════════════════

  /**
   * Extract 1X2 odds from bookmaker data
   */
  private static extract1X2(bookmaker: OddsBookmaker): OddsSnapshot | null {
    const matchWinner = bookmaker.bets.find(
      b => b.name === 'Match Winner' || b.id === 1
    );
    if (!matchWinner || matchWinner.values.length < 3) return null;

    const home = matchWinner.values.find(v => v.value === 'Home');
    const draw = matchWinner.values.find(v => v.value === 'Draw');
    const away = matchWinner.values.find(v => v.value === 'Away');

    if (!home || !draw || !away) return null;

    return {
      home: this.clampOdds(parseFloat(home.odd)),
      draw: this.clampOdds(parseFloat(draw.odd)),
      away: this.clampOdds(parseFloat(away.odd)),
      timestamp: new Date().toISOString(),
      bookmaker: bookmaker.name
    };
  }

  /**
   * Extract Over/Under odds from bookmaker data
   */
  private static extractOverUnder(bookmaker: OddsBookmaker): Map<string, { odds: number; bookmaker: string; implied_probability: number }> {
    const result = new Map<string, { odds: number; bookmaker: string; implied_probability: number }>();

    const ouBets = bookmaker.bets.filter(
      b => b.name === 'Goals Over/Under' || b.name === 'Over/Under' || b.id === 5
    );

    ouBets.forEach(bet => {
      bet.values.forEach(v => {
        const rawOdds = parseFloat(v.odd);
        if (!isNaN(rawOdds)) {
          const odds = this.clampOdds(rawOdds);
          result.set(`${v.value}`, {
            odds,
            bookmaker: bookmaker.name,
            implied_probability: Math.round(this.oddsToImplied(odds) * 100) / 100
          });
        }
      });
    });

    return result;
  }

  /**
   * Extract BTTS odds from bookmaker data
   */
  private static extractBTTS(bookmaker: OddsBookmaker): {
    yes: { odds: number; implied_probability: number; bookmaker: string } | null;
    no: { odds: number; implied_probability: number; bookmaker: string } | null;
  } {
    const bttsBet = bookmaker.bets.find(
      b => b.name === 'Both Teams Score' || b.id === 8
    );
    if (!bttsBet) return { yes: null, no: null };

    const yesVal = bttsBet.values.find(v => v.value === 'Yes');
    const noVal = bttsBet.values.find(v => v.value === 'No');

    const yesOdds = yesVal ? this.clampOdds(parseFloat(yesVal.odd)) : 0;
    const noOdds = noVal ? this.clampOdds(parseFloat(noVal.odd)) : 0;

    return {
      yes: yesVal ? {
        odds: yesOdds,
        implied_probability: Math.round(this.oddsToImplied(yesOdds) * 100) / 100,
        bookmaker: bookmaker.name
      } : null,
      no: noVal ? {
        odds: noOdds,
        implied_probability: Math.round(this.oddsToImplied(noOdds) * 100) / 100,
        bookmaker: bookmaker.name
      } : null
    };
  }

  // ═══════════════════════════════════════
  // VALUE BET DETECTION
  // ═══════════════════════════════════════

  /**
   * Detect value bets by comparing our model's probabilities with market odds
   * Edge = our_probability - implied_probability (from odds, includes margin)
   * EV = (our_probability * market_odds) - 1. Only flag as value if EV > 0.
   */
  private static detectValueBets(
    ourProbabilities: {
      home_win: number;
      draw: number;
      away_win: number;
      over_2_5: number;
      under_2_5: number;
      btts_yes: number;
      btts_no: number;
    },
    snapshots: OddsSnapshot[],
    overUnderMap: Map<string, { odds: number; bookmaker: string; implied_probability: number }>,
    bttsData: { yes: any; no: any }
  ): ValueBet[] {
    const valueBets: ValueBet[] = [];
    const MIN_EDGE = 3; // Minimum 3% edge to flag as value

    // Find best odds for each outcome
    let bestHome = { odds: 0, bookmaker: '' };
    let bestDraw = { odds: 0, bookmaker: '' };
    let bestAway = { odds: 0, bookmaker: '' };

    snapshots.forEach(snap => {
      if (snap.home > bestHome.odds) bestHome = { odds: snap.home, bookmaker: snap.bookmaker };
      if (snap.draw > bestDraw.odds) bestDraw = { odds: snap.draw, bookmaker: snap.bookmaker };
      if (snap.away > bestAway.odds) bestAway = { odds: snap.away, bookmaker: snap.bookmaker };
    });

    // Check value: compare our probability vs implied probability from best odds
    const checkValue = (market: string, selection: string, ourProb: number, bestOdds: number, bookmaker: string) => {
      // Clamp odds to valid range
      const clampedOdds = this.clampOdds(bestOdds);
      // implied_probability = 1/odds (includes bookmaker margin)
      const marketProb = this.oddsToImplied(clampedOdds);
      // Edge: our_probability - implied_probability
      const edge = ourProb - marketProb;
      // EV = (our_probability * market_odds) - 1
      const ev = this.expectedValue(ourProb, clampedOdds);

      // Only flag as value if: edge >= minimum threshold AND EV > 0
      if (edge >= MIN_EDGE && ev > 0 && clampedOdds >= 1.01) {
        const kelly = this.kellyStake(ourProb, clampedOdds);
        valueBets.push({
          market,
          selection,
          our_probability: Math.round(ourProb * 100) / 100,
          market_probability: Math.round(marketProb * 100) / 100,
          edge: Math.round(edge * 100) / 100,
          best_odds: clampedOdds,
          bookmaker,
          kelly_stake: kelly,
          expected_value: ev,
          confidence: edge > 10 ? 'strong' : edge > 5 ? 'moderate' : 'marginal'
        });
      }
    };

    if (bestHome.odds > 0) checkValue('Match Winner', 'Home', ourProbabilities.home_win, bestHome.odds, bestHome.bookmaker);
    if (bestDraw.odds > 0) checkValue('Match Winner', 'Draw', ourProbabilities.draw, bestDraw.odds, bestDraw.bookmaker);
    if (bestAway.odds > 0) checkValue('Match Winner', 'Away', ourProbabilities.away_win, bestAway.odds, bestAway.bookmaker);

    // Check Over/Under value
    const over25 = overUnderMap.get('Over 2.5');
    const under25 = overUnderMap.get('Under 2.5');
    if (over25) checkValue('Over/Under 2.5', 'Over 2.5', ourProbabilities.over_2_5, over25.odds, over25.bookmaker);
    if (under25) checkValue('Over/Under 2.5', 'Under 2.5', ourProbabilities.under_2_5, under25.odds, under25.bookmaker);

    // Check BTTS value
    if (bttsData.yes) checkValue('Both Teams Score', 'Yes', ourProbabilities.btts_yes, bttsData.yes.odds, bttsData.yes.bookmaker);
    if (bttsData.no) checkValue('Both Teams Score', 'No', ourProbabilities.btts_no, bttsData.no.odds, bttsData.no.bookmaker);

    return valueBets.sort((a, b) => b.edge - a.edge);
  }

  // ═══════════════════════════════════════
  // ODDS MOVEMENT DETECTION
  // ═══════════════════════════════════════

  /**
   * Detect odds movements by comparing odds from multiple bookmakers
   * In a real production system, you'd compare opening vs current odds over time.
   * Here we approximate by comparing bookmaker consensus spread.
   */
  private static detectMovements(snapshots: OddsSnapshot[]): OddsMovement[] {
    const movements: OddsMovement[] = [];

    if (snapshots.length < 2) return movements;

    // Calculate average odds across bookmakers
    const avgHome = snapshots.reduce((s, o) => s + o.home, 0) / snapshots.length;
    const avgDraw = snapshots.reduce((s, o) => s + o.draw, 0) / snapshots.length;
    const avgAway = snapshots.reduce((s, o) => s + o.away, 0) / snapshots.length;

    // Calculate standard deviation to detect outliers
    const stdHome = Math.sqrt(snapshots.reduce((s, o) => s + Math.pow(o.home - avgHome, 2), 0) / snapshots.length);
    const stdDraw = Math.sqrt(snapshots.reduce((s, o) => s + Math.pow(o.draw - avgDraw, 2), 0) / snapshots.length);
    const stdAway = Math.sqrt(snapshots.reduce((s, o) => s + Math.pow(o.away - avgAway, 2), 0) / snapshots.length);

    // Compare lowest vs highest odds (simulates opening vs closing)
    const sortedByHome = [...snapshots].sort((a, b) => a.home - b.home);
    const homeDrift = ((sortedByHome[sortedByHome.length - 1].home - sortedByHome[0].home) / sortedByHome[0].home) * 100;

    const sortedByAway = [...snapshots].sort((a, b) => a.away - b.away);
    const awayDrift = ((sortedByAway[sortedByAway.length - 1].away - sortedByAway[0].away) / sortedByAway[0].away) * 100;

    // Detect home team signals
    if (stdHome > 0.15) {
      // Large spread between bookmakers = potential steam move
      const lowestHome = sortedByHome[0];
      if (homeDrift > 10) {
        movements.push({
          market: 'Match Winner',
          direction: 'drifting',
          magnitude: Math.round(homeDrift * 10) / 10,
          signal: 'reverse_line',
          description: `Ev sahibi oranları yükseliyor (${lowestHome.bookmaker}: ${lowestHome.home.toFixed(2)} → Ort: ${avgHome.toFixed(2)}). Keskin para akışı deplasman tarafına olabilir.`
        });
      } else if (homeDrift < -5) {
        movements.push({
          market: 'Match Winner',
          direction: 'shortening',
          magnitude: Math.round(Math.abs(homeDrift) * 10) / 10,
          signal: 'steam_move',
          description: `Ev sahibi oranları düşüyor - akıllı para ev sahibi tarafında. Bu güçlü bir sinyal.`
        });
      }
    }

    // Detect away team signals
    if (stdAway > 0.15) {
      if (awayDrift > 10) {
        movements.push({
          market: 'Match Winner',
          direction: 'drifting',
          magnitude: Math.round(awayDrift * 10) / 10,
          signal: 'public_money',
          description: `Deplasman oranları yükseliyor - pazar deplasman takımına güvenmiyor.`
        });
      } else if (awayDrift < -5) {
        movements.push({
          market: 'Match Winner',
          direction: 'shortening',
          magnitude: Math.round(Math.abs(awayDrift) * 10) / 10,
          signal: 'steam_move',
          description: `Deplasman oranları düşüyor - profesyonel bahisçiler deplasman tarafında.`
        });
      }
    }

    if (movements.length === 0) {
      movements.push({
        market: 'Match Winner',
        direction: 'stable',
        magnitude: 0,
        signal: 'neutral',
        description: 'Oranlar stabil - önemli bir hareket tespit edilmedi.'
      });
    }

    return movements;
  }

  // ═══════════════════════════════════════
  // MAIN ANALYSIS
  // ═══════════════════════════════════════

  /**
   * Run comprehensive odds analysis for a fixture
   *
   * @param fixtureId - API-Football fixture ID
   * @param ourProbabilities - Our model's probability estimates
   */
  static async analyzeOdds(
    fixtureId: number,
    ourProbabilities: {
      home_win: number;
      draw: number;
      away_win: number;
      over_2_5: number;
      under_2_5: number;
      btts_yes: number;
      btts_no: number;
    }
  ): Promise<OddsAnalysis> {
    // Fetch odds from API-Football
    const oddsData = await ApiFootballService.getOdds(fixtureId);

    if (!oddsData || oddsData.length === 0) {
      // Return empty analysis when no odds data available
      return this.emptyAnalysis();
    }

    // Extract 1X2 odds from all bookmakers
    const allSnapshots: OddsSnapshot[] = [];
    let bestOverUnder = new Map<string, { odds: number; bookmaker: string; implied_probability: number }>();
    let bestBtts = { yes: null as any, no: null as any };
    let bestDoubleChance = { home_draw: null as any, home_away: null as any, draw_away: null as any };

    oddsData.forEach(oddsEntry => {
      oddsEntry.bookmakers.forEach(bookmaker => {
        // 1X2
        const snapshot = this.extract1X2(bookmaker);
        if (snapshot) allSnapshots.push(snapshot);

        // Over/Under
        const ouMap = this.extractOverUnder(bookmaker);
        ouMap.forEach((value, key) => {
          const existing = bestOverUnder.get(key);
          if (!existing || value.odds > existing.odds) {
            bestOverUnder.set(key, value);
          }
        });

        // BTTS
        const btts = this.extractBTTS(bookmaker);
        if (btts.yes && (!bestBtts.yes || btts.yes.odds > bestBtts.yes.odds)) bestBtts.yes = btts.yes;
        if (btts.no && (!bestBtts.no || btts.no.odds > bestBtts.no.odds)) bestBtts.no = btts.no;

        // Double Chance
        const dcBet = bookmaker.bets.find(b => b.name === 'Double Chance' || b.id === 12);
        if (dcBet) {
          dcBet.values.forEach(v => {
            const odds = this.clampOdds(parseFloat(v.odd));
            const implied = Math.round(this.oddsToImplied(odds) * 100) / 100;
            if (v.value === 'Home/Draw' && (!bestDoubleChance.home_draw || odds > bestDoubleChance.home_draw.odds)) {
              bestDoubleChance.home_draw = { odds, implied_probability: implied };
            }
            if (v.value === 'Home/Away' && (!bestDoubleChance.home_away || odds > bestDoubleChance.home_away.odds)) {
              bestDoubleChance.home_away = { odds, implied_probability: implied };
            }
            if (v.value === 'Draw/Away' && (!bestDoubleChance.draw_away || odds > bestDoubleChance.draw_away.odds)) {
              bestDoubleChance.draw_away = { odds, implied_probability: implied };
            }
          });
        }
      });
    });

    if (allSnapshots.length === 0) return this.emptyAnalysis();

    // Calculate market consensus
    const avgHome = allSnapshots.reduce((s, o) => s + o.home, 0) / allSnapshots.length;
    const avgDraw = allSnapshots.reduce((s, o) => s + o.draw, 0) / allSnapshots.length;
    const avgAway = allSnapshots.reduce((s, o) => s + o.away, 0) / allSnapshots.length;

    const homeImplied = this.oddsToImplied(avgHome);
    const drawImplied = this.oddsToImplied(avgDraw);
    const awayImplied = this.oddsToImplied(avgAway);

    const fair = this.removeMargain(homeImplied, drawImplied, awayImplied);

    // Find best odds
    let bestHome = { odds: 0, bookmaker: '' };
    let bestDraw = { odds: 0, bookmaker: '' };
    let bestAway = { odds: 0, bookmaker: '' };

    allSnapshots.forEach(snap => {
      if (snap.home > bestHome.odds) bestHome = { odds: snap.home, bookmaker: snap.bookmaker };
      if (snap.draw > bestDraw.odds) bestDraw = { odds: snap.draw, bookmaker: snap.bookmaker };
      if (snap.away > bestAway.odds) bestAway = { odds: snap.away, bookmaker: snap.bookmaker };
    });

    // Detect value bets
    const valueBets = this.detectValueBets(ourProbabilities, allSnapshots, bestOverUnder, bestBtts);

    // Detect movements
    const movements = this.detectMovements(allSnapshots);

    // Overall market signal
    const steamMoves = movements.filter(m => m.signal === 'steam_move');
    const reverseLines = movements.filter(m => m.signal === 'reverse_line');

    let marketSignal: OddsAnalysis['market_signal'];
    if (steamMoves.length > 0) {
      marketSignal = {
        direction: steamMoves[0].direction,
        strength: 'strong',
        description: `Profesyonel para hareketi tespit edildi: ${steamMoves[0].description}`
      };
    } else if (reverseLines.length > 0) {
      marketSignal = {
        direction: reverseLines[0].direction,
        strength: 'moderate',
        description: `Ters çizgi hareketi: ${reverseLines[0].description}`
      };
    } else {
      marketSignal = {
        direction: 'stable',
        strength: 'weak',
        description: 'Pazar dengeli - belirgin bir yönelim yok.'
      };
    }

    // Build over/under result
    const getOU = (key: string) => bestOverUnder.get(key) || null;

    return {
      market_consensus: {
        home_implied: Math.round(homeImplied * 100) / 100,
        draw_implied: Math.round(drawImplied * 100) / 100,
        away_implied: Math.round(awayImplied * 100) / 100,
        overround: fair.overround,
        fair_home: Math.round(fair.fair_home * 100) / 100,
        fair_draw: Math.round(fair.fair_draw * 100) / 100,
        fair_away: Math.round(fair.fair_away * 100) / 100,
      },
      best_odds: { home: bestHome, draw: bestDraw, away: bestAway },
      over_under: {
        over_2_5: getOU('Over 2.5'),
        under_2_5: getOU('Under 2.5'),
        over_1_5: getOU('Over 1.5'),
        under_1_5: getOU('Under 1.5'),
        over_3_5: getOU('Over 3.5'),
        under_3_5: getOU('Under 3.5'),
      },
      btts: bestBtts,
      double_chance: bestDoubleChance,
      value_bets: valueBets,
      movements,
      market_signal: marketSignal,
      bookmakers_count: allSnapshots.length,
      data_available: true,
    };
  }

  /**
   * Return empty analysis structure when no data available
   */
  private static emptyAnalysis(): OddsAnalysis {
    return {
      market_consensus: {
        home_implied: 0, draw_implied: 0, away_implied: 0,
        overround: 0, fair_home: 0, fair_draw: 0, fair_away: 0
      },
      best_odds: {
        home: { odds: 0, bookmaker: '' },
        draw: { odds: 0, bookmaker: '' },
        away: { odds: 0, bookmaker: '' }
      },
      over_under: {
        over_2_5: null, under_2_5: null,
        over_1_5: null, under_1_5: null,
        over_3_5: null, under_3_5: null,
      },
      btts: { yes: null, no: null },
      double_chance: { home_draw: null, home_away: null, draw_away: null },
      value_bets: [],
      movements: [],
      market_signal: {
        direction: 'unknown',
        strength: 'weak',
        description: 'Oran verisi mevcut değil.'
      },
      bookmakers_count: 0,
      data_available: false,
    };
  }
}
