/**
 * GET /api/basketball-v2/compare/[gameId]?source=nba|basketball
 *
 * Side-by-side comparison of Tier 1 (existing engine) and Tier 2 (basketball-v2)
 * predictions for the same game. Used for shadow mode validation.
 *
 * Returns:
 *   {
 *     game: {...},
 *     tier1: { matchResult, totalPoints, ... },
 *     tier2: { matchResult, totalPoints, quarters, htft, players, ... },
 *     diff: {
 *       homeWinProbDelta: tier2 - tier1,
 *       totalDelta: tier2 - tier1,
 *       picksAgree: bool,
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { predictGameV2 } from '@/lib/sports/basketball-v2/engine';
import { BasketballPredictionEngine } from '@/lib/sports/basketball/prediction-engine';
import { basketballApi } from '@/lib/sports/basketball/api-basketball';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId: gameIdStr } = await params;
  const url = new URL(request.url);
  const source = (url.searchParams.get('source') || 'nba') as 'nba' | 'basketball';
  const apiGameId = parseInt(gameIdStr, 10);

  if (!Number.isFinite(apiGameId)) {
    return NextResponse.json({ success: false, error: 'invalid game id' }, { status: 400 });
  }

  try {
    // Run both engines in parallel
    const [tier1Result, tier2Result] = await Promise.allSettled([
      // Tier 1: existing basketball engine (works for both NBA and basketball)
      BasketballPredictionEngine.generatePrediction(apiGameId, basketballApi),
      // Tier 2: new world-class engine
      predictGameV2(source, apiGameId),
    ]);

    const tier1 = tier1Result.status === 'fulfilled' ? tier1Result.value : null;
    const tier1Error =
      tier1Result.status === 'rejected'
        ? tier1Result.reason instanceof Error
          ? tier1Result.reason.message
          : String(tier1Result.reason)
        : null;

    const tier2 = tier2Result.status === 'fulfilled' ? tier2Result.value : null;
    const tier2Error =
      tier2Result.status === 'rejected'
        ? tier2Result.reason instanceof Error
          ? tier2Result.reason.message
          : String(tier2Result.reason)
        : null;

    if (!tier1 && !tier2) {
      return NextResponse.json(
        {
          success: false,
          error: 'both engines failed',
          tier1Error,
          tier2Error,
        },
        { status: 500 }
      );
    }

    // Compute diffs (only if both succeeded)
    let diff: {
      homeWinProbDelta: number;
      awayWinProbDelta: number;
      totalDelta: number;
      picksAgree: boolean;
      tier1Pick: string;
      tier2Pick: string;
    } | null = null;

    if (tier1 && tier2) {
      const tier1HomeProb = (tier1.match_result.home_win.probability || 0) / 100;
      const tier1AwayProb = (tier1.match_result.away_win.probability || 0) / 100;
      const tier1Total = tier1.total_points.expected_total;

      const tier2HomeProb = tier2.markets.matchResult.homeWinProb;
      const tier2AwayProb = tier2.markets.matchResult.awayWinProb;
      const tier2Total = tier2.markets.totalPoints.expected;

      const tier1Pick = tier1.match_result.predicted_winner;
      const tier2Pick = tier2.markets.matchResult.predictedWinner;

      diff = {
        homeWinProbDelta: tier2HomeProb - tier1HomeProb,
        awayWinProbDelta: tier2AwayProb - tier1AwayProb,
        totalDelta: tier2Total - tier1Total,
        picksAgree: tier1Pick === tier2Pick,
        tier1Pick,
        tier2Pick,
      };
    }

    return NextResponse.json({
      success: true,
      gameId: `${source}:${apiGameId}`,
      tier1: tier1
        ? {
            available: true,
            matchResult: {
              homeWinProb: (tier1.match_result.home_win.probability || 0) / 100,
              awayWinProb: (tier1.match_result.away_win.probability || 0) / 100,
              predictedWinner: tier1.match_result.predicted_winner,
            },
            totalPoints: {
              expected: tier1.total_points.expected_total,
              stdDev: tier1.total_points.std_dev,
            },
          }
        : { available: false, error: tier1Error },
      tier2: tier2
        ? {
            available: true,
            matchResult: tier2.markets.matchResult,
            totalPoints: {
              expected: tier2.markets.totalPoints.expected,
              stdDev: tier2.markets.totalPoints.stdDev,
            },
            quarterBreakdown: {
              q1: tier2.markets.q1.expectedTotal,
              q2: tier2.markets.q2.expectedTotal,
              q3: tier2.markets.q3.expectedTotal,
              q4: tier2.markets.q4.expectedTotal,
            },
            htftMostLikely: tier2.markets.htft.mostLikely,
            playerPropsCount: tier2.playerProps.length,
            inputs: {
              elo: { home: tier2.inputs.homeEloComposite, away: tier2.inputs.awayEloComposite },
              bayesian: {
                home: tier2.inputs.homeBayesianComposite,
                away: tier2.inputs.awayBayesianComposite,
              },
              homeRest: tier2.inputs.homeRestDays,
              awayRest: tier2.inputs.awayRestDays,
            },
          }
        : { available: false, error: tier2Error },
      diff,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
