/**
 * Smoke test for the NHL + MLB importers.
 * Invokes each with a 1-team limit and prints the result. Writes real rows to
 * `ho_player_season_averages` and `bs_player_season_averages`.
 *
 * Usage:
 *   TRACKING_DATABASE_URL=postgresql://... \
 *     DATABASE_URL=file:./prisma/dev.db \
 *     npx tsx --require dotenv/config scripts/smoke-test-importers.ts
 */

import { importAllTeamRosters as importNhl } from '@/lib/importers/nhl-importer';
import { importAllTeamRosters as importMlb } from '@/lib/importers/mlb-importer';
import { trackingPrisma } from '@/lib/db';

async function main() {
  console.log('=== NHL roster import (1 team) ===');
  const nhl = await importNhl('20242025', { limit_teams: 1 });
  console.log(JSON.stringify(nhl, null, 2));

  if (trackingPrisma) {
    const nhlCount = await trackingPrisma.ho_player_season_averages.count({
      where: { source: 'nhl', season: '20242025' },
    });
    console.log(`NHL rows in DB (source=nhl,season=20242025): ${nhlCount}`);
  }

  console.log('\n=== MLB roster import (1 team) ===');
  const mlb = await importMlb('2024', { limit_teams: 1 });
  console.log(JSON.stringify(mlb, null, 2));

  if (trackingPrisma) {
    const mlbCount = await trackingPrisma.bs_player_season_averages.count({
      where: { source: 'mlb', season: '2024' },
    });
    console.log(`MLB rows in DB (source=mlb,season=2024): ${mlbCount}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
