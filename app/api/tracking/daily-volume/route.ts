import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

/**
 * Daily prediction volume breakdown — one row per YYYY-MM-DD between
 * `date_from` and `date_to`. Aggregates total picks, hits, and flat-stake
 * profit (1-unit stake) for all settled picks on each day.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const sports = p
    .get('sports')
    ?.split(',')
    .filter(Boolean) as SportCode[] | undefined;
  const date_from = p.get('date_from');
  const date_to = p.get('date_to');

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (sports && sports.length > 0) {
      conditions.push(`p.sport = ANY($${idx}::text[])`);
      params.push(sports);
      idx++;
    }
    if (date_from) {
      conditions.push(`p.match_date >= $${idx}::timestamptz`);
      params.push(date_from);
      idx++;
    }
    if (date_to) {
      conditions.push(`p.match_date <= $${idx}::timestamptz`);
      params.push(date_to);
      idx++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        to_char(p.match_date::date, 'YYYY-MM-DD') AS date,
        COUNT(pk.id)::int AS total,
        SUM(CASE WHEN pk.hit = true THEN 1 ELSE 0 END)::int AS hit,
        COALESCE(
          SUM(
            CASE
              WHEN pk.hit = true AND pk.market_odds IS NOT NULL THEN pk.market_odds - 1
              WHEN pk.hit = false THEN -1
              ELSE 0
            END
          ),
          0
        )::float AS profit
      FROM predictions p
      LEFT JOIN picks pk ON pk.prediction_id = p.id
      ${where}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 366
    `;

    const rows = await prisma.$queryRawUnsafe<
      Array<{ date: string; total: number; hit: number; profit: number }>
    >(sql, ...params);
    return NextResponse.json({
      success: true,
      data: rows.map(r => ({
        date: r.date,
        total: Number(r.total),
        hit: Number(r.hit),
        profit: Number(r.profit),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Bilinmeyen hata',
      },
      { status: 500 }
    );
  }
}
