/**
 * GET /api/probet/market-winrates
 *
 * Returns per-market / per-pattern / per-system-category winrate + ROI
 * stats over the last N days. Used by the ProBet tab to show a "recent
 * performance" badge next to every prediction pick so the user can decide
 * whether to bet on it.
 *
 * Query params:
 *   ?days=7   → look-back window (default 7, min 1, max 90)
 *
 * Response shape (flat for easy client-side map lookup):
 * {
 *   success: true,
 *   data: {
 *     window: { days: 7, resolved: 172, totalPicks: 1799 },
 *     byMarket: {
 *       "OVER_05": { winrate: 0.91, n: 124, wins: 113, losses: 11, avgOdds: 1.03, roiPct: -6.8 }
 *     },
 *     byPattern: {
 *       "super_banko_ms1x": { winrate: 1.0, n: 7, wins: 7, losses: 0, isBanko: true }
 *     },
 *     bySystemCategory: {
 *       "UPSET::medium": { winrate: 0.5, n: 18, wins: 9, roiPct: 86.5, avgOdds: 3.67 }
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let _pool: Pool | null = null;
function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({
    host: process.env.PROBET_PG_HOST || 'awa-postgres',
    port: parseInt(process.env.PROBET_PG_PORT || '5432', 10),
    database: process.env.PROBET_PG_DB || 'probet',
    user: process.env.PROBET_PG_USER || 'awauser',
    password: process.env.PROBET_PG_PASSWORD || '',
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on('error', (err) => {
    console.error('[market-winrates] pg pool error:', err.message);
  });
  return _pool;
}

interface MarketStat {
  winrate: number;
  n: number;
  wins: number;
  losses: number;
  avgOdds: number | null;
  roiPct: number | null;
}

interface PatternStat {
  winrate: number;
  n: number;
  wins: number;
  losses: number;
  isBanko: boolean;
  patternName: string;
}

interface SystemCategoryStat {
  winrate: number;
  n: number;
  wins: number;
  losses: number;
  avgOdds: number | null;
  roiPct: number | null;
  category: string;
  riskLevel: string;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const daysRaw = parseInt(searchParams.get('days') || '7', 10);
    const days = Math.min(Math.max(isNaN(daysRaw) ? 7 : daysRaw, 1), 90);
    // Optional sport filter — when provided, only rows for that sport are
    // aggregated. Use 'all' or omit the param for every sport combined.
    const sport = (searchParams.get('sport') || '').trim().toLowerCase();
    const sportFilter = sport && sport !== 'all' ? sport : null;

    const pool = getPool();
    const client = await pool.connect();
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // Summary of the window
      const summaryQ = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='resolved') AS resolved,
           COUNT(*) AS total_predictions
         FROM predictions
         WHERE predicted_at >= $1
           ${sportFilter ? 'AND sport = $2' : ''}`,
        sportFilter ? [cutoff, sportFilter] : [cutoff]
      );

      // Per-market: winrate + ROI (from picks table where odds available)
      const marketQ = await client.query(
        `SELECT
           p.market,
           COUNT(*) AS n,
           SUM(CASE WHEN p.hit=TRUE THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN p.hit=FALSE THEN 1 ELSE 0 END) AS losses,
           ROUND(AVG(p.market_odds)::numeric, 3) AS avg_odds,
           ROUND((100.0*SUM(CASE WHEN p.hit=TRUE AND p.market_odds>1 THEN (p.market_odds-1) WHEN p.hit=FALSE AND p.market_odds>1 THEN -1 ELSE 0 END)::numeric / NULLIF(SUM(CASE WHEN p.market_odds>1 THEN 1 ELSE 0 END),0))::numeric, 1) AS roi_pct
         FROM picks p
         JOIN predictions pr ON pr.id = p.prediction_id
         WHERE p.hit IS NOT NULL
           AND pr.predicted_at >= $1
           ${sportFilter ? 'AND pr.sport = $2' : ''}
         GROUP BY p.market
         HAVING COUNT(*) >= 3`,
        sportFilter ? [cutoff, sportFilter] : [cutoff]
      );

      // Per-pattern winrate
      const patternQ = await client.query(
        `SELECT
           pm.pattern_id,
           MAX(pm.pattern_name) AS pattern_name,
           bool_or(pm.is_banko) AS is_banko,
           COUNT(*) AS n,
           SUM(CASE WHEN pm.hit=TRUE THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN pm.hit=FALSE THEN 1 ELSE 0 END) AS losses
         FROM pattern_matches pm
         JOIN predictions pr ON pr.id = pm.prediction_id
         WHERE pm.hit IS NOT NULL
           AND pr.predicted_at >= $1
           ${sportFilter ? 'AND pr.sport = $2' : ''}
         GROUP BY pm.pattern_id
         HAVING COUNT(*) >= 3`,
        sportFilter ? [cutoff, sportFilter] : [cutoff]
      );

      // Per-system-category + risk level (with ROI)
      const sysQ = await client.query(
        `SELECT
           sb.category,
           sb.risk_level,
           COUNT(*) AS n,
           SUM(CASE WHEN sb.hit=TRUE THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN sb.hit=FALSE THEN 1 ELSE 0 END) AS losses,
           ROUND(AVG(sb.market_odds)::numeric, 2) AS avg_odds,
           ROUND((100.0*SUM(CASE WHEN sb.hit=TRUE THEN (sb.market_odds-1) WHEN sb.hit=FALSE THEN -1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0))::numeric, 1) AS roi_pct
         FROM system_bets sb
         JOIN predictions pr ON pr.id = sb.prediction_id
         WHERE sb.hit IS NOT NULL
           AND pr.predicted_at >= $1
           ${sportFilter ? 'AND pr.sport = $2' : ''}
         GROUP BY sb.category, sb.risk_level`,
        sportFilter ? [cutoff, sportFilter] : [cutoff]
      );

      const totalPicksQ = await client.query(
        `SELECT COUNT(*) AS total FROM picks p JOIN predictions pr ON pr.id=p.prediction_id WHERE pr.predicted_at >= $1 ${sportFilter ? 'AND pr.sport = $2' : ''}`,
        sportFilter ? [cutoff, sportFilter] : [cutoff]
      );

      const byMarket: Record<string, MarketStat> = {};
      for (const row of marketQ.rows) {
        const n = Number(row.n);
        const wins = Number(row.wins);
        const losses = Number(row.losses);
        byMarket[row.market] = {
          winrate: n > 0 ? wins / n : 0,
          n,
          wins,
          losses,
          avgOdds: row.avg_odds !== null ? Number(row.avg_odds) : null,
          roiPct: row.roi_pct !== null ? Number(row.roi_pct) : null,
        };
      }

      const byPattern: Record<string, PatternStat> = {};
      for (const row of patternQ.rows) {
        const n = Number(row.n);
        const wins = Number(row.wins);
        const losses = Number(row.losses);
        byPattern[row.pattern_id] = {
          winrate: n > 0 ? wins / n : 0,
          n,
          wins,
          losses,
          isBanko: Boolean(row.is_banko),
          patternName: row.pattern_name || row.pattern_id,
        };
      }

      const bySystemCategory: Record<string, SystemCategoryStat> = {};
      for (const row of sysQ.rows) {
        const n = Number(row.n);
        const wins = Number(row.wins);
        const losses = Number(row.losses);
        const key = `${row.category}::${row.risk_level}`;
        bySystemCategory[key] = {
          winrate: n > 0 ? wins / n : 0,
          n,
          wins,
          losses,
          avgOdds: row.avg_odds !== null ? Number(row.avg_odds) : null,
          roiPct: row.roi_pct !== null ? Number(row.roi_pct) : null,
          category: row.category,
          riskLevel: row.risk_level,
        };
      }

      const resolved = Number(summaryQ.rows[0]?.resolved || 0);
      const totalPicks = Number(totalPicksQ.rows[0]?.total || 0);

      return NextResponse.json(
        {
          success: true,
          data: {
            window: { days, resolved, totalPicks, sport: sportFilter || 'all' },
            byMarket,
            byPattern,
            bySystemCategory,
          },
        },
        {
          headers: {
            // Cache for 5 minutes — winrates don't change rapidly
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          },
        }
      );
    } finally {
      client.release();
    }
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
