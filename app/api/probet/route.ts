/**
 * ProBet API Route
 *
 * GET /api/probet?date=YYYY-MM-DD&limit=20
 *   - Fetches fixtures for the given date (default: today)
 *   - Runs each fixture through the ProBet pipeline (Poisson+xG + Gradient Boost Ensemble)
 *   - Returns predictions sorted by confidence (descending)
 *
 * GET /api/probet?fixtureId=XXXX
 *   - Predicts a single fixture
 *
 * Response is cached for 30 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService, MAJOR_LEAGUES } from '@/lib/api-football';
import { CacheService } from '@/lib/cache';
import {
  predictFixture,
  predictFixtures,
  isPrediction,
  type ProBetPrediction,
  type PredictionFailure,
} from '@/lib/probet/probet-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — model training can take a while

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fixtureIdStr = searchParams.get('fixtureId');
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const onlyMajorLeagues = searchParams.get('majorLeagues') !== 'false';

    // Single fixture mode
    if (fixtureIdStr) {
      const fixtureId = parseInt(fixtureIdStr, 10);
      if (isNaN(fixtureId)) {
        return NextResponse.json(
          { success: false, error: 'Geçersiz fixture ID' },
          { status: 400 }
        );
      }

      const cacheKey = CacheService.generateApiKey('probet_single', { fixtureId });
      const result = await CacheService.cacheApiResponse(
        cacheKey,
        async () => {
          const fixture = await ApiFootballService.getFixture(fixtureId);
          if (!fixture) {
            return { error: 'Maç bulunamadı' };
          }
          const prediction = await predictFixture(fixture);
          return { prediction };
        },
        CacheService.TTL.PREDICTIONS
      );

      if ('error' in result) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, data: result });
    }

    // Bulk mode — predict all matches for a date
    const cacheKey = CacheService.generateApiKey('probet_bulk', { date, limit, onlyMajorLeagues });
    const result = await CacheService.cacheApiResponse(
      cacheKey,
      async () => {
        const allFixtures = await ApiFootballService.getFixturesByDate(date);

        // Filter to upcoming matches only (NS = Not Started, TBD = To Be Defined)
        let upcoming = allFixtures.filter(
          (f) => ['NS', 'TBD', '1H', '2H', 'HT'].includes(f.fixture.status.short)
        );

        // Optionally restrict to major leagues for speed
        if (onlyMajorLeagues) {
          const majorIds = Object.values(MAJOR_LEAGUES) as number[];
          upcoming = upcoming.filter((f) => majorIds.includes(f.league.id));
        }

        // Sort by start time and cap to limit
        upcoming.sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
        const fixturesToPredict = upcoming.slice(0, limit);

        if (fixturesToPredict.length === 0) {
          return {
            predictions: [],
            failures: [],
            stats: {
              totalRequested: 0,
              successCount: 0,
              failureCount: 0,
              date,
            },
          };
        }

        const results = await predictFixtures(fixturesToPredict, 2);

        const predictions: ProBetPrediction[] = [];
        const failures: PredictionFailure[] = [];
        for (const r of results) {
          if (isPrediction(r)) predictions.push(r);
          else failures.push(r);
        }

        // Sort predictions by confidence (descending)
        predictions.sort((a, b) => b.confidence - a.confidence);

        return {
          predictions,
          failures,
          stats: {
            totalRequested: fixturesToPredict.length,
            successCount: predictions.length,
            failureCount: failures.length,
            date,
          },
        };
      },
      CacheService.TTL.PREDICTIONS
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ProBet API] Error:', error);
    return NextResponse.json(
      { success: false, error: `ProBet hatası: ${message}` },
      { status: 500 }
    );
  }
}
