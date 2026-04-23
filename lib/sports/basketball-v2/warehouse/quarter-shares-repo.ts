/**
 * Quarter Shares Repository — bb_quarter_shares table
 *
 * Stores empirical per-quarter point distributions per league/season.
 * Computed from bb_games.home_linescore + away_linescore after backfill.
 *
 * Critical because hardcoded quarter shares like [24.5%, 24.5%, 25.5%, 25.5%]
 * don't match reality. NBA Q4 is often LOWER (end-game clock management),
 * EuroLeague Q2 is often HIGHER (no defensive 3-second violation). Empirical
 * calibration gives 2-3% probability improvement on period over/under markets.
 */

import { getBbPool } from './connection';
import { ensureBbSchema } from './migrations';

export interface QuarterShares {
  source: 'nba' | 'basketball';
  leagueId: number;
  season: string;
  q1Share: number;
  q2Share: number;
  q3Share: number;
  q4Share: number;
  fhShare: number;
  shShare: number;
  q1Std: number | null;
  q2Std: number | null;
  q3Std: number | null;
  q4Std: number | null;
  sampleGames: number;
  computedAt?: string;
}

export async function upsertQuarterShares(qs: QuarterShares): Promise<void> {
  await ensureBbSchema();
  const pool = getBbPool();
  await pool.query(
    `
    INSERT INTO bb_quarter_shares (
      source, league_id, season, q1_share, q2_share, q3_share, q4_share,
      fh_share, sh_share, q1_std, q2_std, q3_std, q4_std, sample_games, computed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT (source, league_id, season) DO UPDATE SET
      q1_share = EXCLUDED.q1_share,
      q2_share = EXCLUDED.q2_share,
      q3_share = EXCLUDED.q3_share,
      q4_share = EXCLUDED.q4_share,
      fh_share = EXCLUDED.fh_share,
      sh_share = EXCLUDED.sh_share,
      q1_std = EXCLUDED.q1_std,
      q2_std = EXCLUDED.q2_std,
      q3_std = EXCLUDED.q3_std,
      q4_std = EXCLUDED.q4_std,
      sample_games = EXCLUDED.sample_games,
      computed_at = NOW()
    `,
    [
      qs.source, qs.leagueId, qs.season,
      qs.q1Share, qs.q2Share, qs.q3Share, qs.q4Share,
      qs.fhShare, qs.shShare,
      qs.q1Std, qs.q2Std, qs.q3Std, qs.q4Std,
      qs.sampleGames,
    ]
  );
}

function rowToQs(row: any): QuarterShares {
  return {
    source: row.source,
    leagueId: row.league_id,
    season: row.season,
    q1Share: parseFloat(row.q1_share),
    q2Share: parseFloat(row.q2_share),
    q3Share: parseFloat(row.q3_share),
    q4Share: parseFloat(row.q4_share),
    fhShare: parseFloat(row.fh_share),
    shShare: parseFloat(row.sh_share),
    q1Std: row.q1_std ? parseFloat(row.q1_std) : null,
    q2Std: row.q2_std ? parseFloat(row.q2_std) : null,
    q3Std: row.q3_std ? parseFloat(row.q3_std) : null,
    q4Std: row.q4_std ? parseFloat(row.q4_std) : null,
    sampleGames: row.sample_games,
    computedAt: row.computed_at instanceof Date
      ? row.computed_at.toISOString()
      : row.computed_at,
  };
}

export async function getQuarterShares(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string
): Promise<QuarterShares | null> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `SELECT * FROM bb_quarter_shares
     WHERE source = $1 AND league_id = $2 AND season = $3`,
    [source, leagueId, season]
  );
  return res.rows[0] ? rowToQs(res.rows[0]) : null;
}

/**
 * Fallback to NBA defaults if no empirical data available.
 * These are from the NBA 2020-2024 aggregates.
 */
export const DEFAULT_QUARTER_SHARES: Record<'nba' | 'basketball', QuarterShares> = {
  nba: {
    source: 'nba',
    leagueId: 0,
    season: 'default',
    q1Share: 0.246,
    q2Share: 0.247,
    q3Share: 0.254,
    q4Share: 0.253,
    fhShare: 0.493,
    shShare: 0.507,
    q1Std: 0.03,
    q2Std: 0.03,
    q3Std: 0.03,
    q4Std: 0.03,
    sampleGames: 0,
  },
  basketball: {
    source: 'basketball',
    leagueId: 0,
    season: 'default',
    q1Share: 0.245,
    q2Share: 0.245,
    q3Share: 0.255,
    q4Share: 0.255,
    fhShare: 0.49,
    shShare: 0.51,
    q1Std: 0.03,
    q2Std: 0.03,
    q3Std: 0.03,
    q4Std: 0.03,
    sampleGames: 0,
  },
};
