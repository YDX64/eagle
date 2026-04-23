/**
 * GET /api/probet/bulk-high-value
 *
 * Returns pending predictions grouped by the highest-performing filters:
 *  - BANKO patterns (super_banko_*, yuksek_skorlu_lock, msx_iy_gol, etc)
 *  - High-ROI markets (AH_AWAY_PLUS_1, OVER_25, HOME_WIN, UNDER_35, etc)
 *  - Positive-ROI system categories (UPSET::medium, GOAL_VALUE::high)
 *
 * Query params:
 *   ?sport=all|football|basketball|hockey-2   (default: all)
 *   ?days=3                                   (default: today + 2 days)
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
  _pool.on('error', () => { _pool = null; });
  return _pool;
}

// ─── Whitelist: filters proven to have positive ROI or very high winrate ──
const HIGH_ROI_MARKETS = [
  'AH_AWAY_PLUS_1',   // +161% ROI, 91%
  'OVER_25',          // +61% ROI, 73%
  'HOME_WIN',         // +15% ROI, 72%
  'UNDER_35',         // +1% ROI, 76%
  'AH_HOME_PLUS_1',   // +4% ROI, 94%
  'UNDER_55',         // 94% winrate
  'AWAY_UNDER_25',    // 87%
  'UNDER_45',         // 85%
  'OVER_15',          // 80%
  'HOME_UNDER_25',    // 82%
];

// Pattern IDs that are BANKO or have >70% winrate with n>=10
const BANKO_PATTERNS = [
  'super_banko_ms1x',
  'super_banko_over_05',
  'super_banko_btts_no',
  'super_banko_ms2x',
  'high_scoring_lock',
  'msx_433_iy_gol',
  'low_scoring_match',
  'btts_lock_o25_144',
  'strong_favorite_win',
  'dc_x2_safe',
  'strong_fav_home',
  'btts_no_defensive',
];

// System categories with positive ROI
const ROI_SYSTEM_KEYS = [
  'GOAL_VALUE::high',   // +98%
  'UPSET::medium',      // +82.8%
  'HTFT::medium',       // +14.3%
  'HTFT::high',         // +5%
];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const sport = (sp.get('sport') || 'all').trim().toLowerCase();
    const daysRaw = parseInt(sp.get('days') || '3', 10);
    const days = Math.min(Math.max(isNaN(daysRaw) ? 3 : daysRaw, 1), 14);
    const sportFilter = sport && sport !== 'all' ? sport : null;

    const pool = getPool();
    const client = await pool.connect();
    try {
      const now = new Date();
      const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      // Fetch pending predictions in date window
      const predQ = await client.query(
        `SELECT p.id, p.sport, p.fixture_id, p.home_team, p.away_team, p.league,
                p.match_date, p.confidence, p.best_market, p.best_pick_label,
                p.best_probability, p.best_market_odds, p.best_expected_value,
                p.home_win_prob, p.draw_prob, p.away_win_prob
         FROM predictions p
         WHERE p.status = 'pending'
           AND p.match_date >= $1 AND p.match_date < $2
           ${sportFilter ? 'AND p.sport = $3' : ''}
         ORDER BY p.match_date ASC, p.confidence DESC NULLS LAST`,
        sportFilter ? [now, until, sportFilter] : [now, until]
      );

      const predIds = predQ.rows.map((r: any) => r.id);
      if (predIds.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            banko: [], highRoiMarkets: [], systemBets: [],
            totals: { pendingPredictions: 0 },
          },
        });
      }

      // Pending picks in high-ROI markets
      const picksQ = await client.query(
        `SELECT p.prediction_id, p.market, p.market_label, p.pick_label,
                p.category, p.probability, p.market_odds, p.expected_value,
                p.is_best, p.is_high_confidence
         FROM picks p
         WHERE p.prediction_id = ANY($1)
           AND p.market = ANY($2)
           AND p.market_odds IS NOT NULL
         ORDER BY p.probability DESC`,
        [predIds, HIGH_ROI_MARKETS]
      );

      // Pending BANKO pattern matches
      const patQ = await client.query(
        `SELECT pm.prediction_id, pm.pattern_id, pm.pattern_name,
                pm.pattern_category, pm.is_banko, pm.predicted_market,
                pm.hit_rate, pm.sample_size
         FROM pattern_matches pm
         WHERE pm.prediction_id = ANY($1)
           AND pm.pattern_id = ANY($2)
         ORDER BY pm.hit_rate DESC NULLS LAST`,
        [predIds, BANKO_PATTERNS]
      );

      // Pending system bets in positive-ROI categories
      const sysQ = await client.query(
        `SELECT sb.prediction_id, sb.category, sb.risk_level, sb.market,
                sb.pick_label, sb.model_probability, sb.market_odds,
                sb.expected_value, sb.kelly_stake
         FROM system_bets sb
         WHERE sb.prediction_id = ANY($1)
           AND (sb.category || '::' || sb.risk_level) = ANY($2)
         ORDER BY sb.expected_value DESC NULLS LAST`,
        [predIds, ROI_SYSTEM_KEYS]
      );

      // Index predictions by id for join
      const predMap: Record<string, any> = {};
      for (const r of predQ.rows) {
        predMap[r.id] = {
          id: r.id,
          sport: r.sport,
          fixtureId: r.fixture_id,
          homeTeam: r.home_team,
          awayTeam: r.away_team,
          league: r.league,
          matchDate: r.match_date,
          confidence: r.confidence !== null ? Number(r.confidence) : null,
          bestMarket: r.best_market,
          bestPickLabel: r.best_pick_label,
          bestProbability: r.best_probability !== null ? Number(r.best_probability) : null,
          bestMarketOdds: r.best_market_odds !== null ? Number(r.best_market_odds) : null,
          bestExpectedValue: r.best_expected_value !== null ? Number(r.best_expected_value) : null,
        };
      }

      const highRoiMarkets = picksQ.rows.map((r: any) => ({
        ...predMap[r.prediction_id],
        pick: {
          market: r.market,
          marketLabel: r.market_label,
          pickLabel: r.pick_label,
          category: r.category,
          probability: r.probability !== null ? Number(r.probability) : null,
          marketOdds: r.market_odds !== null ? Number(r.market_odds) : null,
          expectedValue: r.expected_value !== null ? Number(r.expected_value) : null,
          isBest: Boolean(r.is_best),
        },
      }));

      const banko = patQ.rows.map((r: any) => ({
        ...predMap[r.prediction_id],
        pattern: {
          id: r.pattern_id,
          name: r.pattern_name,
          category: r.pattern_category,
          isBanko: Boolean(r.is_banko),
          predictedMarket: r.predicted_market,
          hitRate: r.hit_rate !== null ? Number(r.hit_rate) : null,
          sampleSize: r.sample_size !== null ? Number(r.sample_size) : null,
        },
      }));

      const systemBets = sysQ.rows.map((r: any) => ({
        ...predMap[r.prediction_id],
        system: {
          category: r.category,
          riskLevel: r.risk_level,
          market: r.market,
          pickLabel: r.pick_label,
          modelProbability: r.model_probability !== null ? Number(r.model_probability) : null,
          marketOdds: r.market_odds !== null ? Number(r.market_odds) : null,
          expectedValue: r.expected_value !== null ? Number(r.expected_value) : null,
          kellyStake: r.kelly_stake !== null ? Number(r.kelly_stake) : null,
        },
      }));

      return NextResponse.json({
        success: true,
        data: {
          banko,
          highRoiMarkets,
          systemBets,
          totals: {
            pendingPredictions: predIds.length,
            bankoMatches: banko.length,
            marketMatches: highRoiMarkets.length,
            systemMatches: systemBets.length,
          },
          filters: {
            markets: HIGH_ROI_MARKETS,
            patterns: BANKO_PATTERNS,
            systemKeys: ROI_SYSTEM_KEYS,
          },
        },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
