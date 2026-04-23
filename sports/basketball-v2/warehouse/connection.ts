/**
 * Basketball v2 Warehouse PostgreSQL Connection
 *
 * Reuses the same awa-postgres connection settings as the probet tracking
 * store, but maintains its own pg Pool with a separate pool name. This lets
 * us tune basketball-v2 queries independently (e.g. higher max for backfill
 * bursts, lower for normal request-time reads).
 *
 * Environment variables (inherit from probet tracking if not set):
 *   BB_V2_PG_HOST       default: PROBET_PG_HOST || 'awa-postgres'
 *   BB_V2_PG_PORT       default: 5432
 *   BB_V2_PG_DB         default: 'probet'
 *   BB_V2_PG_USER       default: 'awauser'
 *   BB_V2_PG_PASSWORD   required
 *   BB_V2_PG_POOL_MAX   default: 12
 */

import { Pool, type PoolConfig } from 'pg';

const config: PoolConfig = {
  host: process.env.BB_V2_PG_HOST || process.env.PROBET_PG_HOST || 'awa-postgres',
  port: parseInt(process.env.BB_V2_PG_PORT || process.env.PROBET_PG_PORT || '5432', 10),
  database: process.env.BB_V2_PG_DB || process.env.PROBET_PG_DB || 'probet',
  user: process.env.BB_V2_PG_USER || process.env.PROBET_PG_USER || 'awauser',
  password: process.env.BB_V2_PG_PASSWORD || process.env.PROBET_PG_PASSWORD || '',
  max: parseInt(process.env.BB_V2_PG_POOL_MAX || '12', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'basketball-v2',
};

let _pool: Pool | null = null;

export function getBbPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool(config);
  _pool.on('error', (err) => {
    console.error('[bb-v2] pg pool error:', err.message);
  });
  return _pool;
}

/**
 * Gracefully close the pool (for tests or shutdown).
 */
export async function closeBbPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Health check — verifies the connection works.
 */
export async function pingBb(): Promise<{ ok: boolean; error?: string }> {
  try {
    const pool = getBbPool();
    const result = await pool.query('SELECT 1 as alive');
    return { ok: result.rows[0]?.alive === 1 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
