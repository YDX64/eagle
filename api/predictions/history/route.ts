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
    const sport = searchParams.get('sport') || '';
    const status = searchParams.get('status') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';
    const limit = Math.min(500, parseInt(searchParams.get('limit') || '100', 10));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const offset = (page - 1) * limit;

    const pool = getPool();

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (sport) { conditions.push(`p.sport = $${idx++}`); params.push(sport); }
    if (status) { conditions.push(`p.status = $${idx++}`); params.push(status); }
    if (dateFrom) { conditions.push(`p.match_date >= $${idx++}`); params.push(dateFrom); }
    if (dateTo) { conditions.push(`p.match_date <= $${idx++}`); params.push(dateTo + 'T23:59:59Z'); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(`SELECT count(*) FROM predictions p ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const predRes = await pool.query(`
      SELECT p.id, p.sport, p.fixture_id, p.home_team, p.away_team, p.league,
             p.match_date, p.predicted_at, p.status, p.confidence,
             p.best_market, p.best_pick_label, p.best_probability,
             p.best_market_odds, p.best_expected_value, p.best_pick_hit,
             p.actual_home, p.actual_away, p.actual_ht_home, p.actual_ht_away,
             p.resolved_at, p.home_win_prob, p.draw_prob, p.away_win_prob
      FROM predictions p ${where}
      ORDER BY p.match_date DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limit, offset]);

    const predIds = predRes.rows.map((r: any) => r.id);
    let picksMap: Record<string, any[]> = {};

    if (predIds.length > 0) {
      const picksRes = await pool.query(`
        SELECT prediction_id, market, market_label, pick_label, category,
               probability, market_odds, expected_value, is_best, is_high_confidence, hit
        FROM picks WHERE prediction_id = ANY($1)
        ORDER BY is_best DESC, probability DESC
      `, [predIds]);

      for (const pick of picksRes.rows) {
        if (!picksMap[pick.prediction_id]) picksMap[pick.prediction_id] = [];
        picksMap[pick.prediction_id].push(pick);
      }
    }

    const predictions = predRes.rows.map((p: any) => ({
      id: p.id,
      sport: p.sport,
      fixtureId: p.fixture_id,
      homeTeam: p.home_team,
      awayTeam: p.away_team,
      league: p.league,
      matchDate: p.match_date,
      predictedAt: p.predicted_at,
      status: p.status,
      confidence: p.confidence,
      bestMarket: p.best_market,
      bestPickLabel: p.best_pick_label,
      bestProbability: p.best_probability,
      bestMarketOdds: p.best_market_odds,
      bestExpectedValue: p.best_expected_value,
      bestPickHit: p.best_pick_hit,
      actualHome: p.actual_home,
      actualAway: p.actual_away,
      actualHtHome: p.actual_ht_home,
      actualHtAway: p.actual_ht_away,
      resolvedAt: p.resolved_at,
      homeWinProb: p.home_win_prob,
      drawProb: p.draw_prob,
      awayWinProb: p.away_win_prob,
      picks: (picksMap[p.id] || []).map((pk: any) => ({
        market: pk.market,
        marketLabel: pk.market_label,
        pickLabel: pk.pick_label,
        category: pk.category,
        probability: pk.probability,
        marketOdds: pk.market_odds,
        expectedValue: pk.expected_value,
        isBest: pk.is_best,
        isHighConfidence: pk.is_high_confidence,
        hit: pk.hit,
      })),
    }));

    const statsRes = await pool.query(`
      SELECT count(*) as total,
        sum(case when status='resolved' then 1 else 0 end) as resolved,
        sum(case when status='pending' then 1 else 0 end) as pending,
        sum(case when best_pick_hit=true then 1 else 0 end) as best_wins,
        sum(case when best_pick_hit=false then 1 else 0 end) as best_losses
      FROM predictions p ${where}
    `, params);

    const pickStatsRes = await pool.query(`
      SELECT pk.market, pk.market_label,
        count(*) as total,
        sum(case when pk.hit=true then 1 else 0 end) as hits,
        sum(case when pk.hit=false then 1 else 0 end) as misses,
        round(avg(pk.probability)::numeric, 3) as avg_prob,
        round(avg(pk.market_odds)::numeric, 2) as avg_odds
      FROM picks pk
      JOIN predictions p ON pk.prediction_id = p.id
      WHERE pk.hit IS NOT NULL
      GROUP BY pk.market, pk.market_label
      ORDER BY count(*) DESC
    `);

    const s = statsRes.rows[0];
    const resolved = parseInt(s.resolved || '0');
    const bestWins = parseInt(s.best_wins || '0');

    return NextResponse.json({
      success: true,
      data: {
        predictions,
        summary: {
          total: parseInt(s.total),
          resolved,
          pending: parseInt(s.pending || '0'),
          bestWins,
          bestLosses: parseInt(s.best_losses || '0'),
          bestPickAccuracy: resolved > 0 ? Math.round((bestWins / resolved) * 1000) / 10 : 0,
        },
        marketStats: pickStatsRes.rows.map((m: any) => ({
          market: m.market,
          marketLabel: m.market_label,
          total: parseInt(m.total),
          hits: parseInt(m.hits),
          misses: parseInt(m.misses),
          accuracy: parseInt(m.total) > 0 ? Math.round((parseInt(m.hits) / parseInt(m.total)) * 1000) / 10 : 0,
          avgProb: parseFloat(m.avg_prob),
          avgOdds: parseFloat(m.avg_odds || '0'),
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error('[PREDICTION HISTORY] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
