import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Per-engine performance breakdown.
 *
 * Groups predictions by the engine_name stored in predictions.payload and
 * aggregates win rate, ROI, profit across every settled pick. This is the
 * foundation for the "Master Ensemble" selector that picks the best engine
 * per (sport, market) automatically.
 *
 * Query params:
 *   sport          — optional, limit to one sport
 *   min_sample     — minimum sample size to include (default 10)
 *   date_from      — ISO date
 *   date_to        — ISO date
 */
export async function GET(req: NextRequest) {
  if (!prisma) return NextResponse.json({ success: true, data: [] });
  const p = req.nextUrl.searchParams;
  const sport = p.get('sport');
  const minSample = Math.max(1, Number(p.get('min_sample') ?? 10));
  const dateFrom = p.get('date_from');
  const dateTo = p.get('date_to');

  const conditions: string[] = ['pk.hit IS NOT NULL'];
  const params: any[] = [];
  let idx = 1;

  if (sport) {
    conditions.push(`pr.sport = $${idx}`);
    params.push(sport);
    idx++;
  }
  if (dateFrom) {
    conditions.push(`pr.match_date >= $${idx}::timestamptz`);
    params.push(dateFrom);
    idx++;
  }
  if (dateTo) {
    conditions.push(`pr.match_date <= $${idx}::timestamptz`);
    params.push(dateTo);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        pr.sport::text                                         AS sport,
        COALESCE(pr.payload->>'engine_name',
                 pr.payload->>'engine',
                 'legacy-engine')                              AS engine,
        CASE
          WHEN pk.market ~ '^(OVER|UNDER|HO_OVER|HO_UNDER|BB_OVER|BB_UNDER|HB_OVER|HB_UNDER|BS_OVER|BS_UNDER)_' THEN 'totals'
          WHEN pk.market ~ '(HOME_WIN|AWAY_WIN|DRAW|HOME_ML|AWAY_ML|HOME_WIN_REG|AWAY_WIN_REG|DRAW_REG)' THEN 'match_winner'
          WHEN pk.market ~ '^(BTTS|HO_BTTS)' THEN 'btts'
          WHEN pk.market ~ '^(AH_|HO_PUCK|BB_SPREAD|BS_RUNLINE)' THEN 'handicap'
          WHEN pk.market ~ '^(DC_|HTFT_)' THEN 'double_chance'
          WHEN pk.market ~ '^CARDS_' THEN 'cards'
          WHEN pk.market ~ '^CORNERS_' THEN 'corners'
          WHEN pk.market ~ '^HT_' THEN 'first_half'
          ELSE 'other'
        END                                                     AS family,
        COUNT(*)::int                                           AS total,
        SUM(CASE WHEN pk.hit = true THEN 1 ELSE 0 END)::int     AS hit,
        AVG(COALESCE(pk.probability, 0))::float                 AS avg_probability,
        AVG(COALESCE(NULLIF(pk.market_odds, 0), 0))::float      AS avg_odds,
        SUM(CASE WHEN pk.hit = true AND pk.market_odds IS NOT NULL AND pk.market_odds > 0 THEN pk.market_odds ELSE 0 END)::float AS total_return,
        SUM(CASE WHEN pk.market_odds IS NOT NULL AND pk.market_odds > 0 THEN 1 ELSE 0 END)::int AS picks_with_odds
      FROM picks pk
      JOIN predictions pr ON pr.id = pk.prediction_id
      ${where}
      GROUP BY pr.sport, engine, family
      HAVING COUNT(*) >= $${idx}
      ORDER BY total DESC
      LIMIT 500
      `,
      ...params,
      minSample,
    );

    const result = rows.map(r => {
      const total = Number(r.total);
      const hit = Number(r.hit);
      const returns = Number(r.total_return);
      const withOdds = Number(r.picks_with_odds);
      const winRate = total > 0 ? hit / total : 0;
      // ROI only meaningful over picks that actually have odds attached
      const roi = withOdds > 0 ? (returns - withOdds) / withOdds : null;
      return {
        sport: r.sport,
        engine: r.engine,
        family: r.family,
        total,
        hit,
        win_rate: Number(winRate.toFixed(4)),
        avg_probability: Number(Number(r.avg_probability).toFixed(4)),
        avg_odds: Number(Number(r.avg_odds).toFixed(3)),
        total_return: Number(returns.toFixed(2)),
        picks_with_odds: withOdds,
        profit: withOdds > 0 ? Number((returns - withOdds).toFixed(2)) : null,
        roi: roi != null ? Number(roi.toFixed(4)) : null,
      };
    });

    return NextResponse.json({ success: true, data: result, count: result.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
