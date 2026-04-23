/**
 * GET /api/basketball-v2/health
 *
 * Reports warehouse status: how many games per source/league, last backfill
 * job, current rating snapshots count, etc. Used by:
 *   - The UI to show "Engine v2: ready / backfilling / not populated"
 *   - Monitoring/alerts
 */

import { NextResponse } from 'next/server';
import { isWarehousePopulated } from '@/lib/sports/basketball-v2/ingestion/backfill-job';
import { countGames } from '@/lib/sports/basketball-v2/warehouse/games-repo';
import { pingBb } from '@/lib/sports/basketball-v2/warehouse/connection';
import { ensureBbSchema } from '@/lib/sports/basketball-v2/warehouse/migrations';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Test connection
    const ping = await pingBb();
    if (!ping.ok) {
      return NextResponse.json(
        {
          success: false,
          engine: 'basketball-v2',
          status: 'unreachable',
          error: ping.error,
        },
        { status: 503 }
      );
    }

    await ensureBbSchema();

    const populated = await isWarehousePopulated();
    const games = await countGames();

    return NextResponse.json({
      success: true,
      engine: 'basketball-v2',
      status: populated.populated ? 'ready' : 'not_populated',
      warehouse: {
        populated: populated.populated,
        nbaGames: populated.nbaGames,
        basketballGames: populated.basketballGames,
        breakdown: games,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        engine: 'basketball-v2',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
