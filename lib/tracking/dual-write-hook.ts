/**
 * Dual-Write Hook: Mirror legacy SQLite predictions into the tracking PostgreSQL DB.
 *
 * This module provides a single, additive bridging function that legacy prediction
 * engines call AFTER their existing SQLite persist. It writes a compact row into
 * the `predictions` + `picks` tables of the tracking DB so the /tracking dashboard
 * can see every prediction produced by the legacy engines.
 *
 * Design rules:
 *   - Legacy SQLite flow is UNTOUCHED. This function is called in addition to
 *     (never instead of) the existing `prisma.prediction.*` call.
 *   - All errors are swallowed and logged with `console.warn`. The legacy engine
 *     must NEVER see an exception from this hook.
 *   - Silently no-ops when `isTrackingEnabled()` is false (no TRACKING_DATABASE_URL
 *     or the tracking client failed to load).
 *   - Idempotent: uses `predictions.upsert` keyed on `{sport}:{fixture_id}` and
 *     replaces `picks` atomically via `$transaction`.
 *
 * Usage:
 *   await mirrorToTracking({
 *     sport: 'football',
 *     fixture_id: 12345,
 *     home_team: 'A',
 *     away_team: 'B',
 *     match_date: new Date(),
 *     picks: [...],
 *   }).catch(() => {});
 */

import { trackingPrisma, isTrackingEnabled } from '@/lib/db';

/** A single market pick mirrored into `picks`. */
export interface MirrorPick {
  /** Canonical market code (e.g. "HOME_WIN", "OVER_25", "BTTS_YES"). Required. */
  market: string;
  market_label?: string;
  pick_label?: string;
  category?: string;
  /** Model probability in 0..1 range. */
  probability?: number;
  /** Bookmaker decimal odds if known. */
  market_odds?: number;
  /** Expected value = probability * odds - 1 (optional; caller pre-computes). */
  expected_value?: number;
  /** Best pick flag — exactly one pick across the list should be `true`. */
  is_best?: boolean;
  /** High-confidence flag (tier-agnostic — engine decides what qualifies). */
  is_high_confidence?: boolean;
  /** For CORRECT_SCORE / HTFT encode the concrete score in this field. */
  score_value?: string;
}

/** Input shape for the mirror call. Intentionally simpler than NormalizedPrediction. */
export interface MirrorArgs {
  /** Sport code: football, basketball, nba, hockey, handball, volleyball, baseball, ... */
  sport: string;
  /** Upstream fixture / game id — paired with `sport` to form the row id. */
  fixture_id: number;
  home_team: string;
  away_team: string;
  league?: string;
  match_date: Date | string;
  /** Optional winner probabilities in 0..1 range. */
  home_win_prob?: number;
  draw_prob?: number;
  away_win_prob?: number;
  /** Overall match confidence in 0..1 range. */
  confidence?: number;
  /** Best-pick denormalized summary columns on `predictions`. */
  best_market?: string;
  best_pick_label?: string;
  best_probability?: number;
  best_market_odds?: number;
  best_expected_value?: number;
  /** Full pick list. Writes to `picks` table; previous picks for the same
   *  prediction_id are deleted first so re-runs do not duplicate. */
  picks: MirrorPick[];
  /** Free-form JSON blob persisted on `predictions.payload` (engine metadata). */
  payload?: Record<string, unknown>;
}

/** Build the `{sport}:{fixture_id}` composite id used as `predictions.id`. */
function buildId(sport: string, fixture_id: number): string {
  return `${sport}:${fixture_id}`;
}

/** Safely coerce a match date (string ISO, Date, or missing) to Date | null. */
function coerceMatchDate(input: Date | string | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input : null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Clamp a probability to the 0..1 range. If it looks like a percentage (>1.5)
 * it's divided by 100 first — legacy engines emit both formats.
 */
function normalizeProb(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const scaled = v > 1.5 ? v / 100 : v;
  if (scaled < 0) return 0;
  if (scaled > 1) return 1;
  return scaled;
}

/**
 * Mirror a legacy prediction into the tracking PostgreSQL DB.
 *
 * Non-throwing: catches every error internally and logs to `console.warn`.
 * Returns quickly (as a resolved Promise<void>) even if tracking is disabled.
 */
export async function mirrorToTracking(args: MirrorArgs): Promise<void> {
  if (!isTrackingEnabled() || !trackingPrisma) {
    return;
  }

  try {
    const id = buildId(args.sport, args.fixture_id);
    const matchDate = coerceMatchDate(args.match_date);
    const homeProb = normalizeProb(args.home_win_prob);
    const drawProb = normalizeProb(args.draw_prob);
    const awayProb = normalizeProb(args.away_win_prob);
    const confidence = normalizeProb(args.confidence);

    // Pick-level payload shared by upsert + createMany.
    const pickRows = (args.picks ?? []).map((p) => ({
      prediction_id: id,
      market: p.market,
      market_label: p.market_label ?? null,
      pick_label: p.pick_label ?? null,
      category: p.category ?? null,
      probability: normalizeProb(p.probability),
      market_odds: p.market_odds ?? null,
      expected_value: p.expected_value ?? null,
      is_best: p.is_best ?? false,
      is_high_confidence: p.is_high_confidence ?? false,
      score_value: p.score_value ?? null,
    }));

    const basePredictionPayload = {
      sport: args.sport,
      fixture_id: args.fixture_id,
      home_team: args.home_team ?? null,
      away_team: args.away_team ?? null,
      league: args.league ?? null,
      match_date: matchDate,
      home_win_prob: homeProb,
      draw_prob: drawProb,
      away_win_prob: awayProb,
      confidence,
      best_market: args.best_market ?? null,
      best_pick_label: args.best_pick_label ?? null,
      best_probability: normalizeProb(args.best_probability),
      best_market_odds: args.best_market_odds ?? null,
      best_expected_value: args.best_expected_value ?? null,
      payload: (args.payload ?? null) as unknown as object,
    };

    // Use a single transaction so predictions + picks stay consistent.
    await trackingPrisma.$transaction(async (tx: any) => {
      await tx.predictions.upsert({
        where: { id },
        create: {
          id,
          status: 'pending',
          ...basePredictionPayload,
        },
        update: basePredictionPayload,
      });

      // Replace picks atomically.
      await tx.picks.deleteMany({ where: { prediction_id: id } });
      if (pickRows.length > 0) {
        await tx.picks.createMany({ data: pickRows });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[tracking] mirror failed:', msg);
  }
}
