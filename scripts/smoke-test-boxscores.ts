/**
 * Smoke test for NHL + MLB boxscore importers.
 * Fetches one known finished game for each league and writes per-game rows.
 */

import { importGameBoxscore as importNhlBox } from '@/lib/importers/nhl-importer';
import { importGameBoxscore as importMlbBox } from '@/lib/importers/mlb-importer';
import { trackingPrisma } from '@/lib/db';

async function main() {
  // Known-final NHL game (see curl verification earlier: 2025020057 Sabres @ Senators)
  console.log('=== NHL boxscore test ===');
  const nhl = await importNhlBox(2025020057);
  console.log(JSON.stringify(nhl, null, 2));
  if (trackingPrisma) {
    const rows = await trackingPrisma.ho_player_game_logs.count({
      where: { source: 'nhl', api_game_id: 2025020057 },
    });
    console.log(`Rows in ho_player_game_logs for this game: ${rows}`);
  }

  // Known-final MLB game (gamePk 746865)
  console.log('\n=== MLB boxscore test ===');
  const mlb = await importMlbBox(746865);
  console.log(JSON.stringify(mlb, null, 2));
  if (trackingPrisma) {
    const rows = await trackingPrisma.bs_player_game_logs.count({
      where: { source: 'mlb', api_game_id: 746865 },
    });
    console.log(`Rows in bs_player_game_logs for this game: ${rows}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
