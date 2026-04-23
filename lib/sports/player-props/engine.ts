/**
 * Unified player-prop engine entry point.
 *
 * Exposes:
 *   - generatePlayerProps(sport, game_id): dispatches to the correct
 *     sport-specific generator and returns a PlayerPropPredictionResult.
 *   - toNormalizedPlayerProps(result): converts a prediction result to the
 *     `NormalizedPlayerProp[]` shape the tracking layer persists.
 *   - normalizeToPredictionShape(result): convenience that wraps a
 *     player-prop result inside a NormalizedPrediction skeleton so the
 *     existing prediction-persister can consume it directly.
 */

import type { NormalizedPlayerProp, NormalizedPrediction, SportCode } from '@/lib/tracking/types';
import { generateBasketballProps } from './basketball-props';
import { generateHockeyProps } from './hockey-props';
import { generateBaseballProps } from './baseball-props';
import type { PlayerPropLine, PlayerPropPredictionResult, PlayerPropSport } from './types';

/** Public sport label accepted on the wire (`/api/player-props/basketball/...`). */
export type PlayerPropSportSlug = 'basketball' | 'hockey' | 'baseball';

/** Convert an HTTP slug to the internal sport code. */
export function sportSlugToCode(slug: string): PlayerPropSportSlug | null {
  const s = slug.toLowerCase();
  if (s === 'basketball' || s === 'nba' || s === 'bb') return 'basketball';
  if (s === 'hockey' || s === 'nhl' || s === 'ho') return 'hockey';
  if (s === 'baseball' || s === 'mlb' || s === 'bs') return 'baseball';
  return null;
}

/**
 * Unified entry point.
 *
 * @throws if the sport slug isn't supported or if the game cannot be fetched
 *         from the corresponding api-sports endpoint.
 */
export async function generatePlayerProps(
  sport: PlayerPropSportSlug,
  game_id: number,
): Promise<PlayerPropPredictionResult> {
  switch (sport) {
    case 'basketball':
      return generateBasketballProps(game_id);
    case 'hockey':
      return generateHockeyProps(game_id);
    case 'baseball':
      return generateBaseballProps(game_id);
    default: {
      const _never: never = sport;
      throw new Error(`Desteklenmeyen spor: ${_never}`);
    }
  }
}

/**
 * Convert a PlayerPropLine[] into NormalizedPlayerProp[] for persistence.
 * The market code is already canonical; the label and reasoning travel
 * through unchanged.
 */
export function toNormalizedPlayerProps(result: PlayerPropPredictionResult): NormalizedPlayerProp[] {
  return result.players.map(line => lineToNormalized(line));
}

function lineToNormalized(line: PlayerPropLine): NormalizedPlayerProp {
  return {
    player_id: line.player_id,
    player_name: line.player_name,
    team_id: line.team_id,
    team_name: line.team_name,
    position: line.position ?? undefined,
    market: line.market_code,
    market_label: line.market_label,
    line: line.line,
    selection: line.selection,
    pick_label: line.recommendation,
    probability: line.confidence,
    market_odds: line.selection === 'OVER' ? line.over_odds : line.under_odds,
    expected_value: undefined,
    is_high_confidence: line.confidence_tier === 'platinum' || line.confidence_tier === 'gold',
    is_best: false,
    category: 'player',
    confidence_tier: line.confidence_tier,
    reasoning: line.reasoning,
    factors_used: line.factors as unknown as Record<string, unknown>,
  };
}

/**
 * Wrap a PlayerPropPredictionResult inside a NormalizedPrediction object so it
 * can be fed through `persistPrediction` / `persistPredictionBatch` without
 * writing anything to the picks table (picks is empty — player props only).
 */
export function normalizeToPredictionShape(
  result: PlayerPropPredictionResult,
): NormalizedPrediction {
  const sport: SportCode =
    result.sport === 'basketball'
      ? 'basketball'
      : result.sport === 'hockey'
        ? 'hockey'
        : 'baseball';

  // Pick the highest-confidence line per player for the "best" slot.
  const best = [...result.players]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 1)[0];
  const normalizedProps = toNormalizedPlayerProps(result);
  if (best) {
    const idx = result.players.indexOf(best);
    if (idx >= 0 && normalizedProps[idx]) {
      normalizedProps[idx].is_best = true;
    }
  }

  return {
    sport,
    api_game_id: result.game_id,
    home_team: result.home_team,
    away_team: result.away_team,
    league: result.league_name ?? undefined,
    league_id: result.league_id ?? undefined,
    match_date: result.game_date,
    picks: [], // player-prop-only predictions — no game-level picks.
    player_props: normalizedProps,
    engine_name: 'player-props',
    engine_version: 'v1',
    raw_payload: {
      high_confidence_count: result.high_confidence.length,
      total_lines: result.players.length,
      season: result.season ?? null,
      generated_at: result.generated_at,
    } as Record<string, unknown>,
  };
}

/** Type re-exports — callers shouldn't need to reach into types.ts directly. */
export type { PlayerPropLine, PlayerPropPredictionResult, PlayerPropSport, NormalizedPlayerProp };
