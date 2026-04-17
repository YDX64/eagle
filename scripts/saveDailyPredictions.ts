import 'dotenv/config';
import { syncPredictionsForDate } from '../lib/services/prediction-sync';

async function main() {
  const args = process.argv.slice(2);
  let date = new Date().toISOString().slice(0, 10);
  let limit: number | undefined;
  let force = false;

  for (const arg of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      date = arg;
    } else if (arg.startsWith('--limit=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (!Number.isNaN(value)) {
        limit = value;
      }
    } else if (arg === '--force') {
      force = true;
    }
  }

  const summary = await syncPredictionsForDate({
    date,
    limit,
    force,
    skipIfFreshMinutes: force ? 0 : 60,
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('Failed to save predictions:', error);
  process.exitCode = 1;
});
