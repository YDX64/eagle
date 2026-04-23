/**
 * ProBet Prediction Store (PostgreSQL)
 *
 * Persistent tracking of every prediction made by the engine, plus a
 * result-resolution pipeline that marks picks as WIN/LOSS once matches finish.
 *
 * Storage: PostgreSQL (awa-postgres) — dedicated `probet` database
 * Tables live in the default `public` schema. We use raw pg client rather
 * than Prisma to keep ProBet decoupled from the app's existing Prisma schema.
 *
 * Environment variables:
 *   PROBET_PG_HOST       default: 'awa-postgres'
 *   PROBET_PG_PORT       default: 5432
 *   PROBET_PG_DB         default: 'probet'
 *   PROBET_PG_USER       default: 'awauser'
 *   PROBET_PG_PASSWORD   required in production
 *
 * Schema design uses JSON columns for pattern/system_bets evidence to keep
 * the tracking DB flexible as we add new features.
 */

import { Pool, type PoolClient } from 'pg';

const pgConfig = {
  host: process.env.PROBET_PG_HOST || 'awa-postgres',
  port: parseInt(process.env.PROBET_PG_PORT || '5432', 10),
  database: process.env.PROBET_PG_DB || 'probet',
  user: process.env.PROBET_PG_USER || 'awauser',
  password: process.env.PROBET_PG_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

let _pool: Pool | null = null;
let _schemaReady = false;

function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool(pgConfig);
  _pool.on('error', (err) => {
    console.error('[probet-store] pg pool error:', err.message);
  });
  return _pool;
}

async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS predictions (
        id TEXT PRIMARY KEY,
        sport TEXT NOT NULL DEFAULT 'football',
        fixture_id INTEGER NOT NULL,
        home_team TEXT,
        away_team TEXT,
        league TEXT,
        match_date TIMESTAMPTZ,
        predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'pending',
        home_win_prob DOUBLE PRECISION,
        draw_prob DOUBLE PRECISION,
        away_win_prob DOUBLE PRECISION,
        confidence DOUBLE PRECISION,
        best_market TEXT,
        best_pick_label TEXT,
        best_probability DOUBLE PRECISION,
        best_market_odds DOUBLE PRECISION,
        best_expected_value DOUBLE PRECISION,
        actual_home INTEGER,
        actual_away INTEGER,
        actual_ht_home INTEGER,
        actual_ht_away INTEGER,
        resolved_at TIMESTAMPTZ,
        best_pick_hit BOOLEAN,
        payload JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_predictions_fixture ON predictions(fixture_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_sport ON predictions(sport);
      CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
      CREATE INDEX IF NOT EXISTS idx_predictions_match_date ON predictions(match_date);
      CREATE INDEX IF NOT EXISTS idx_predictions_predicted_at ON predictions(predicted_at);

      CREATE TABLE IF NOT EXISTS picks (
        id BIGSERIAL PRIMARY KEY,
        prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
        market TEXT NOT NULL,
        market_label TEXT,
        pick_label TEXT,
        category TEXT,
        probability DOUBLE PRECISION,
        market_odds DOUBLE PRECISION,
        expected_value DOUBLE PRECISION,
        is_best BOOLEAN DEFAULT FALSE,
        is_high_confidence BOOLEAN DEFAULT FALSE,
        hit BOOLEAN,
        score_value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_picks_prediction ON picks(prediction_id);
      CREATE INDEX IF NOT EXISTS idx_picks_market ON picks(market);
      CREATE INDEX IF NOT EXISTS idx_picks_hit ON picks(hit);

      CREATE TABLE IF NOT EXISTS pattern_matches (
        id BIGSERIAL PRIMARY KEY,
        prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
        pattern_id TEXT NOT NULL,
        pattern_name TEXT,
        pattern_category TEXT,
        hit_rate DOUBLE PRECISION,
        sample_size INTEGER,
        is_banko BOOLEAN DEFAULT FALSE,
        predicted_market TEXT,
        hit BOOLEAN
      );
      CREATE INDEX IF NOT EXISTS idx_patterns_prediction ON pattern_matches(prediction_id);
      CREATE INDEX IF NOT EXISTS idx_patterns_id ON pattern_matches(pattern_id);
      CREATE INDEX IF NOT EXISTS idx_patterns_hit ON pattern_matches(hit);

      CREATE TABLE IF NOT EXISTS system_bets (
        id BIGSERIAL PRIMARY KEY,
        prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
        market TEXT NOT NULL,
        pick_label TEXT,
        model_probability DOUBLE PRECISION,
        market_odds DOUBLE PRECISION,
        expected_value DOUBLE PRECISION,
        kelly_stake DOUBLE PRECISION,
        risk_level TEXT,
        category TEXT,
        hit BOOLEAN
      );
      CREATE INDEX IF NOT EXISTS idx_system_bets_prediction ON system_bets(prediction_id);
      CREATE INDEX IF NOT EXISTS idx_system_bets_category ON system_bets(category);
      CREATE INDEX IF NOT EXISTS idx_system_bets_hit ON system_bets(hit);
    `);
    _schemaReady = true;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface PickLike {
  market: string;
  marketLabel: string;
  pickLabel: string;
  category: string;
  probability: number;
  marketOdds?: number;
  expectedValue?: number;
  scoreValue?: string;
}

export interface StoredPrediction {
  sport: 'football' | 'basketball' | 'hockey' | 'volleyball' | 'handball';
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  confidence: number;
  bestPick: PickLike;
  topPicks?: PickLike[];
  highConfidencePicks?: PickLike[];
  patternMatches?: Array<{
    pattern: {
      id: string;
      name: string;
      category: string;
      prediction: string;
    };
    hitRate: number;
    sampleSize: number;
    isBanko: boolean;
  }>;
  systemBetCandidates?: Array<{
    market: string;
    pickLabel: string;
    category: string;
    modelProbability: number;
    marketOdds: number;
    expectedValue: number;
    kellyStake: number;
    riskLevel: string;
  }>;
}

/**
 * Save (UPSERT) a full prediction snapshot. Idempotent — if the same
 * (sport, fixtureId) already exists, it is replaced. Existing actual_* fields
 * are preserved so re-predicting doesn't wipe resolved data.
 */
export async function savePrediction(p: StoredPrediction): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  const client = await pool.connect();
  const predId = `${p.sport}:${p.fixtureId}`;

  try {
    await client.query('BEGIN');

    // Delete dependent rows (picks/patterns/system_bets) so we can re-insert
    await client.query('DELETE FROM picks WHERE prediction_id = $1', [predId]);
    await client.query('DELETE FROM pattern_matches WHERE prediction_id = $1', [predId]);
    await client.query('DELETE FROM system_bets WHERE prediction_id = $1', [predId]);

    // UPSERT predictions row
    await client.query(
      `
      INSERT INTO predictions (
        id, sport, fixture_id, home_team, away_team, league, match_date,
        predicted_at, status, home_win_prob, draw_prob, away_win_prob,
        confidence, best_market, best_pick_label, best_probability,
        best_market_odds, best_expected_value, payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        NOW(), 'pending', $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        predicted_at = NOW(),
        home_win_prob = EXCLUDED.home_win_prob,
        draw_prob = EXCLUDED.draw_prob,
        away_win_prob = EXCLUDED.away_win_prob,
        confidence = EXCLUDED.confidence,
        best_market = EXCLUDED.best_market,
        best_pick_label = EXCLUDED.best_pick_label,
        best_probability = EXCLUDED.best_probability,
        best_market_odds = EXCLUDED.best_market_odds,
        best_expected_value = EXCLUDED.best_expected_value,
        payload = EXCLUDED.payload
      `,
      [
        predId,
        p.sport,
        p.fixtureId,
        p.homeTeam,
        p.awayTeam,
        p.league,
        p.matchDate,
        p.homeWinProb,
        p.drawProb,
        p.awayWinProb,
        p.confidence,
        p.bestPick.market,
        p.bestPick.pickLabel,
        p.bestPick.probability,
        p.bestPick.marketOdds ?? null,
        p.bestPick.expectedValue ?? null,
        JSON.stringify({
          bestPick: p.bestPick,
          topPicks: p.topPicks ?? [],
          highConfidencePicks: p.highConfidencePicks ?? [],
        }),
      ]
    );

    // Collect picks to insert (dedupe by market + pickLabel key)
    const seen = new Set<string>();
    const hcKeys = new Set(
      (p.highConfidencePicks ?? []).map((x) => x.market + '|' + x.pickLabel)
    );
    const picksToInsert: Array<{ pick: PickLike; isBest: boolean; isHc: boolean }> = [];

    const bestKey = p.bestPick.market + '|' + p.bestPick.pickLabel;
    picksToInsert.push({ pick: p.bestPick, isBest: true, isHc: hcKeys.has(bestKey) });
    seen.add(bestKey);

    for (const pick of p.topPicks ?? []) {
      const key = pick.market + '|' + pick.pickLabel;
      if (seen.has(key)) continue;
      seen.add(key);
      picksToInsert.push({ pick, isBest: false, isHc: hcKeys.has(key) });
    }
    for (const pick of p.highConfidencePicks ?? []) {
      const key = pick.market + '|' + pick.pickLabel;
      if (seen.has(key)) continue;
      seen.add(key);
      picksToInsert.push({ pick, isBest: false, isHc: true });
    }

    for (const { pick, isBest, isHc } of picksToInsert) {
      await client.query(
        `
        INSERT INTO picks (
          prediction_id, market, market_label, pick_label, category,
          probability, market_odds, expected_value, is_best, is_high_confidence,
          score_value
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          predId,
          pick.market,
          pick.marketLabel,
          pick.pickLabel,
          pick.category,
          pick.probability,
          pick.marketOdds ?? null,
          pick.expectedValue ?? null,
          isBest,
          isHc,
          pick.scoreValue ?? null,
        ]
      );
    }

    for (const m of p.patternMatches ?? []) {
      await client.query(
        `
        INSERT INTO pattern_matches (
          prediction_id, pattern_id, pattern_name, pattern_category,
          hit_rate, sample_size, is_banko, predicted_market
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          predId,
          m.pattern.id,
          m.pattern.name,
          m.pattern.category,
          m.hitRate,
          m.sampleSize,
          m.isBanko,
          m.pattern.prediction,
        ]
      );
    }

    for (const sb of p.systemBetCandidates ?? []) {
      await client.query(
        `
        INSERT INTO system_bets (
          prediction_id, market, pick_label, model_probability, market_odds,
          expected_value, kelly_stake, risk_level, category
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          predId,
          sb.market,
          sb.pickLabel,
          sb.modelProbability,
          sb.marketOdds,
          sb.expectedValue,
          sb.kellyStake,
          sb.riskLevel,
          sb.category,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fire-and-forget wrapper. Logs errors but doesn't throw — used inside
 * predictFixture so a DB outage doesn't kill live predictions.
 */
export function savePredictionAsync(p: StoredPrediction): void {
  savePrediction(p).catch((err) => {
    console.error('[probet-store] savePrediction failed:', err.message);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Result Resolution
// ─────────────────────────────────────────────────────────────────────────────
export interface MatchOutcome {
  homeGoals: number;
  awayGoals: number;
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
}

/**
 * Given a market key + match outcome, compute whether the pick hit.
 * Returns null for markets we can't resolve without extra stats
 * (corners, cards, first goal).
 */
function resolveMarket(
  market: string,
  scoreValue: string | null | undefined,
  outcome: MatchOutcome
): boolean | null {
  const h = outcome.homeGoals;
  const a = outcome.awayGoals;
  const total = h + a;
  const htH = outcome.htHomeGoals;
  const htA = outcome.htAwayGoals;
  const bothScored = h > 0 && a > 0;
  const htReady = htH !== null && htH !== undefined && htA !== null && htA !== undefined;

  switch (market) {
    case 'HOME_WIN': return h > a;
    case 'DRAW': return h === a;
    case 'AWAY_WIN': return h < a;
    case 'DC_1X': return h >= a;
    case 'DC_12': return h !== a;
    case 'DC_X2': return h <= a;
    case 'DNB_HOME': return h > a;
    case 'DNB_AWAY': return h < a;
    case 'OVER_05': return total >= 1;
    case 'UNDER_05': return total < 1;
    case 'OVER_15': return total >= 2;
    case 'UNDER_15': return total < 2;
    case 'OVER_25': return total >= 3;
    case 'UNDER_25': return total < 3;
    case 'OVER_35': return total >= 4;
    case 'UNDER_35': return total < 4;
    case 'OVER_45': return total >= 5;
    case 'UNDER_45': return total < 5;
    case 'OVER_55': return total >= 6;
    case 'UNDER_55': return total < 6;
    case 'BTTS_YES': return bothScored;
    case 'BTTS_NO': return !bothScored;
    case 'BTTS_YES_OVER_25': return bothScored && total >= 3;
    case 'BTTS_YES_UNDER_25': return bothScored && total < 3;
    case 'BTTS_NO_OVER_25': return !bothScored && total >= 3;
    case 'BTTS_NO_UNDER_25': return !bothScored && total < 3;
    case 'HOME_OVER_05': return h >= 1;
    case 'HOME_UNDER_05': return h < 1;
    case 'HOME_OVER_15': return h >= 2;
    case 'HOME_UNDER_15': return h < 2;
    case 'HOME_OVER_25': return h >= 3;
    case 'HOME_UNDER_25': return h < 3;
    case 'AWAY_OVER_05': return a >= 1;
    case 'AWAY_UNDER_05': return a < 1;
    case 'AWAY_OVER_15': return a >= 2;
    case 'AWAY_UNDER_15': return a < 2;
    case 'AWAY_OVER_25': return a >= 3;
    case 'AWAY_UNDER_25': return a < 3;
    case 'HOME_CLEAN_SHEET': return a === 0;
    case 'AWAY_CLEAN_SHEET': return h === 0;
    case 'HOME_WIN_TO_NIL': return h > a && a === 0;
    case 'AWAY_WIN_TO_NIL': return a > h && h === 0;
    case 'AH_HOME_MINUS_1': return h - a >= 2;
    case 'AH_HOME_MINUS_15': return h - a >= 2;
    case 'AH_AWAY_MINUS_1': return a - h >= 2;
    case 'AH_AWAY_MINUS_15': return a - h >= 2;
    case 'AH_HOME_PLUS_1': return h + 1 >= a;
    case 'AH_AWAY_PLUS_1': return a + 1 >= h;
    case 'HT_HOME': return htReady ? htH! > htA! : null;
    case 'HT_DRAW': return htReady ? htH! === htA! : null;
    case 'HT_AWAY': return htReady ? htH! < htA! : null;
    case 'HT_OVER_05': return htReady ? htH! + htA! >= 1 : null;
    case 'HT_UNDER_05': return htReady ? htH! + htA! < 1 : null;
    case 'HT_OVER_15': return htReady ? htH! + htA! >= 2 : null;
    case 'HT_UNDER_15': return htReady ? htH! + htA! < 2 : null;
    case 'CORRECT_SCORE':
      if (!scoreValue) return null;
      return scoreValue === `${h}-${a}`;
    default:
      return null; // CORNERS_*, CARDS_*, FIRST_GOAL_* need extra data
  }
}

/**
 * Parse HTFT code from pickLabel: "... (İY 1 / MS 2)" → 1/2 → returns hit
 */
function resolveHtftFromLabel(pickLabel: string, outcome: MatchOutcome): boolean | null {
  const match = pickLabel.match(/\(İY ([1X2]) \/ MS ([1X2])\)/);
  if (!match) return null;
  const [, htCode, ftCode] = match;
  if (outcome.htHomeGoals == null || outcome.htAwayGoals == null) return null;
  const htH = outcome.htHomeGoals;
  const htA = outcome.htAwayGoals;
  const h = outcome.homeGoals;
  const a = outcome.awayGoals;
  const actualHt = htH > htA ? '1' : htH < htA ? '2' : 'X';
  const actualFt = h > a ? '1' : h < a ? '2' : 'X';
  return actualHt === htCode && actualFt === ftCode;
}

function resolvePattern(predictedMarket: string, outcome: MatchOutcome): boolean | null {
  if (!predictedMarket.startsWith('HTFT_')) {
    return resolveMarket(predictedMarket, null, outcome);
  }
  const htH = outcome.htHomeGoals;
  const htA = outcome.htAwayGoals;
  const h = outcome.homeGoals;
  const a = outcome.awayGoals;
  if (htH == null || htA == null) return null;
  const actualHt = htH > htA ? 'H' : htH < htA ? 'A' : 'D';
  const actualFt = h > a ? 'H' : h < a ? 'A' : 'D';
  const code = predictedMarket.replace('HTFT_', '');
  const mapChar = (c: string) => (c === '1' ? 'H' : c === '2' ? 'A' : c === 'X' ? 'D' : c);
  if (code.length !== 2) return null;
  return mapChar(code[0]) === actualHt && mapChar(code[1]) === actualFt;
}

/**
 * Resolve a single prediction — updates picks, patterns, system bets.
 */
export async function resolvePrediction(
  predictionId: string,
  outcome: MatchOutcome
): Promise<{ picksResolved: number; picksHit: number; bestPickHit: boolean | null }> {
  await ensureSchema();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      UPDATE predictions
      SET actual_home = $1, actual_away = $2, actual_ht_home = $3, actual_ht_away = $4,
          resolved_at = NOW(), status = 'resolved'
      WHERE id = $5
      `,
      [outcome.homeGoals, outcome.awayGoals, outcome.htHomeGoals ?? null, outcome.htAwayGoals ?? null, predictionId]
    );

    const picksRes = await client.query(
      'SELECT id, market, score_value, pick_label FROM picks WHERE prediction_id = $1',
      [predictionId]
    );

    let picksResolved = 0;
    let picksHit = 0;

    for (const pick of picksRes.rows) {
      let hit: boolean | null;
      if (pick.market === 'HTFT') {
        hit = resolveHtftFromLabel(pick.pick_label, outcome);
      } else {
        hit = resolveMarket(pick.market, pick.score_value, outcome);
      }
      if (hit !== null) {
        picksResolved++;
        if (hit) picksHit++;
        await client.query('UPDATE picks SET hit = $1 WHERE id = $2', [hit, pick.id]);
      }
    }

    const bestRes = await client.query(
      'SELECT hit FROM picks WHERE prediction_id = $1 AND is_best = TRUE LIMIT 1',
      [predictionId]
    );
    const bestPickHit = bestRes.rows[0]?.hit ?? null;
    await client.query('UPDATE predictions SET best_pick_hit = $1 WHERE id = $2', [
      bestPickHit,
      predictionId,
    ]);

    const patternsRes = await client.query(
      'SELECT id, predicted_market FROM pattern_matches WHERE prediction_id = $1',
      [predictionId]
    );
    for (const p of patternsRes.rows) {
      const hit = resolvePattern(p.predicted_market, outcome);
      if (hit !== null) {
        await client.query('UPDATE pattern_matches SET hit = $1 WHERE id = $2', [hit, p.id]);
      }
    }

    const systemBetsRes = await client.query(
      'SELECT id, market, pick_label FROM system_bets WHERE prediction_id = $1',
      [predictionId]
    );
    for (const sb of systemBetsRes.rows) {
      let hit: boolean | null;
      if (sb.market === 'HTFT') {
        hit = resolveHtftFromLabel(sb.pick_label, outcome);
      } else if (sb.market === 'CORRECT_SCORE') {
        const m = sb.pick_label.match(/(\d+-\d+)/);
        hit = m ? m[1] === `${outcome.homeGoals}-${outcome.awayGoals}` : null;
      } else {
        hit = resolveMarket(sb.market, null, outcome);
      }
      if (hit !== null) {
        await client.query('UPDATE system_bets SET hit = $1 WHERE id = $2', [hit, sb.id]);
      }
    }

    await client.query('COMMIT');
    return { picksResolved, picksHit, bestPickHit };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Find pending predictions whose match date has passed (candidates for
 * result resolution).
 */
export async function getPendingFinishedPredictions(beforeIso?: string): Promise<
  Array<{
    id: string;
    sport: string;
    fixtureId: number;
    homeTeam: string;
    awayTeam: string;
    matchDate: string;
  }>
> {
  await ensureSchema();
  const pool = getPool();
  const cutoff = beforeIso ?? new Date().toISOString();
  const res = await pool.query(
    `
    SELECT id, sport, fixture_id AS "fixtureId", home_team AS "homeTeam",
           away_team AS "awayTeam", match_date AS "matchDate"
    FROM predictions
    WHERE status = 'pending' AND match_date < $1
    ORDER BY match_date DESC
    LIMIT 500
    `,
    [cutoff]
  );
  return res.rows.map((r: any) => ({
    ...r,
    matchDate: r.matchDate instanceof Date ? r.matchDate.toISOString() : r.matchDate,
  }));
}

/**
 * Retrieve a prediction's status + pick resolution for UI display.
 */
export async function getPredictionStatus(
  sport: string,
  fixtureId: number
): Promise<{
  status: 'pending' | 'resolved' | 'unknown';
  actualHome?: number;
  actualAway?: number;
  actualHtHome?: number | null;
  actualHtAway?: number | null;
  bestPickHit?: boolean | null;
  picks?: Array<{
    market: string;
    marketLabel: string;
    pickLabel: string;
    probability: number;
    marketOdds?: number;
    hit: boolean | null;
    isBest: boolean;
  }>;
}> {
  try {
    await ensureSchema();
  } catch {
    return { status: 'unknown' };
  }
  const pool = getPool();
  const predId = `${sport}:${fixtureId}`;
  const res = await pool.query(
    `
    SELECT status, actual_home, actual_away, actual_ht_home, actual_ht_away, best_pick_hit
    FROM predictions WHERE id = $1
    `,
    [predId]
  );
  if (res.rows.length === 0) return { status: 'unknown' };

  const pred = res.rows[0];
  const picksRes = await pool.query(
    `
    SELECT market, market_label AS "marketLabel", pick_label AS "pickLabel",
           probability, market_odds AS "marketOdds", hit, is_best AS "isBest"
    FROM picks WHERE prediction_id = $1
    `,
    [predId]
  );

  return {
    status: pred.status,
    actualHome: pred.actual_home ?? undefined,
    actualAway: pred.actual_away ?? undefined,
    actualHtHome: pred.actual_ht_home,
    actualHtAway: pred.actual_ht_away,
    bestPickHit: pred.best_pick_hit,
    picks: picksRes.rows.map((p: any) => ({
      market: p.market,
      marketLabel: p.marketLabel,
      pickLabel: p.pickLabel,
      probability: p.probability,
      marketOdds: p.marketOdds ?? undefined,
      hit: p.hit,
      isBest: p.isBest,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregated Tracking Stats
// ─────────────────────────────────────────────────────────────────────────────
export interface TrackingStats {
  totalPredictions: number;
  resolvedPredictions: number;
  pendingPredictions: number;
  bestPickHits: number;
  bestPickAccuracy: number;
  bySport: Record<
    string,
    { total: number; resolved: number; bestPickHits: number; bestPickAccuracy: number }
  >;
  byMarket: Array<{
    market: string;
    marketLabel: string;
    total: number;
    hits: number;
    accuracy: number;
  }>;
  byPattern: Array<{
    patternId: string;
    patternName: string;
    total: number;
    hits: number;
    accuracy: number;
    avgHitRate: number;
    isBanko: boolean;
  }>;
  bySystemCategory: Array<{
    category: string;
    total: number;
    hits: number;
    accuracy: number;
    avgEv: number;
  }>;
  byConfidenceBucket: Array<{
    bucket: string;
    total: number;
    hits: number;
    accuracy: number;
  }>;
}

export async function getTrackingStats(): Promise<TrackingStats> {
  await ensureSchema();
  const pool = getPool();

  const overviewRes = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END)::int AS resolved,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending,
      SUM(CASE WHEN best_pick_hit = TRUE THEN 1 ELSE 0 END)::int AS "bestHits"
    FROM predictions
  `);
  const overview = overviewRes.rows[0];

  const bySportRes = await pool.query(`
    SELECT sport, COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END)::int AS resolved,
           SUM(CASE WHEN best_pick_hit = TRUE THEN 1 ELSE 0 END)::int AS "bestHits"
    FROM predictions GROUP BY sport
  `);

  const bySport: TrackingStats['bySport'] = {};
  for (const row of bySportRes.rows) {
    bySport[row.sport] = {
      total: row.total,
      resolved: row.resolved ?? 0,
      bestPickHits: row.bestHits ?? 0,
      bestPickAccuracy: row.resolved > 0 ? (row.bestHits ?? 0) / row.resolved : 0,
    };
  }

  const byMarketRes = await pool.query(`
    SELECT market, MAX(market_label) AS "marketLabel",
           SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END)::int AS resolved,
           SUM(CASE WHEN hit = TRUE THEN 1 ELSE 0 END)::int AS hits
    FROM picks
    GROUP BY market
    HAVING SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END) >= 3
    ORDER BY resolved DESC
  `);
  const byMarket = byMarketRes.rows.map((r: any) => ({
    market: r.market,
    marketLabel: r.marketLabel ?? r.market,
    total: r.resolved,
    hits: r.hits ?? 0,
    accuracy: r.resolved > 0 ? (r.hits ?? 0) / r.resolved : 0,
  }));

  const byPatternRes = await pool.query(`
    SELECT pattern_id AS "patternId", MAX(pattern_name) AS "patternName",
           SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END)::int AS resolved,
           SUM(CASE WHEN hit = TRUE THEN 1 ELSE 0 END)::int AS hits,
           AVG(hit_rate) AS "avgHitRate",
           BOOL_OR(is_banko) AS "isBanko"
    FROM pattern_matches
    GROUP BY pattern_id
    ORDER BY resolved DESC
  `);
  const byPattern = byPatternRes.rows.map((r: any) => ({
    patternId: r.patternId,
    patternName: r.patternName ?? r.patternId,
    total: r.resolved ?? 0,
    hits: r.hits ?? 0,
    accuracy: r.resolved > 0 ? (r.hits ?? 0) / r.resolved : 0,
    avgHitRate: Number(r.avgHitRate) ?? 0,
    isBanko: r.isBanko === true,
  }));

  const bySystemCatRes = await pool.query(`
    SELECT category,
           SUM(CASE WHEN hit IS NOT NULL THEN 1 ELSE 0 END)::int AS resolved,
           SUM(CASE WHEN hit = TRUE THEN 1 ELSE 0 END)::int AS hits,
           AVG(expected_value) AS "avgEv"
    FROM system_bets
    GROUP BY category
    ORDER BY resolved DESC
  `);
  const bySystemCategory = bySystemCatRes.rows.map((r: any) => ({
    category: r.category,
    total: r.resolved ?? 0,
    hits: r.hits ?? 0,
    accuracy: r.resolved > 0 ? (r.hits ?? 0) / r.resolved : 0,
    avgEv: Number(r.avgEv) ?? 0,
  }));

  const bucketRes = await pool.query(`
    SELECT
      CASE
        WHEN best_probability >= 0.80 THEN '>80%'
        WHEN best_probability >= 0.65 THEN '65-80%'
        WHEN best_probability >= 0.50 THEN '50-65%'
        WHEN best_probability >= 0.35 THEN '35-50%'
        ELSE '<35%'
      END AS bucket,
      SUM(CASE WHEN best_pick_hit IS NOT NULL THEN 1 ELSE 0 END)::int AS resolved,
      SUM(CASE WHEN best_pick_hit = TRUE THEN 1 ELSE 0 END)::int AS hits
    FROM predictions
    WHERE best_probability IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
  `);
  const byConfidenceBucket = bucketRes.rows.map((r: any) => ({
    bucket: r.bucket,
    total: r.resolved ?? 0,
    hits: r.hits ?? 0,
    accuracy: r.resolved > 0 ? (r.hits ?? 0) / r.resolved : 0,
  }));

  return {
    totalPredictions: overview.total ?? 0,
    resolvedPredictions: overview.resolved ?? 0,
    pendingPredictions: overview.pending ?? 0,
    bestPickHits: overview.bestHits ?? 0,
    bestPickAccuracy:
      (overview.resolved ?? 0) > 0 ? (overview.bestHits ?? 0) / overview.resolved : 0,
    bySport,
    byMarket,
    byPattern,
    bySystemCategory,
    byConfidenceBucket,
  };
}
