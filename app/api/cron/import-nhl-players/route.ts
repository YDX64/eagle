/**
 * NHL player stats import cron.
 *
 * Query params:
 *   season  — NHL 8-digit season string (default: current season)
 *   mode    — 'rosters' | 'games' | 'both' (default: 'rosters')
 *   days    — how many days back to scan for finished boxscores (default 3)
 *   limit   — optional cap on teams imported (smoke testing)
 *
 * Auth: bearer CRON_SECRET (matches /api/cron/daily-all-sports pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  backfillLastN as backfillNhl,
  importAllTeamRosters as importNhlRosters,
  type ImportOptions,
} from '@/lib/importers/nhl-importer';

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
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  // NHL seasons start in October. Before October we want the 'previous' season.
  const startYear = month >= 10 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${startYear}${startYear + 1}`;
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
  const teamAbbrevs =
    teamsParam && teamsParam.trim().length > 0
      ? teamsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : undefined;

  const options: ImportOptions = {};
  if (limit) options.limit_teams = limit;
  if (teamAbbrevs && teamAbbrevs.length > 0) options.team_abbrevs = teamAbbrevs;

  const startedAt = new Date();
  const payload: Record<string, unknown> = {
    season,
    mode,
    started_at: startedAt.toISOString(),
  };

  try {
    if (mode === 'rosters' || mode === 'both') {
      payload.rosters = await importNhlRosters(season, options);
    }
    if (mode === 'games' || mode === 'both') {
      payload.games = await backfillNhl(days);
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
