
import { NextRequest, NextResponse } from 'next/server';
import { ValueScanner } from '@/lib/sports/base/value-scanner';
import { ValueBet, SportType } from '@/lib/sports/base/types';
import { CacheService } from '@/lib/cache';

export const dynamic = "force-dynamic";

async function loadSportModules(date: string) {
  const sportModules: Array<{
    sport: SportType;
    getGames: () => Promise<any[]>;
    generatePrediction: (gameId: number, client: any) => Promise<any>;
    client: any;
  }> = [];

  try {
    const { basketballApi } = await import('@/lib/sports/basketball/api-basketball');
    const { BasketballPredictionEngine } = await import('@/lib/sports/basketball/prediction-engine');
    sportModules.push({
      sport: 'basketball',
      getGames: () => basketballApi.getGamesByDate(date),
      generatePrediction: (id: number, client: any) => BasketballPredictionEngine.generatePrediction(id, client),
      client: basketballApi,
    });
  } catch (e) { console.log('Basketball module not loaded:', e); }

  try {
    const { hockeyApi } = await import('@/lib/sports/hockey/api-hockey');
    const { HockeyPredictionEngine } = await import('@/lib/sports/hockey/prediction-engine');
    sportModules.push({
      sport: 'hockey',
      getGames: () => hockeyApi.getGamesByDate(date),
      generatePrediction: (id: number, client: any) => HockeyPredictionEngine.generatePrediction(id, client),
      client: hockeyApi,
    });
  } catch (e) { console.log('Hockey module not loaded:', e); }

  try {
    const { handballApi } = await import('@/lib/sports/handball/api-handball');
    const { HandballPredictionEngine } = await import('@/lib/sports/handball/prediction-engine');
    sportModules.push({
      sport: 'handball',
      getGames: () => handballApi.getGamesByDate(date),
      generatePrediction: (id: number, client: any) => HandballPredictionEngine.generatePrediction(id, client),
      client: handballApi,
    });
  } catch (e) { console.log('Handball module not loaded:', e); }

  try {
    const { volleyballApi } = await import('@/lib/sports/volleyball/api-volleyball');
    const { VolleyballPredictionEngine } = await import('@/lib/sports/volleyball/prediction-engine');
    sportModules.push({
      sport: 'volleyball',
      getGames: () => volleyballApi.getGamesByDate(date),
      generatePrediction: (id: number, client: any) => VolleyballPredictionEngine.generatePrediction(id, client),
      client: volleyballApi,
    });
  } catch (e) { console.log('Volleyball module not loaded:', e); }

  return sportModules;
}

/**
 * Bookmaker margin factor (0.92 = 8% margin).
 *
 * In a real market the bookmaker builds an overround into both sides,
 * so the implied probability from the market odds is ~8% higher than
 * the "true" probability.  To simulate this:
 *
 *   market_odds = fair_odds * 0.92          (shorter odds for the bettor)
 *   market_implied_prob = 1 / market_odds   (> true probability)
 *
 * A value bet exists when OUR estimated probability exceeds the
 * market's implied probability for the *opponent* side.  We therefore
 * compute value by comparing our probability with the implied prob
 * derived from the opponent's fair odds adjusted by margin:
 *
 *   opponent_market_odds = opponent_fair_odds * 0.92
 *   our value edge = our_prob - (1 - 1/opponent_market_odds)
 *
 * However, since we only have each bet's own probability/odds, we
 * use a simplified model: the fair odds from the engine represent
 * "true" prices, and the market odds the bettor sees are inflated
 * by dividing by the margin factor (bookmakers offer slightly better
 * odds than implied by the overround on any single outcome).
 *
 *   simulated_market_odds = fair_odds / 0.92
 *
 * This means the market implies a LOWER probability per outcome than
 * fair value, giving our sharper model an edge on strong predictions.
 */
const BOOKMAKER_MARGIN = 0.92;

function betToValueBet(
  bet: any,
  tier: 'high' | 'medium' | 'risk',
  mod: { sport: SportType },
  game: any,
  date: string
): ValueBet | null {
  const confidence = bet.confidence;
  if (typeof confidence !== 'number' || confidence <= 0) return null;

  const fairOdds = bet.estimated_odds || bet.odds;
  if (typeof fairOdds !== 'number' || fairOdds <= 1) return null;

  // Our probability derived from the prediction engine's confidence (already a percentage)
  const ourProb = confidence / 100;

  // Simulated market odds: divide by margin to get what the bookmaker offers.
  // This produces odds slightly higher than fair, so the market's implied
  // probability is lower than our model's -- creating a value edge.
  const marketOdds = Math.round((fairOdds / BOOKMAKER_MARGIN) * 100) / 100;

  // Implied probability from market odds (what the bookmaker's odds imply)
  const impliedProb = 1 / marketOdds;

  // Value edge: how much our probability exceeds what the market implies (as %)
  const valueEdge = Math.round((ourProb - impliedProb) * 100 * 100) / 100;

  // Expected value: (probability * payout) - stake, expressed as % of stake
  const ev = Math.round((ourProb * marketOdds - 1) * 100 * 100) / 100;

  // Quarter-Kelly: fractional Kelly criterion for position sizing
  const kellyFull = ourProb - (1 - ourProb) / (marketOdds - 1);
  const kellyPct = Math.max(0, Math.round(kellyFull * 25 * 100) / 100);

  // Confidence tier based on source tier and confidence level
  let confidenceTier: 'platinum' | 'gold' | 'silver';
  if (tier === 'high' && confidence >= 65) {
    confidenceTier = 'platinum';
  } else if (tier === 'high' || (tier === 'medium' && confidence >= 60)) {
    confidenceTier = 'gold';
  } else {
    confidenceTier = 'silver';
  }

  return {
    sport: mod.sport,
    game_id: game.id,
    home_team: game.teams?.home?.name || 'Unknown',
    away_team: game.teams?.away?.name || 'Unknown',
    league_name: game.league?.name || 'Unknown',
    game_date: game.date || date,
    market: bet.market || bet.title || 'unknown',
    selection: bet.selection || bet.description || '',
    our_probability: Math.round(ourProb * 10000) / 100,
    market_odds: marketOdds,
    implied_probability: Math.round(impliedProb * 10000) / 100,
    value_edge: valueEdge,
    expected_value: ev,
    kelly_percentage: kellyPct,
    confidence_tier: confidenceTier,
    confidence_score: confidence,
    reasoning: bet.reason || bet.recommendation || '',
  } as ValueBet;
}

function extractValueBets(prediction: any, mod: { sport: SportType }, game: any, date: string): ValueBet[] {
  if (!prediction) return [];

  const bets: ValueBet[] = [];

  // Extract from all three bet tiers
  const tiers: Array<{ key: string; tier: 'high' | 'medium' | 'risk' }> = [
    { key: 'high_confidence_bets', tier: 'high' },
    { key: 'medium_risk_bets', tier: 'medium' },
    { key: 'high_risk_bets', tier: 'risk' },
  ];

  for (const { key, tier } of tiers) {
    const tierBets = prediction[key];
    if (!Array.isArray(tierBets)) continue;

    for (const bet of tierBets) {
      const valueBet = betToValueBet(bet, tier, mod, game, date);
      if (valueBet && valueBet.value_edge > 0) {
        bets.push(valueBet);
      }
    }
  }

  // Also check nested risk_analysis if present (some engines duplicate bets there)
  if (prediction.risk_analysis) {
    for (const { key, tier } of tiers) {
      const tierBets = prediction.risk_analysis[key];
      if (!Array.isArray(tierBets)) continue;

      for (const bet of tierBets) {
        // Avoid duplicates: skip if same market+selection already added
        const valueBet = betToValueBet(bet, tier, mod, game, date);
        if (valueBet && valueBet.value_edge > 0) {
          const isDuplicate = bets.some(
            (b) => b.game_id === valueBet.game_id && b.market === valueBet.market && b.selection === valueBet.selection
          );
          if (!isDuplicate) {
            bets.push(valueBet);
          }
        }
      }
    }
  }

  return bets;
}

async function processSportGames(mod: any, date: string): Promise<ValueBet[]> {
  const bets: ValueBet[] = [];
  try {
    const games = await mod.getGames();
    const upcomingGames = games
      .filter((g: any) => g.status?.short === 'NS')
      .slice(0, 10);

    for (const game of upcomingGames) {
      try {
        const prediction = await mod.generatePrediction(game.id, mod.client);
        const gameBets = extractValueBets(prediction, mod, game, date);
        bets.push(...gameBets);
      } catch (e) {
        // Some games may not be found (just finished, cancelled, etc.) - skip silently
      }
    }
  } catch (e) {
    console.log(`Failed to process ${mod.sport} games:`, e);
  }
  return bets;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sports = searchParams.get('sports')?.split(',') as SportType[] | undefined;
    const tier = searchParams.get('tier')?.split(',');
    const minEdge = parseFloat(searchParams.get('minEdge') || '5');
    const limit = parseInt(searchParams.get('limit') || '20');
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    const cacheKey = CacheService.generateApiKey('high_value_bets', {
      date,
      sports: sports?.join(',') || 'all',
      tier: tier?.join(',') || 'all',
      minEdge,
      limit,
    });

    const result = await CacheService.cacheApiResponse(
      cacheKey,
      async () => {
        const allModules = await loadSportModules(date);
        const activeModules = sports
          ? allModules.filter((m) => sports.includes(m.sport))
          : allModules;

        const allBetsArrays = await Promise.all(
          activeModules.map((mod) => processSportGames(mod, date))
        );

        const allValueBets = allBetsArrays.flat();

        const highValueBets = ValueScanner.filterHighValueBets(allValueBets, {
          minEdge,
          minConfidence: 45,
          maxBets: limit,
          sports,
          tiers: tier,
        });

        const summary = ValueScanner.generateSummary(highValueBets);
        return { bets: highValueBets, summary, date, scanned_sports: activeModules.map((m) => m.sport) };
      },
      CacheService.TTL.PREDICTIONS
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to scan for high-value bets', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
