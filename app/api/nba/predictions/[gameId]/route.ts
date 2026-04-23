/**
 * GET /api/nba/predictions/[gameId]
 *
 * Generates a comprehensive NBA prediction including:
 *  - Match result, total points, handicap
 *  - Quarter-by-quarter breakdown
 *  - Half-time / full-time combinations
 *  - Team totals
 *  - Player props (points, rebounds, assists, 3PM, DD, TD)
 *  - Live state analysis (if game in progress)
 *
 * Uses v2.nba.api-sports.io and the dedicated NbaPredictionEngine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { NbaPredictionEngine } from '@/lib/sports/nba/prediction-engine';
import { savePredictionAsync } from '@/lib/probet/prediction-store';
import { getPredictionStatus } from '@/lib/probet/prediction-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId: gameIdStr } = await params;
  const gameId = parseInt(gameIdStr, 10);

  if (!Number.isFinite(gameId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid game ID' },
      { status: 400 }
    );
  }

  try {
    const prediction = await NbaPredictionEngine.generatePrediction(gameId);

    // Fire-and-forget tracking save
    try {
      const bestPick = {
        market: prediction.match_result.predicted_winner === prediction.game_info.home_team ? 'HOME_WIN' : 'AWAY_WIN',
        marketLabel: prediction.match_result.predicted_winner === prediction.game_info.home_team ? 'MS 1' : 'MS 2',
        pickLabel: `${prediction.match_result.predicted_winner} kazanır`,
        category: 'MAÇ_SONUCU',
        probability: prediction.match_result.predicted_winner === prediction.game_info.home_team
          ? prediction.match_result.home_win.probability
          : prediction.match_result.away_win.probability,
        marketOdds: prediction.match_result.predicted_winner === prediction.game_info.home_team
          ? prediction.match_result.home_win.odds
          : prediction.match_result.away_win.odds,
      };
      savePredictionAsync({
        sport: 'basketball', // NBA is a subset — keep basketball for unified tracking
        fixtureId: gameId,
        homeTeam: prediction.game_info.home_team,
        awayTeam: prediction.game_info.away_team,
        league: 'NBA',
        matchDate: prediction.game_info.date,
        homeWinProb: prediction.match_result.home_win.probability,
        drawProb: 0,
        awayWinProb: prediction.match_result.away_win.probability,
        confidence: prediction.match_result.confidence,
        bestPick,
        topPicks: [bestPick],
      });
    } catch {
      // Silent
    }

    // Try to attach resolution
    let resolution: any = undefined;
    try {
      const status = await getPredictionStatus('basketball', gameId);
      if (status.status !== 'unknown') resolution = status;
    } catch {
      // Silent
    }

    return NextResponse.json({
      success: true,
      sport: 'nba',
      data: prediction,
      _resolution: resolution,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        sport: 'nba',
        error: 'Failed to generate NBA prediction',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
