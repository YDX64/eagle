import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db-tracking';

export const dynamic = 'force-dynamic';

/**
 * Bulk lookup endpoint for the PredictionResultBadge component.
 * Accepts `?sport=X&ids=1,2,3` and returns a map of fixture_id → result
 * summary for each fixture that has a prediction in the tracking DB.
 *
 * This endpoint is idempotent, cacheable (5 min), and fast (single indexed
 * SELECT even for 500 fixtures).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const sport = (params.get('sport') ?? 'football').toLowerCase();
  const idsRaw = params.get('ids') ?? '';
  const fixtureIds = idsRaw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0);

  if (fixtureIds.length === 0) {
    return NextResponse.json({ success: true, data: {} });
  }

  try {
    // One scan over predictions + aggregated pick hit counts.
    const rows = await query<{
      fixture_id: number;
      sport: string;
      status: string;
      best_market: string | null;
      best_pick_label: string | null;
      best_probability: number | null;
      best_pick_hit: boolean | null;
      actual_home: number | null;
      actual_away: number | null;
      match_date: Date | null;
      total_picks: string;
      picks_won: string;
      picks_lost: string;
      picks_pending: string;
    }>(
      `
      SELECT
        p.fixture_id,
        p.sport,
        p.status,
        p.best_market,
        p.best_pick_label,
        p.best_probability,
        p.best_pick_hit,
        p.actual_home,
        p.actual_away,
        p.match_date,
        COUNT(pk.id) AS total_picks,
        SUM(CASE WHEN pk.hit = true THEN 1 ELSE 0 END) AS picks_won,
        SUM(CASE WHEN pk.hit = false THEN 1 ELSE 0 END) AS picks_lost,
        SUM(CASE WHEN pk.hit IS NULL THEN 1 ELSE 0 END) AS picks_pending
      FROM predictions p
      LEFT JOIN picks pk ON pk.prediction_id = p.id
      WHERE p.sport = $1 AND p.fixture_id = ANY($2::int[])
      GROUP BY p.fixture_id, p.sport, p.status, p.best_market, p.best_pick_label,
               p.best_probability, p.best_pick_hit, p.actual_home, p.actual_away, p.match_date
      `,
      [sport, fixtureIds],
    );

    const map: Record<number, any> = {};
    for (const r of rows) {
      const totalPicks = Number(r.total_picks);
      const won = Number(r.picks_won);
      const lost = Number(r.picks_lost);
      const pending = Number(r.picks_pending);
      const settled = won + lost;
      map[r.fixture_id] = {
        sport: r.sport,
        status: r.status,
        has_prediction: true,
        best_market: r.best_market,
        best_pick_label: r.best_pick_label,
        best_probability: r.best_probability,
        best_pick_hit: r.best_pick_hit,
        actual_home: r.actual_home,
        actual_away: r.actual_away,
        match_date: r.match_date,
        total_picks: totalPicks,
        picks_won: won,
        picks_lost: lost,
        picks_pending: pending,
        win_rate: settled > 0 ? won / settled : null,
      };
    }

    return NextResponse.json({ success: true, data: map, count: Object.keys(map).length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
