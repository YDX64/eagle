/**
 * POST /api/basketball-v2/backfill
 *
 * Triggers a one-shot historical backfill of the basketball-v2 warehouse.
 * Defaults: NBA seasons 2021-2025, basketball league set + 2 seasons.
 *
 * Body (optional JSON):
 *   {
 *     "nbaSeasons": [2021, 2022, 2023, 2024, 2025],
 *     "basketballLeagues": [12, 120, 79, 117, 132, 126, 136, 99, 168, 110, 116],
 *     "basketballSeasons": ["2024-2025", "2025-2026"]
 *   }
 *
 * NOTE: This is a long-running job (~2 hours for full default scope).
 * In production we'd run it in a worker process — for now it runs inline
 * in the request handler. The route returns IMMEDIATELY with job IDs and
 * the actual ingestion runs in the background via Promise.then().
 */

import { NextRequest, NextResponse } from 'next/server';
import { runBackfill, type BackfillConfig } from '@/lib/sports/basketball-v2/ingestion/backfill-job';
import { recomputeAllAggregates } from '@/lib/sports/basketball-v2/ingestion/team-aggregate-calculator';
import { recomputeAllQuarterShares } from '@/lib/sports/basketball-v2/ingestion/quarter-share-calculator';
import { recomputeAllRatings } from '@/lib/sports/basketball-v2/ingestion/ratings-builder';
import { aggregateAllPlayers } from '@/lib/sports/basketball-v2/ingestion/player-aggregator';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// Top basketball leagues from api-basketball.com (verified to have data)
const DEFAULT_BASKETBALL_LEAGUES = [
  12,   // NBA (also covered by NBA API)
  120,  // EuroLeague
  79,   // BSL (Turkey)
  117,  // ACB (Spain)
  132,  // BBL (Germany)
  126,  // Pro A (France)
  136,  // Lega Basket (Italy)
  99,   // CBA (China)
  168,  // NBB (Brazil)
  110,  // KBL (Korea)
  116,  // NBL (Australia)
  121,  // EuroCup
];

const NBA_SEASONS_DEFAULT = [2021, 2022, 2023, 2024, 2025];
const BB_SEASONS_DEFAULT = ['2024-2025', '2025-2026'];

export async function POST(request: NextRequest) {
  let config: BackfillConfig;
  try {
    const body = await request.json().catch(() => ({}));
    config = {
      nbaSeasons: body.nbaSeasons || NBA_SEASONS_DEFAULT,
      basketballLeagues: body.basketballLeagues || DEFAULT_BASKETBALL_LEAGUES,
      basketballSeasons: body.basketballSeasons || BB_SEASONS_DEFAULT,
    };
  } catch {
    config = {
      nbaSeasons: NBA_SEASONS_DEFAULT,
      basketballLeagues: DEFAULT_BASKETBALL_LEAGUES,
      basketballSeasons: BB_SEASONS_DEFAULT,
    };
  }

  // Run inline (long request — caller must wait)
  try {
    const result = await runBackfill(config);

    // After backfill, recompute derived data:
    //   1. Team season aggregates (Four Factors, pace, ratings)
    //   2. Quarter shares (empirical per-league)
    //   3. Player season averages (NBA only — for player props)
    //   4. Team ratings (ELO + Bayesian time series)
    const aggCount = await recomputeAllAggregates();
    const qsCount = await recomputeAllQuarterShares();
    const playerCount = await aggregateAllPlayers();
    const ratingCount = await recomputeAllRatings();

    return NextResponse.json({
      success: true,
      engine: 'basketball-v2',
      backfill: result,
      aggregatesComputed: aggCount,
      quarterSharesComputed: qsCount,
      playersAggregated: playerCount,
      ratingsComputed: ratingCount,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
