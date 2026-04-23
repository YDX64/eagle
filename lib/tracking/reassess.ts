/**
 * Re-evaluate every settled pick using the corrected cross-sport label parser.
 * Flips `picks.hit` where the new result disagrees with the stored one.
 *
 * Focuses on non-football totals (OVER_XX / UNDER_XX) where the legacy
 * settler used football taxonomy (threshold 2.5) against a basketball
 * game (total ~220) and wrongly flagged everything as hit.
 */

import { trackingPrisma as prisma } from '@/lib/db';

export interface ReassessResult {
  scanned: number;
  flipped_to_hit: number;
  flipped_to_miss: number;
  unchanged: number;
  by_sport: Record<string, { scanned: number; flipped_to_hit: number; flipped_to_miss: number }>;
}

function parseLabelThreshold(label: string | null | undefined): { line: number; isOver: boolean } | null {
  if (!label) return null;
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*(Üst|Alt|Over|Under)/i);
  if (!m) return null;
  const line = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(line)) return null;
  return { line, isOver: /Üst|Over/i.test(m[2]) };
}

/**
 * Fix picks whose `hit` was determined by the buggy football taxonomy.
 *
 * Scope: picks where market matches OVER_XX / UNDER_XX style codes AND
 * the prediction's sport is not football AND the parent prediction has
 * an actual score.
 */
export async function reassessCrossSportTotals(args: { dryRun?: boolean } = {}): Promise<ReassessResult> {
  if (!prisma) throw new Error('tracking DB not configured');
  const dryRun = args.dryRun ?? false;

  const result: ReassessResult = {
    scanned: 0,
    flipped_to_hit: 0,
    flipped_to_miss: 0,
    unchanged: 0,
    by_sport: {},
  };

  const picks = await prisma.picks.findMany({
    where: {
      hit: { not: null },
      market: { contains: '_' }, // any market with line suffix
      predictions: {
        sport: { not: 'football' },
        actual_home: { not: null },
        actual_away: { not: null },
      },
    },
    select: {
      id: true,
      market: true,
      pick_label: true,
      hit: true,
      predictions: {
        select: { sport: true, fixture_id: true, actual_home: true, actual_away: true },
      },
    },
    take: 50000,
  });

  for (const pk of picks) {
    if (!/^(OVER|UNDER|HO_OVER|HO_UNDER|BB_OVER|BB_UNDER|HB_OVER|HB_UNDER|VB_TOTAL_SETS_OVER|VB_TOTAL_SETS_UNDER|BS_OVER|BS_UNDER)_\d+$/i.test(pk.market)) {
      continue;
    }
    const parsed = parseLabelThreshold(pk.pick_label);
    if (!parsed) continue;
    const total = (pk.predictions.actual_home ?? 0) + (pk.predictions.actual_away ?? 0);
    const newHit = parsed.isOver ? total > parsed.line : total < parsed.line;

    result.scanned++;
    const sport = pk.predictions.sport;
    const sportStats = result.by_sport[sport] ?? { scanned: 0, flipped_to_hit: 0, flipped_to_miss: 0 };
    sportStats.scanned++;

    if (newHit !== pk.hit) {
      if (newHit) {
        result.flipped_to_hit++;
        sportStats.flipped_to_hit++;
      } else {
        result.flipped_to_miss++;
        sportStats.flipped_to_miss++;
      }
      if (!dryRun) {
        await prisma.picks.update({
          where: { id: pk.id },
          data: { hit: newHit },
        });
      }
    } else {
      result.unchanged++;
    }
    result.by_sport[sport] = sportStats;
  }

  // Also re-evaluate predictions.best_pick_hit where the best pick's hit changed
  if (!dryRun) {
    await prisma.$queryRawUnsafe(`
      UPDATE predictions p
      SET best_pick_hit = pk.hit
      FROM picks pk
      WHERE pk.prediction_id = p.id
        AND pk.is_best = true
        AND p.status = 'resolved'
        AND pk.hit IS NOT NULL
        AND (p.best_pick_hit IS DISTINCT FROM pk.hit)
    `);
  }

  return result;
}
