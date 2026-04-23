import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Recent activity feed — last N resolved / pending predictions across all
 * sports. Feeds the "Bugünün Aktivitesi" panel on the tracking overview.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const limit = Math.min(Number(params.get('limit') ?? 30), 100);
  const since = params.get('since') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sport = params.get('sport');

  try {
    if (!prisma) return NextResponse.json({ success: true, data: [], count: 0 });

    const rows = await prisma.predictions.findMany({
      where: {
        ...(sport ? { sport } : {}),
        OR: [
          { resolved_at: { gte: new Date(since) } },
          { AND: [{ status: 'pending' }, { match_date: { gte: new Date() } }] },
        ],
      },
      select: {
        id: true,
        sport: true,
        fixture_id: true,
        home_team: true,
        away_team: true,
        league: true,
        match_date: true,
        status: true,
        best_market: true,
        best_pick_label: true,
        best_probability: true,
        best_pick_hit: true,
        best_market_odds: true,
        actual_home: true,
        actual_away: true,
        resolved_at: true,
        predicted_at: true,
      },
      orderBy: [{ resolved_at: 'desc' }, { match_date: 'asc' }],
      take: limit,
    });

    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
