# Cross-Sport Tracking — Deployment Notes

Commit: **1885936** (`feat: cross-sport prediction tracking system with market-level analytics`)

## What shipped

- **212 market codes** across football/basketball/hockey/handball/volleyball/baseball seeded into `probet.market_taxonomy`.
- **New DB tables in probet:** `sport_games`, `odds_snapshots_v2`, `player_prop_picks`, `prediction_runs`, `market_taxonomy` (plus extended `predictions` relations). Legacy tables untouched.
- **Fully working dashboard** at `/tracking` with sub-pages: `/performance`, `/leaderboard`, `/value-bets`, `/player-props`, `/odds-movement`.
- **Backend services** (`lib/tracking/*`) that normalize every engine's output, persist to `predictions`+`picks`+`system_bets`+`pattern_matches`+`player_prop_picks`, settle against real results, snapshot odds, and compute cross-sport analytics.
- **Baseball engine** (`lib/sports/baseball/`) with MLB/NPB/KBO/CPBL/Cuban/LMB support.
- **Player props engine** (`lib/sports/player-props/`) with live NBA basketball data; hockey/baseball gracefully return empty until player data source is added.
- **Cron endpoints** `/api/cron/daily-all-sports` and `/api/cron/settle-finished` gated by `CRON_SECRET`.

## Production deployment checklist (AWAXX)

1. **Verify remote DB is migrated** — the schema is already in sync; no migration step needed. Confirm:
   ```bash
   ssh AWAXX "docker exec awa-postgres psql -U awauser -d probet -c '\\dt' | grep -E 'player_prop_picks|sport_games|market_taxonomy'"
   ```
   Expected: all three tables listed.

2. **Update probet-app to point at PostgreSQL.** The container currently uses `DATABASE_URL=file:/app/data/probet.db` (SQLite). Switch it to:
   ```
   DATABASE_URL=postgresql://awauser:<password>@awa-postgres:5432/probet
   ```
   (use container-network hostname `awa-postgres`, not internal IP, so Docker DNS resolves it).

3. **Pull + rebuild probet-app:**
   ```bash
   ssh AWAXX "cd /opt/probet && git pull origin main"
   ssh AWAXX "cd /opt/probet && docker compose up -d --build probet-app"
   ssh AWAXX "docker logs -f probet-app --tail 100"
   ```

4. **Smoke test** (after container is healthy):
   ```bash
   curl http://localhost:5051/api/tracking/markets | jq '.count'         # 212
   curl http://localhost:5051/api/tracking/kpis                          # KPIs
   curl -X POST http://localhost:5051/api/tracking/seed-markets         # idempotent
   ```

5. **Seed one day of predictions across all sports:**
   ```bash
   curl -X POST http://localhost:5051/api/tracking/generate-daily \
     -H 'content-type: application/json' \
     -d '{"sports":["football","basketball","hockey","handball","volleyball","baseball"],"max_per_sport":30,"snapshot_odds":true}'
   ```

6. **Wire up cron** — add two entries in `/etc/cron.d/probet-tracking`:
   ```
   15 */2 * * * root curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:5051/api/cron/daily-all-sports > /var/log/probet-daily.log 2>&1
   */30 * * * * root curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:5051/api/cron/settle-finished > /var/log/probet-settle.log 2>&1
   ```

## Open follow-ups (V2+)

- Hockey + baseball player-prop data source (currently returns empty `players[]`; engines are ready to consume per-player stats from a new DB loader or NHL/MLB StatsAPI client).
- Auth: `probet-app` currently has no user system. `lib/auth.ts` is an env-gated admin stub; wire up a full identity provider (or restore a `User` table) before opening the tracking panel to the public.
- Materialized view for `market_performance_by_sport` — can be added later for sub-second dashboard response when pick volume grows past a few million rows.

## How to recover

- **Roll back code:** `git revert 1885936 && git push` (repo is `YDX64/eagle` on GitHub).
- **Roll back DB:** `DROP TABLE` the 5 new tables + delete `pk` rows in `market_taxonomy`. The legacy tables are unchanged; no data loss in `predictions`/`picks`/`system_bets`/`pattern_matches`/`bb_*`.
- **Local dev:** `.env.local` is already pointed at `postgresql://awauser:...@localhost:5433/probet` via an SSH tunnel (`ssh -N -f -L 5433:10.0.1.11:5432 AWAXX`).
