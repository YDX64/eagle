#!/usr/bin/env tsx
/**
 * One-shot script to seed the `market_taxonomy` table.
 * Run:  DATABASE_URL=... tsx scripts/seed-markets.ts
 */
import { seedMarketTaxonomy } from '../lib/tracking/market-taxonomy';

async function main() {
  const res = await seedMarketTaxonomy();
  console.log(`Seeded ${res.inserted} new markets, updated ${res.updated}.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
