/**
 * Smoke test for the dual-write hook.
 * Invokes mirrorToTracking() directly so we can prove the tracking-DB side
 * works. Then queries the tracking DB back to confirm the row was written.
 *
 * Usage:
 *   TRACKING_DATABASE_URL=... DATABASE_URL=file:./prisma/dev.db \
 *     npx tsx --require dotenv/config scripts/smoke-dual-write.ts
 */
process.env.DATABASE_URL ||= 'file:./prisma/dev.db';

import { mirrorToTracking } from '@/lib/tracking/dual-write-hook';
import { trackingPrisma, isTrackingEnabled } from '@/lib/db';

async function main() {
  console.log('tracking enabled:', isTrackingEnabled());
  console.log('tracking url prefix:', (process.env.TRACKING_DATABASE_URL ?? '').slice(0, 40));
  if (!isTrackingEnabled()) {
    console.error('TRACKING_DATABASE_URL missing. Aborting smoke.');
    process.exit(1);
  }

  const FIXTURE_ID = 999999001;
  const SPORT = 'football';
  const id = `${SPORT}:${FIXTURE_ID}`;

  await mirrorToTracking({
    sport: SPORT,
    fixture_id: FIXTURE_ID,
    home_team: 'Smoke Home FC',
    away_team: 'Smoke Away FC',
    league: 'Smoke League',
    match_date: new Date(),
    home_win_prob: 0.52,
    draw_prob: 0.25,
    away_win_prob: 0.23,
    confidence: 0.52,
    best_market: 'HOME_WIN',
    best_pick_label: 'MS 1',
    best_probability: 0.52,
    picks: [
      { market: 'HOME_WIN', market_label: 'MS 1', probability: 0.52, is_best: true, category: 'MAÇ_SONUCU' },
      { market: 'DRAW', market_label: 'MS X', probability: 0.25, category: 'MAÇ_SONUCU' },
      { market: 'AWAY_WIN', market_label: 'MS 2', probability: 0.23, category: 'MAÇ_SONUCU' },
    ],
    payload: { engine: 'smoke-test' },
  });

  const row = await trackingPrisma.predictions.findUnique({
    where: { id },
    include: { picks: true },
  });

  if (!row) {
    console.error('SMOKE FAIL: row not found after mirror');
    process.exit(2);
  }

  console.log('SMOKE OK:');
  console.log('  id:', row.id);
  console.log('  sport:', row.sport, 'fixture_id:', row.fixture_id);
  console.log('  home_team:', row.home_team, 'away_team:', row.away_team);
  console.log('  best_market:', row.best_market, 'best_probability:', row.best_probability);
  console.log('  picks:', row.picks.length);
  for (const p of row.picks) {
    console.log(`    - ${p.market} prob=${p.probability} is_best=${p.is_best}`);
  }

  await trackingPrisma.picks.deleteMany({ where: { prediction_id: id } });
  await trackingPrisma.predictions.delete({ where: { id } });
  await trackingPrisma.$disconnect();
  console.log('cleanup complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE EXCEPTION:', err);
  process.exit(3);
});
