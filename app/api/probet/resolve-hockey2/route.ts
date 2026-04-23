/**
 * POST /api/probet/resolve-hockey2
 *
 * Hockey-2 predictions'ını api-sports.io/hockey üzerinden çözer. Tekrarlanabilir:
 * sadece bekleyen hockey-2 predictions için oynayan maçları çeker, finalize
 * olanları (FT) predictions.actual_* ve picks.hit alanlarına işler.
 *
 * Kullanım: cron ile saatte 1, veya manuel olarak UI'dan "Sonuçları yenile"
 * butonundan tetiklenir. Maç bitene kadar hiçbir pick hit olmaz (pending).
 *
 * Basit evaluator: Over/Under + Match Winner + Home/Away marketleri.
 * Gelecekte Period over/under vs. eklenebilir.
 */

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOCKEY_API_BASE = 'https://v1.hockey.api-sports.io';
const API_KEY = process.env.API_FOOTBALL_KEY || '';

let _pool: Pool | null = null;
function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({
    host: process.env.PROBET_PG_HOST || 'awa-postgres',
    port: parseInt(process.env.PROBET_PG_PORT || '5432', 10),
    database: process.env.PROBET_PG_DB || 'probet',
    user: process.env.PROBET_PG_USER || 'awauser',
    password: process.env.PROBET_PG_PASSWORD || '',
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return _pool;
}

interface HockeyGameResponse {
  id: number;
  status: { short: string; long: string };
  scores: { home: number | null; away: number | null };
  periods?: Record<string, string | null>;
}

async function fetchHockeyGame(gameId: number): Promise<HockeyGameResponse | null> {
  const url = `${HOCKEY_API_BASE}/games?id=${gameId}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY }, cache: 'no-store' });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json || !Array.isArray(json.response) || json.response.length === 0) return null;
  return json.response[0] as HockeyGameResponse;
}

function evaluatePick(betType: string, selection: string, homeGoals: number, awayGoals: number): boolean | null {
  const total = homeGoals + awayGoals;
  const bt = (betType || '').toLowerCase();
  const sel = (selection || '').toLowerCase();

  if (bt.includes('3way') || bt === 'match winner' || bt === 'ms') {
    if (sel === 'home' || sel === '1') return homeGoals > awayGoals;
    if (sel === 'draw' || sel === 'x') return homeGoals === awayGoals;
    if (sel === 'away' || sel === '2') return awayGoals > homeGoals;
  }

  if (bt === 'home/away') {
    if (sel === 'home') return homeGoals > awayGoals;
    if (sel === 'away') return awayGoals > homeGoals;
  }

  if (bt.includes('over/under') && !bt.includes('period')) {
    const line = parseFloat(selection.replace(/[^\d.]/g, ''));
    if (Number.isNaN(line)) return null;
    if (sel.startsWith('over')) return total > line;
    if (sel.startsWith('under')) return total < line;
  }

  return null;
}

export async function POST() {
  const pool = getPool();
  const client = await pool.connect();
  const result = { checked: 0, finalized: 0, picksResolved: 0, errors: [] as string[] };
  try {
    const pending = await client.query<{ id: string; fixture_id: number }>(
      `SELECT id, fixture_id FROM predictions WHERE sport = 'hockey-2' AND status = 'pending' ORDER BY match_date NULLS LAST LIMIT 100`
    );
    result.checked = pending.rowCount || 0;

    for (const row of pending.rows) {
      try {
        const game = await fetchHockeyGame(row.fixture_id);
        if (!game) continue;
        const short = game.status.short;
        // FT / AOT / AP = finished in various ways
        const isFinished = ['FT', 'AOT', 'AP'].includes(short);
        if (!isFinished) continue;
        const hg = game.scores.home ?? 0;
        const ag = game.scores.away ?? 0;

        await client.query('BEGIN');

        // Evaluate each pick
        const picks = await client.query<{ id: number; market: string; market_label: string | null; pick_label: string | null }>(
          `SELECT id, market, market_label, pick_label FROM picks WHERE prediction_id = $1 AND hit IS NULL`,
          [row.id]
        );
        let bestHit: boolean | null = null;
        for (const p of picks.rows) {
          const hit = evaluatePick(p.market_label || p.market, p.pick_label || '', hg, ag);
          if (hit === null) continue;
          await client.query(`UPDATE picks SET hit = $1 WHERE id = $2`, [hit, p.id]);
          result.picksResolved += 1;
        }

        // Best pick hit from predictions row (lookup matching pick)
        const bestPick = await client.query<{ hit: boolean | null }>(
          `SELECT hit FROM picks WHERE prediction_id = $1 AND is_best = TRUE LIMIT 1`,
          [row.id]
        );
        bestHit = bestPick.rows[0]?.hit ?? null;

        // Also resolve any matching system_bets entries
        const sysPicks = await client.query<{ id: number; market: string; pick_label: string | null }>(
          `SELECT id, market, pick_label FROM system_bets WHERE prediction_id = $1 AND hit IS NULL`,
          [row.id]
        );
        for (const sp of sysPicks.rows) {
          const hit = evaluatePick(sp.market, sp.pick_label || '', hg, ag);
          if (hit === null) continue;
          await client.query(`UPDATE system_bets SET hit = $1 WHERE id = $2`, [hit, sp.id]);
        }

        await client.query(
          `UPDATE predictions SET status = 'resolved', actual_home = $1, actual_away = $2, resolved_at = NOW(), best_pick_hit = $3 WHERE id = $4`,
          [hg, ag, bestHit, row.id]
        );

        await client.query('COMMIT');
        result.finalized += 1;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        result.errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

export async function GET() {
  return POST();
}
