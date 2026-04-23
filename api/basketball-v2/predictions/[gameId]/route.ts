/**
 * GET /api/basketball-v2/predictions/[gameId]?source=nba|basketball
 *
 * Tier 2 basketball/NBA prediction endpoint. Uses the basketball-v2 engine
 * with Bayesian + ML ensemble + Monte Carlo + player props.
 *
 * Falls back to error if warehouse hasn't been backfilled.
 *
 * Query params:
 *   source — 'nba' or 'basketball' (default: nba)
 */

import { NextRequest, NextResponse } from 'next/server';
import { predictGameV2 } from '@/lib/sports/basketball-v2/engine';
import { isWarehousePopulated } from '@/lib/sports/basketball-v2/ingestion/backfill-job';
import { savePredictionAsync } from '@/lib/probet/prediction-store';

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
    return NextResponse.json(
      { success: false, error: 'invalid game id' },
      { status: 400 }
    );
  }

  try {
    const prediction = await predictGameV2(source, apiGameId);

    // ───────────────────────────────────────────────────────────────────
    // SHADOW MODE: save v2 prediction to tracking DB with sport prefix v2
    // so it can be compared with Tier 1 (basketball/nba) entries.
    //
    // We use sport='basketball_v2' so the existing tracking system stores
    // it without conflict, and the existing resolve-results endpoint can
    // resolve it the same way (looking up final scores from API).
    // ───────────────────────────────────────────────────────────────────
    const winner = prediction.markets.matchResult.predictedWinner;
    const isHomeWinner = winner === prediction.homeTeam;
    const bestPick = {
      market: isHomeWinner ? 'HOME_WIN' : 'AWAY_WIN',
      marketLabel: isHomeWinner ? 'MS 1' : 'MS 2',
      pickLabel: `${winner} kazanır (v2)`,
      category: 'MAÇ_SONUCU',
      probability: prediction.markets.matchResult.confidence,
      marketOdds: isHomeWinner
        ? prediction.markets.matchResult.homeOdds
        : prediction.markets.matchResult.awayOdds,
    };

    savePredictionAsync({
      // Use 'basketball' as sport for storage compat — distinguish v2 via league
      sport: 'basketball',
      fixtureId: apiGameId,
      homeTeam: prediction.homeTeam,
      awayTeam: prediction.awayTeam,
      league: `${prediction.league} (v2)`,  // tag as v2 for filtering
      matchDate: prediction.gameDate,
      homeWinProb: prediction.markets.matchResult.homeWinProb,
      drawProb: 0,
      awayWinProb: prediction.markets.matchResult.awayWinProb,
      confidence: prediction.confidence,
      bestPick,
      topPicks: [
        bestPick,
        {
          market: 'OVER_25',
          marketLabel: 'Total Üst',
          pickLabel: `${prediction.markets.totalPoints.expected.toFixed(0)} Üst`,
          category: 'GOL_TOPLAMI',
          probability: 0.5,
          marketOdds: 1.9,
        },
      ],
    });

    return NextResponse.json({
      success: true,
      sport: source,
      engine: 'basketball-v2',
      data: prediction,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Distinguish "warehouse not populated" from real errors
    const status = await isWarehousePopulated().catch(() => ({ populated: false, nbaGames: 0, basketballGames: 0 }));
    if (!status.populated) {
      return NextResponse.json(
        {
          success: false,
          engine: 'basketball-v2',
          error: 'warehouse not populated — run backfill first',
          warehouseStats: status,
          hint: 'POST /api/basketball-v2/backfill to populate',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        engine: 'basketball-v2',
        error: msg,
      },
      { status: 500 }
    );
  }
}
