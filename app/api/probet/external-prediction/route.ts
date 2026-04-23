/**
 * POST /api/probet/external-prediction
 *
 * Dış uygulamaların (hockey-2, basketball vb.) tahmin/kupon kayıtlarını
 * probet tracking DB'sine yazması için köprü endpoint.
 *
 * Beden:
 *   {
 *     sport: 'hockey-2' | 'basketball-2' | 'football-2' | ...,
 *     fixtureId: number,
 *     homeTeam: string,
 *     awayTeam: string,
 *     league: string,
 *     matchDate: string (ISO),
 *     bets: [
 *       { betType, selection, odds, trueProbability, edge, confidence }
 *     ],
 *     coupon?: {
 *       id, name, totalOdds, stake, potentialReturn, riskLevel, strategyName
 *     }
 *   }
 *
 * Kullanım: hockey-2'nin couponStore.saveCoupon() fonksiyonu bu endpoint'i
 * çağırarak her kuponu probet'in predictions + picks + system_bets tablolarına
 * yazar. Böylece winrate hesaplaması ve ROI takibi tek çatıda yapılır.
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
  return _pool;
}

interface ExternalBet {
  betType: string;
  selection: string;
  odds: number;
  trueProbability?: number;
  edge?: number;
  confidence?: number;
  marketKey?: string; // optional normalized market ID (e.g. OVER_55)
}

interface ExternalCoupon {
  id: string;
  name?: string;
  totalOdds: number;
  stake?: number;
  potentialReturn?: number;
  riskLevel?: string;
  strategyName?: string;
}

interface ExternalPredictionBody {
  sport: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league?: string;
  matchDate?: string;
  bets: ExternalBet[];
  coupon?: ExternalCoupon;
  source?: string; // e.g. 'hockey-2'
}

function normaliseMarketKey(betType: string, selection: string): string {
  const bt = (betType || '').toUpperCase().replace(/\s+/g, '_');
  const sel = (selection || '').toUpperCase().replace(/\s+/g, '_');
  return `${bt}__${sel}`.replace(/[^A-Z0-9_]/g, '');
}

function riskFromEdgeProb(prob: number, odds: number): 'low' | 'medium' | 'high' {
  if (prob >= 0.5 && odds <= 2.5) return 'low';
  if (prob >= 0.3 && odds <= 5.0) return 'medium';
  return 'high';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExternalPredictionBody;
    if (!body || !body.sport || !body.fixtureId || !Array.isArray(body.bets) || body.bets.length === 0) {
      return NextResponse.json({ success: false, error: 'invalid body' }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Stable id: sport:fixtureId so re-posts are idempotent
      const predictionId = `${body.sport}:${body.fixtureId}`;

      // Pick the 'best' bet (highest trueProbability, fallback first)
      const sortedBets = [...body.bets].sort(
        (a, b) => (b.trueProbability || 0) - (a.trueProbability || 0)
      );
      const bestBet = sortedBets[0];
      const bestMarket = bestBet.marketKey || normaliseMarketKey(bestBet.betType, bestBet.selection);
      const confidence = bestBet.confidence ?? bestBet.trueProbability ?? 0.5;

      // UPSERT prediction row. We preserve actual_* if already resolved.
      await client.query(
        `INSERT INTO predictions
           (id, sport, fixture_id, home_team, away_team, league, match_date,
            status, confidence, best_market, best_pick_label,
            best_probability, best_market_odds, best_expected_value, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           home_team = EXCLUDED.home_team,
           away_team = EXCLUDED.away_team,
           league = EXCLUDED.league,
           match_date = EXCLUDED.match_date,
           confidence = EXCLUDED.confidence,
           best_market = EXCLUDED.best_market,
           best_pick_label = EXCLUDED.best_pick_label,
           best_probability = EXCLUDED.best_probability,
           best_market_odds = EXCLUDED.best_market_odds,
           best_expected_value = EXCLUDED.best_expected_value,
           payload = EXCLUDED.payload
        `,
        [
          predictionId,
          body.sport,
          body.fixtureId,
          body.homeTeam,
          body.awayTeam,
          body.league || null,
          body.matchDate ? new Date(body.matchDate) : null,
          confidence,
          bestMarket,
          bestBet.selection,
          bestBet.trueProbability || null,
          bestBet.odds || null,
          bestBet.edge || null,
          JSON.stringify({ source: body.source || body.sport, coupon: body.coupon || null }),
        ]
      );

      // Wipe existing picks for this prediction to avoid duplicates on re-post
      await client.query(`DELETE FROM picks WHERE prediction_id = $1`, [predictionId]);
      await client.query(`DELETE FROM system_bets WHERE prediction_id = $1`, [predictionId]);

      for (const bet of body.bets) {
        const mkey = bet.marketKey || normaliseMarketKey(bet.betType, bet.selection);
        const prob = bet.trueProbability || 0;
        const isHc = prob >= 0.7;
        const isBest = bet === bestBet;

        await client.query(
          `INSERT INTO picks (prediction_id, market, market_label, pick_label, category,
             probability, market_odds, expected_value, is_best, is_high_confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            predictionId,
            mkey,
            bet.betType,
            bet.selection,
            'EXTERNAL',
            prob,
            bet.odds || null,
            bet.edge || null,
            isBest,
            isHc,
          ]
        );
      }

      // If coupon provided — store each bet as a system_bet candidate too
      if (body.coupon && body.bets.length >= 2) {
        const riskLevel = (body.coupon.riskLevel || 'medium') as 'low' | 'medium' | 'high';
        for (const bet of body.bets) {
          const prob = bet.trueProbability || 0;
          const odds = bet.odds || 0;
          const mkey = bet.marketKey || normaliseMarketKey(bet.betType, bet.selection);
          await client.query(
            `INSERT INTO system_bets (prediction_id, market, pick_label,
               model_probability, market_odds, expected_value, kelly_stake,
               risk_level, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              predictionId,
              mkey,
              bet.selection,
              prob,
              odds,
              bet.edge || null,
              null,
              riskLevel || riskFromEdgeProb(prob, odds),
              body.coupon.strategyName || 'EXTERNAL',
            ]
          );
        }
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        predictionId,
        betsStored: body.bets.length,
        couponStored: body.coupon ? body.bets.length : 0,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
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
