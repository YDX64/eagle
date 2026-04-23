/**
 * POST /api/probet/resolve-results
 *
 * Scans tracking DB for pending predictions whose match date has passed,
 * fetches final scores from API-Football, and updates each prediction's
 * win/loss status. Safe to call manually or on a cron schedule.
 *
 * Query params:
 *   max        — hard cap on number of predictions to process (default 100)
 *   sport      — only resolve this sport (default: all)
 *
 * Returns counts and per-prediction summaries.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getPendingFinishedPredictions,
  resolvePrediction,
  type MatchOutcome,
} from '@/lib/probet/prediction-store';
import { ApiFootballService } from '@/lib/api-football';
import { basketballApi } from '@/lib/sports/basketball/api-basketball';
import { hockeyApi } from '@/lib/sports/hockey/api-hockey';
import { volleyballApi } from '@/lib/sports/volleyball/api-volleyball';
import { handballApi } from '@/lib/sports/handball/api-handball';

/**
 * Finished status codes per sport:
 *   football  — FT, AET, PEN
 *   basketball — FT, AOT (after overtime), AP (after penalty)
 *   hockey    — FT, AOT, AP
 *   volleyball — FT
 *   handball  — FT, AOT, AP
 */
const FINISHED_STATUSES: Record<string, Set<string>> = {
  football: new Set(['FT', 'AET', 'PEN']),
  basketball: new Set(['FT', 'AOT', 'AP']),
  hockey: new Set(['FT', 'AOT', 'AP', 'END']),
  volleyball: new Set(['FT']),
  handball: new Set(['FT', 'AOT', 'AP']),
};

/**
 * Fetch a sport-specific game/fixture and extract the final outcome.
 * Returns null if game not found or not yet finished.
 */
async function fetchOutcome(
  sport: string,
  fixtureId: number
): Promise<MatchOutcome | { skip: string } | null> {
  try {
    if (sport === 'football') {
      const fx = await ApiFootballService.getFixture(fixtureId);
      if (!fx) return { skip: 'fixture not found' };
      if (!FINISHED_STATUSES.football.has(fx.fixture.status.short)) {
        return { skip: `status ${fx.fixture.status.short} — not finished` };
      }
      const h = fx.goals.home;
      const a = fx.goals.away;
      if (h === null || a === null) return { skip: 'goals missing' };
      return {
        homeGoals: h,
        awayGoals: a,
        htHomeGoals: fx.score?.halftime?.home ?? null,
        htAwayGoals: fx.score?.halftime?.away ?? null,
      };
    }

    if (sport === 'basketball') {
      const game = await basketballApi.getGameById(fixtureId);
      if (!game) return { skip: 'game not found' };
      if (!FINISHED_STATUSES.basketball.has(game.status?.short || '')) {
        return { skip: `status ${game.status?.short} — not finished` };
      }
      const h = game.scores?.home?.total ?? null;
      const a = game.scores?.away?.total ?? null;
      if (h === null || a === null) return { skip: 'scores missing' };
      return { homeGoals: h, awayGoals: a };
    }

    if (sport === 'hockey') {
      const game = await hockeyApi.getGameById(fixtureId);
      if (!game) return { skip: 'game not found' };
      if (!FINISHED_STATUSES.hockey.has(game.status?.short || '')) {
        return { skip: `status ${game.status?.short} — not finished` };
      }
      // Hockey scores structure: { home: { period_1, period_2, period_3, total }, away: {...} }
      const hScores = (game.scores as any)?.home;
      const aScores = (game.scores as any)?.away;
      const h = typeof hScores === 'number' ? hScores : hScores?.total ?? null;
      const a = typeof aScores === 'number' ? aScores : aScores?.total ?? null;
      if (h === null || a === null) return { skip: 'scores missing' };
      return { homeGoals: h, awayGoals: a };
    }

    if (sport === 'volleyball') {
      const game = await volleyballApi.getGameById(fixtureId);
      if (!game) return { skip: 'game not found' };
      if (!FINISHED_STATUSES.volleyball.has(game.status?.short || '')) {
        return { skip: `status ${game.status?.short} — not finished` };
      }
      const h = game.scores?.home ?? null;
      const a = game.scores?.away ?? null;
      if (h === null || a === null) return { skip: 'scores missing' };
      return { homeGoals: h, awayGoals: a };
    }

    if (sport === 'handball') {
      const game = await handballApi.getGameById(fixtureId);
      if (!game) return { skip: 'game not found' };
      if (!FINISHED_STATUSES.handball.has(game.status?.short || '')) {
        return { skip: `status ${game.status?.short} — not finished` };
      }
      const h = game.scores?.home ?? null;
      const a = game.scores?.away ?? null;
      if (h === null || a === null) return { skip: 'scores missing' };
      return { homeGoals: h, awayGoals: a };
    }

    return { skip: `unknown sport ${sport}` };
  } catch (err) {
    return { skip: err instanceof Error ? err.message : 'fetch failed' };
  }
}

interface ResolveResult {
  predictionId: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  actualScore?: string;
  status: 'resolved' | 'skipped' | 'error';
  reason?: string;
  picksHit?: number;
  picksResolved?: number;
  bestPickHit?: boolean | null;
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const maxParam = parseInt(url.searchParams.get('max') || '100', 10);
  const sportFilter = url.searchParams.get('sport');
  const max = Math.min(500, Math.max(1, maxParam));

  try {
    const pending = await getPendingFinishedPredictions();
    const filtered = sportFilter
      ? pending.filter((p) => p.sport === sportFilter)
      : pending;
    const toProcess = filtered.slice(0, max);

    const results: ResolveResult[] = [];
    let resolvedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process serially to be gentle on rate-limited sport APIs.
    for (const p of toProcess) {
      try {
        const outcomeOrSkip = await fetchOutcome(p.sport, p.fixtureId);
        if (outcomeOrSkip === null || 'skip' in outcomeOrSkip) {
          results.push({
            predictionId: p.id,
            fixtureId: p.fixtureId,
            homeTeam: p.homeTeam,
            awayTeam: p.awayTeam,
            status: 'skipped',
            reason: outcomeOrSkip && 'skip' in outcomeOrSkip ? outcomeOrSkip.skip : 'unknown',
          });
          skippedCount++;
          continue;
        }

        const res = await resolvePrediction(p.id, outcomeOrSkip);
        results.push({
          predictionId: p.id,
          fixtureId: p.fixtureId,
          homeTeam: p.homeTeam,
          awayTeam: p.awayTeam,
          actualScore: `${outcomeOrSkip.homeGoals}-${outcomeOrSkip.awayGoals}`,
          status: 'resolved',
          picksHit: res.picksHit,
          picksResolved: res.picksResolved,
          bestPickHit: res.bestPickHit,
        });
        resolvedCount++;
      } catch (err) {
        results.push({
          predictionId: p.id,
          fixtureId: p.fixtureId,
          homeTeam: p.homeTeam,
          awayTeam: p.awayTeam,
          status: 'error',
          reason: err instanceof Error ? err.message : String(err),
        });
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        scanned: pending.length,
        processed: toProcess.length,
        resolved: resolvedCount,
        skipped: skippedCount,
        errors: errorCount,
        results,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

// Also expose GET for browser debugging
export async function GET(request: NextRequest) {
  return POST(request);
}
