/**
 * Tracking database (PostgreSQL `probet` on awa-postgres).
 *
 * The user's legacy engines (lib/probet/*, lib/algorithms/goal-analyzer,
 * multi-sport prediction stores) all talk to SQLite via Prisma. Tracking
 * lives in a separate PostgreSQL DB, accessed here via `pg` (node-postgres)
 * with a connection pool and parameterized queries.
 *
 * Why a second DB:
 * - The legacy SQLite store keeps the existing feature set untouched.
 * - Cross-sport tracking + market analytics + player props need joins,
 *   window functions and 10M+ row scale that SQLite handles poorly.
 * - Prisma's single datasource constraint means two stores => two clients.
 *
 * Env:
 * - `TRACKING_DATABASE_URL` (preferred) — full postgres URL
 * - `PROBET_PG_HOST` / `PROBET_PG_PORT` / `PROBET_PG_DB` / `PROBET_PG_USER`
 *   / `PROBET_PG_PASSWORD_URL` — component pieces (URL-encoded password)
 */

import { Pool, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

function buildConnectionString(): string | null {
  if (process.env.TRACKING_DATABASE_URL) return process.env.TRACKING_DATABASE_URL;
  const host = process.env.PROBET_PG_HOST;
  const port = process.env.PROBET_PG_PORT ?? '5432';
  const db = process.env.PROBET_PG_DB;
  const user = process.env.PROBET_PG_USER;
  const pw = process.env.PROBET_PG_PASSWORD_URL ?? process.env.PROBET_PG_PASSWORD;
  if (!host || !db || !user || !pw) return null;
  const encodedPw = process.env.PROBET_PG_PASSWORD_URL
    ? pw
    : encodeURIComponent(pw);
  return `postgresql://${user}:${encodedPw}@${host}:${port}/${db}`;
}

function getPool(): Pool | null {
  if (pool) return pool;
  const connectionString = buildConnectionString();
  if (!connectionString) {
    console.warn('[db-tracking] no TRACKING_DATABASE_URL or PROBET_PG_* env — tracking disabled');
    return null;
  }
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: 'probet-tracking',
  });
  pool.on('error', err => {
    console.error('[db-tracking] pool error (non-fatal):', err.message);
  });
  return pool;
}

export function isTrackingEnabled(): boolean {
  return getPool() !== null;
}

/**
 * Run a parameterized query. Returns an empty array when tracking is disabled
 * so callers can degrade gracefully.
 */
export async function query<T extends QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query<T>(sql, params);
    return res.rows;
  } catch (err) {
    console.error('[db-tracking] query failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Run a single-row query. Returns `null` when the query returns 0 rows or
 * when tracking is disabled. Useful for `SELECT ... LIMIT 1` or aggregate
 * queries.
 */
export async function queryOne<T extends QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute a write query (INSERT/UPDATE/DELETE) and return affected row count.
 * Returns 0 on failure — **always** check the return value in critical paths.
 */
export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const p = getPool();
  if (!p) return 0;
  try {
    const res = await p.query(sql, params);
    return res.rowCount ?? 0;
  } catch (err) {
    console.error('[db-tracking] execute failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Shorthand for transactional work. Auto-commit / auto-rollback. The fn
 * receives a pg client bound to a single connection, so statements are
 * guaranteed to run in the same transaction.
 */
export async function withTransaction<T>(
  fn: (client: {
    query: <R extends QueryResultRow = any>(sql: string, params?: unknown[]) => Promise<R[]>;
    execute: (sql: string, params?: unknown[]) => Promise<number>;
  }) => Promise<T>,
): Promise<T | null> {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const wrapped = {
      query: async <R extends QueryResultRow = any>(sql: string, params: unknown[] = []) => {
        const r = await client.query<R>(sql, params);
        return r.rows;
      },
      execute: async (sql: string, params: unknown[] = []) => {
        const r = await client.query(sql, params);
        return r.rowCount ?? 0;
      },
    };
    const result = await fn(wrapped);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db-tracking] transaction rolled back:', err instanceof Error ? err.message : err);
    throw err;
  } finally {
    client.release();
  }
}

/** Healthcheck — used by the cron wiring + the dashboard. */
export async function pingTracking(): Promise<{ ok: boolean; error?: string }> {
  const p = getPool();
  if (!p) return { ok: false, error: 'not-configured' };
  try {
    await p.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
