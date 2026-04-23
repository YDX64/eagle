/**
 * GET /api/player-props/:sport/:gameId
 *
 * Returns the full PlayerPropPredictionResult for a basketball / hockey /
 * baseball game.
 *
 * Query parameters:
 *   persist=true   → also writes the predictions through to `player_prop_picks`
 *                    via the tracking persister.
 *   force=true     → bypass the 15-minute CacheService layer (useful during
 *                    tuning; production cron should not use this flag).
 *   minTier=gold|platinum|silver  → filter response to only include lines at
 *                    or above the requested confidence tier.
 */

import { NextRequest, NextResponse } from 'next/server';

import { CacheService } from '@/lib/cache';
import { persistPrediction } from '@/lib/tracking/prediction-persister';
import {
  generatePlayerProps,
  normalizeToPredictionShape,
  sportSlugToCode,
  type PlayerPropSportSlug,
} from '@/lib/sports/player-props/engine';
import type {
  PlayerPropLine,
  PlayerPropPredictionResult,
} from '@/lib/sports/player-props/types';
import { CONFIDENCE_THRESHOLDS } from '@/lib/sports/player-props/types';
import type { ConfidenceTier } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

// 15 minutes — balances freshness against rate limits on api-sports /players.
const CACHE_TTL_SECONDS = 900;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sport: string; gameId: string }> },
) {
  try {
    const { sport: rawSport, gameId: rawGameId } = await params;
    const sportSlug = sportSlugToCode(rawSport);
    if (!sportSlug) {
      return NextResponse.json(
        { success: false, error: 'Unsupported sport', sport: rawSport },
        { status: 400 },
      );
    }

    const gameId = Number.parseInt(rawGameId, 10);
    if (!Number.isFinite(gameId) || gameId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid game ID', gameId: rawGameId },
        { status: 400 },
      );
    }

    const qs = request.nextUrl.searchParams;
    const persist = qs.get('persist') === 'true';
    const force = qs.get('force') === 'true';
    const minTier = qs.get('minTier')?.toLowerCase() as ConfidenceTier | null;

    const result = await resolvePrediction(sportSlug, gameId, force);

    const filtered = minTier ? filterByTier(result, minTier) : result;

    let persisted_as: string | null = null;
    if (persist) {
      try {
        const normalized = normalizeToPredictionShape(result);
        const r = await persistPrediction(normalized);
        persisted_as = r.prediction_id;
      } catch (err) {
        // Don't fail the whole request if persistence trips — return the result
        // and include the persistence error for the caller to act on.
        return NextResponse.json({
          success: true,
          sport: sportSlug,
          data: filtered,
          persistence: {
            persisted: false,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      sport: sportSlug,
      data: filtered,
      persistence: persist
        ? { persisted: true, prediction_id: persisted_as }
        : { persisted: false },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate player props',
        message,
      },
      { status: 500 },
    );
  }
}

async function resolvePrediction(
  sport: PlayerPropSportSlug,
  gameId: number,
  force: boolean,
): Promise<PlayerPropPredictionResult> {
  const cacheKey = CacheService.generateApiKey(`player_props_${sport}`, { gameId });
  if (force) {
    const fresh = await generatePlayerProps(sport, gameId);
    await CacheService.set(cacheKey, fresh, CACHE_TTL_SECONDS);
    return fresh;
  }
  return CacheService.cacheApiResponse(
    cacheKey,
    () => generatePlayerProps(sport, gameId),
    CACHE_TTL_SECONDS,
  );
}

/**
 * Narrow a full prediction result to only lines at/above a confidence tier.
 * Everything else on the result is preserved (game meta, high_confidence list
 * stays consistent — it's derived from `players`).
 */
function filterByTier(
  result: PlayerPropPredictionResult,
  tier: ConfidenceTier,
): PlayerPropPredictionResult {
  const threshold =
    tier === 'platinum'
      ? CONFIDENCE_THRESHOLDS.platinum
      : tier === 'gold'
        ? CONFIDENCE_THRESHOLDS.gold
        : CONFIDENCE_THRESHOLDS.silver;
  const keep = (l: PlayerPropLine) => l.confidence >= threshold;
  return {
    ...result,
    players: result.players.filter(keep),
    high_confidence: result.high_confidence.filter(keep),
  };
}
