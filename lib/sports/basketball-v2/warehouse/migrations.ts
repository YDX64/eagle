/**
 * Basketball v2 Schema Migrations
 *
 * Reads schema.sql and executes it against the warehouse. All statements are
 * idempotent (CREATE TABLE IF NOT EXISTS) so this can run on every container
 * start. Takes < 100ms typically.
 *
 * Usage:
 *   import { ensureBbSchema } from './warehouse/migrations';
 *   await ensureBbSchema();
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getBbPool } from './connection';

let _schemaReady = false;

export async function ensureBbSchema(): Promise<void> {
  if (_schemaReady) return;

  const pool = getBbPool();
  const client = await pool.connect();

  try {
    // Read schema.sql from the same directory as this file
    const schemaPath = join(process.cwd(), 'lib/sports/basketball-v2/warehouse/schema.sql');
    let schemaSql: string;
    try {
      schemaSql = readFileSync(schemaPath, 'utf-8');
    } catch (err) {
      // In standalone (Docker) build, __dirname path may differ
      const altPath = join(__dirname, 'schema.sql');
      schemaSql = readFileSync(altPath, 'utf-8');
    }

    // Split on comment-terminated statements? No — pg client can run the
    // whole script at once via multiple statements in one query.
    await client.query(schemaSql);

    _schemaReady = true;
    console.log('[bb-v2] schema ensured');
  } catch (err) {
    console.error('[bb-v2] schema migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Force re-run of schema (for tests — resets the cached flag).
 */
export function resetSchemaCache(): void {
  _schemaReady = false;
}
