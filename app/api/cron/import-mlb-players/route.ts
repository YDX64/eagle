/**
 * MLB player stats import cron.
 *
 * Query params:
 *   season  — MLB 4-digit season string (default: current calendar year)
 *   mode    — 'rosters' | 'games' | 'both' (default: 'rosters')
 *   days    — how many days back to scan for finished boxscores (default 3)
 *   limit   — optional cap on teams imported (smoke testing)
 *   teams   — optional comma-separated list of MLB team ids
 *
 * Auth: bearer CRON_SECRET (matches /api/cron/daily-all-sports pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  backfillLastN as backfillMlb,
  importAllTeamRosters as importMlbRosters,
  type ImportOptions,
} from '@/lib/importers/mlb-importer';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

type Mode = 'rosters' | 'games' | 'both';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured = open (dev mode)
  const header = req.headers.get('authorization') ?? '';
  const provided = header.replace(/^Bearer\s+/i, '').trim();
  return provided === secret;
}

function defaultSeason(): string {
  // MLB regular season runs Mar–Oct. Calendar year is the canonical key.
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  // Before March we usually still want the previous season's data.
  const year = month < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return String(year);
}

function parseMode(value: string | null): Mode {
  const v = (value ?? 'rosters').toLowerCase();
  if (v === 'games' || v === 'both') return v;
  return 'rosters';
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const season = p.get('season') ?? defaultSeason();
  const mode = parseMode(p.get('mode'));
  const daysRaw = Number(p.get('days') ?? 3);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(30, Math.floor(daysRaw)) : 3;
  const limitRaw = Number(p.get('limit') ?? 0);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;
  const teamsParam = p.get('teams');
  const teamIds =
    teamsParam && teamsParam.trim().length > 0
      ? teamsParam
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n) && n > 0)
      : undefined;

  const options: ImportOptions = {};
  if (limit) options.limit_teams = limit;
  if (teamIds && teamIds.length > 0) options.team_ids = teamIds;

  const startedAt = new Date();
  const payload: Record<string, unknown> = {
    season,
    mode,
    started_at: startedAt.toISOString(),
  };

  try {
    if (mode === 'rosters' || mode === 'both') {
      payload.rosters = await importMlbRosters(season, options);
    }
    if (mode === 'games' || mode === 'both') {
      payload.games = await backfillMlb(days);
    }
    payload.finished_at = new Date().toISOString();
    return NextResponse.json({ success: true, data: payload });
  } catch (err) {
    payload.finished_at = new Date().toISOString();
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown',
        partial: payload,
      },
      { status: 500 },
    );
  }
}
