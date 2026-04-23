/**
 * GET /api/probet/high-odds-winners
 *
 * Returns winning picks with high market odds (>= 2.0 by default).
 * Groups by odds range for system bet analysis.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pgConfig = {
  host: process.env.PROBET_PG_HOST || 'awa-postgres',
  port: parseInt(process.env.PROBET_PG_PORT || '5432', 10),
  database: process.env.PROBET_PG_DB || 'probet',
  user: process.env.PROBET_PG_USER || 'awauser',
  password: process.env.PROBET_PG_PASSWORD || '',
  max: 5,
};

let _pool: Pool | null = null;
function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool(pgConfig);
  return _pool;
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minOdds = parseFloat(searchParams.get('minOdds') || '2.0');
    const onlyWinners = searchParams.get('onlyWinners') !== 'false';
    const sport = searchParams.get('sport') || '';
    const limit = Math.min(200, parseInt(searchParams.get('limit') || '50', 10));

    const pool = getPool();

    // Odds range breakdown (all hits + misses for percentage calc)
    const rangeRes = await pool.query(
      "SELECT " +
      "CASE " +
      "  WHEN pk.market_odds >= 10 THEN '10.00+' " +
      "  WHEN pk.market_odds >= 5 THEN '5.00-10.00' " +
      "  WHEN pk.market_odds >= 3 THEN '3.00-5.00' " +
      "  WHEN pk.market_odds >= 2 THEN '2.00-3.00' " +
      "  WHEN pk.market_odds >= 1.5 THEN '1.50-2.00' " +
      "  ELSE '<1.50' " +
      "END as range, " +
      "count(*) as total, " +
      "sum(case when pk.hit=true then 1 else 0 end) as hits, " +
      "sum(case when pk.hit=false then 1 else 0 end) as misses, " +
      "round(avg(pk.market_odds)::numeric, 2) as avg_odds, " +
      "round(max(pk.market_odds)::numeric, 2) as max_odds, " +
      "round(min(pk.market_odds)::numeric, 2) as min_odds " +
      "FROM picks pk WHERE pk.hit IS NOT NULL AND pk.market_odds IS NOT NULL " +
      "GROUP BY range " +
      "ORDER BY avg_odds DESC"
    );

    // Winning picks with high odds
    const conditions: string[] = ['pk.market_odds >= $1'];
    const params: any[] = [minOdds];
    let idx = 2;

    if (onlyWinners) conditions.push('pk.hit = true');
    if (sport) { conditions.push('p.sport = $' + (idx++)); params.push(sport); }

    const pickRes = await pool.query(
      "SELECT p.sport, p.home_team, p.away_team, p.league, " +
      "p.match_date, p.actual_home, p.actual_away, p.fixture_id, " +
      "pk.market, pk.market_label, pk.pick_label, pk.category, " +
      "pk.probability, pk.market_odds, pk.hit, pk.is_best " +
      "FROM picks pk JOIN predictions p ON pk.prediction_id = p.id " +
      "WHERE " + conditions.join(' AND ') + " " +
      "ORDER BY pk.market_odds DESC, p.match_date DESC " +
      "LIMIT $" + idx,
      [...params, limit]
    );

    // Winning pick totals
    const winTotalRes = await pool.query(
      "SELECT count(*) as total, " +
      "round(avg(pk.market_odds)::numeric, 2) as avg_odds, " +
      "round(max(pk.market_odds)::numeric, 2) as max_odds " +
      "FROM picks pk WHERE pk.hit = true AND pk.market_odds >= $1 " +
      (sport ? 'AND EXISTS (SELECT 1 FROM predictions p WHERE p.id = pk.prediction_id AND p.sport = $2)' : ''),
      sport ? [minOdds, sport] : [minOdds]
    );

    // Top performing high-odds markets
    const topMarketsRes = await pool.query(
      "SELECT pk.market_label as label, pk.market, count(*) as total, " +
      "sum(case when pk.hit=true then 1 else 0 end) as hits, " +
      "round(avg(pk.market_odds)::numeric, 2) as avg_odds " +
      "FROM picks pk WHERE pk.hit IS NOT NULL AND pk.market_odds >= 2.0 " +
      "GROUP BY pk.market_label, pk.market " +
      "HAVING count(*) >= 2 " +
      "ORDER BY (sum(case when pk.hit=true then 1 else 0 end)::numeric / nullif(count(*),0)) DESC, " +
      "avg_odds DESC " +
      "LIMIT 20"
    );

    return NextResponse.json({
      success: true,
      data: {
        oddsRangeStats: rangeRes.rows.map((r: any) => ({
          range: r.range,
          total: parseInt(r.total),
          hits: parseInt(r.hits),
          misses: parseInt(r.misses),
          avgOdds: parseFloat(r.avg_odds || '0'),
          maxOdds: parseFloat(r.max_odds || '0'),
          minOdds: parseFloat(r.min_odds || '0'),
          accuracy: parseInt(r.total) > 0
            ? Math.round((parseInt(r.hits) / parseInt(r.total)) * 1000) / 10
            : 0,
        })),
        winnerStats: {
          total: parseInt(winTotalRes.rows[0]?.total || '0'),
          avgOdds: parseFloat(winTotalRes.rows[0]?.avg_odds || '0'),
          maxOdds: parseFloat(winTotalRes.rows[0]?.max_odds || '0'),
        },
        topMarkets: topMarketsRes.rows.map((m: any) => ({
          market: m.market,
          label: m.label,
          total: parseInt(m.total),
          hits: parseInt(m.hits),
          accuracy: parseInt(m.total) > 0
            ? Math.round((parseInt(m.hits) / parseInt(m.total)) * 1000) / 10
            : 0,
          avgOdds: parseFloat(m.avg_odds || '0'),
        })),
        picks: pickRes.rows.map((p: any) => ({
          sport: p.sport,
          fixtureId: p.fixture_id,
          homeTeam: p.home_team,
          awayTeam: p.away_team,
          league: p.league,
          matchDate: p.match_date,
          score: p.actual_home !== null ? p.actual_home + '-' + p.actual_away : null,
          market: p.market,
          marketLabel: p.market_label,
          pickLabel: p.pick_label,
          category: p.category,
          probability: parseFloat(p.probability || '0'),
          marketOdds: parseFloat(p.market_odds || '0'),
          hit: p.hit,
          isBest: p.is_best,
        })),
      },
    });
  } catch (error) {
    console.error('[HIGH ODDS WINNERS]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
