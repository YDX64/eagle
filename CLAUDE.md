# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🔒 Single-Folder Workflow (MANDATORY)

**All work happens in `/Users/max/Downloads/eagle-1` on the `main` branch.**

Rules that apply to every session:
- ❌ **Never create git worktrees** (`git worktree add ...`). If you feel the need to isolate work, use a branch inside this same clone instead.
- ❌ **Never switch to a different clone of this repo**. If you see nested directories like `.claude/worktrees/*`, they are leftovers — remove them, do not use them.
- ✅ **Always work from the `main` branch**. Create feature branches only for PRs; merge back into `main` quickly.
- ✅ **Push to `origin/main` only** (GitHub: `YDX64/awastats`). No other remotes.
- ✅ **Database is remote PostgreSQL** (`awa-postgres` on AWAXX). No local DB. Schema is `provider = "postgresql"`.
- ✅ **Production runs on AWAXX** (`/opt/probet`, container `probet-app`, port 5051, behind traefik at `pro.awastats.com`). Local repo is the source of truth for code; deployment pulls from `origin/main`.

If a previous session created worktrees, branches like `claude/*`, or nested dev directories, **consolidate into this folder and main branch first**, then continue the task. Never work around the mess.

## Football Prediction System

This is a real-money football betting prediction system ("Eagle") using AwaStats data. The system generates predictions using dual prediction engines, tracks high-confidence opportunities, and provides comprehensive backtesting with Turkish localization for betting recommendations.

## Development Commands

```bash
# Development
npm run dev          # Start development server on port 3000

# Build & Production
npm run build        # Build for production (run before deployment)
npm run start        # Start production server on port 3000

# Database Operations
npx prisma migrate dev          # Create and apply new migration
npx prisma db push              # Push schema changes without migration (dev only)
npx prisma generate             # Generate Prisma client after schema changes
npx prisma studio               # Open Prisma Studio GUI on port 5555
npx prisma migrate reset        # Reset database and reapply all migrations (WARNING: deletes data)
tsx --require dotenv/config scripts/seed.ts  # Seed database

# Scripts
npm run scripts:build           # Compile TypeScript scripts
npm run save:predictions        # Save daily predictions (after compiling scripts)

# Code Quality
npm run lint                    # Run ESLint with Prettier plugin

# API Testing
curl http://localhost:3000/api/matches/today              # Get today's matches
curl http://localhost:3000/api/predictions/{matchId}      # Generate prediction
curl http://localhost:3000/api/bulk-analysis/results      # Get bulk analysis results
curl http://localhost:3000/api/recommendations/high-confidence  # High-confidence tips
```

## Architecture Overview

### Dual Prediction Engine System

The system uses two complementary prediction engines:

1. **Basic Engine** (`lib/prediction-engine.ts`)
   - Team form analysis (last 5-10 matches)
   - Head-to-head historical data
   - League position impact
   - Home advantage calculation
   - Simple GoalFlux-based goal expectancy
   - First-half predictions

2. **Advanced Engine** (`lib/advanced-prediction-engine.ts`)
   - Extended statistics with fallback values
   - GoalFlux-based exact score probabilities
   - Asian Handicap calculations
   - Corner & cards predictions
   - Risk tier classification (Platinum/Gold/Silver)
   - Momentum analysis with decay factors
   - Beklenen Gol Skoru (BGS) calculations
   - Turkish betting recommendations (KG/Karşılıklı Gol, Üst/Alt 2.5)

### Core Services (`/lib`)

- **api-football.ts**: AwaStats integration with rate limiting and caching
- **prediction-engine.ts**: Basic prediction algorithm (see above)
- **advanced-prediction-engine.ts**: Advanced algorithm with risk analysis (see above)
- **backtest-engine.ts**: Historical performance validation
- **comprehensive-backtest.ts**: Extended backtesting with ROI metrics
- **cache.ts**: Dual caching (database + in-memory) with configurable TTL
- **db.ts**: Prisma client with SQLite path override (`file:./dev.db`)
- **services/prediction-sync.ts**: Orchestrates daily prediction generation and persistence

### API Routes (`/app/api`)

**Match & Prediction Endpoints:**
- `/matches/today`: All today's matches with live scores (no artificial limits)
- `/matches/[id]`: Single match details
- `/predictions/[matchId]`: Generate and save prediction for specific match
- `/predictions/batch-analyze-sqlite`: Batch analyze multiple matches

**Analysis & Recommendations:**
- `/bulk-analysis`: Bulk analysis with deterministic fallback when API unavailable
- `/bulk-analysis/results`: Retrieve stored bulk analysis results
- `/recommendations/high-confidence`: High-confidence betting opportunities

**Statistics:**
- `/statistics/leagues`: League-level statistics
- `/statistics/teams`: Team performance metrics
- `/statistics/predictions`: Prediction accuracy statistics

**Backtesting:**
- `/backtest/run`: Basic backtest analysis
- `/backtest/comprehensive`: Extended backtest with ROI

**Cron Jobs:**
- `/cron/daily-analysis`: Daily automated analysis run
- `/cron/hourly-analysis`: Hourly match updates

**Authentication:**
- `/auth/signin`, `/auth/signup`, `/auth/csrf`: User authentication endpoints

### Database Schema

SQLite database at `./prisma/dev.db` with comprehensive schema:

**Core Tables:**
- `matches`: Fixtures with scores, live updates, high-confidence flags
- `predictions`: Generated predictions with confidence tiers and factors
- `teams`, `leagues`: Reference data with relationships
- `standings`: League table data
- `match_statistics`: In-game stats (shots, possession, BGS, cards)
- `match_events`: Goals, cards, substitutions

**Analysis Tables:**
- `high_confidence_recommendations`: Platinum/Gold/Silver tier tips
- `match_confidence_summaries`: Overall match confidence assessment
- `bulk_analysis_results`: Comprehensive analysis with AwaStats alignment
  - Includes categorized data: `api_ms_*` (match stats), `api_form_*` (form data), `api_h2h_*` (head-to-head), `api_league_*` (standings)
  - Own analysis metrics: `own_an_*` (value, momentum, injuries, weather, referee, crowd)
  - Risk categories: `risk_*` (variance, liquidity, odds movement)
  - Performance: `perf_*` (historical accuracy, form weight, league adjustments)
  - Market data: `market_*` (odds, volume, smart money flow)
  - Algorithm alignment flags: `algorithms_agree_winner`, `algorithms_agree_over_under`

**Historical Tracking:**
- `backtest_results`: Historical performance with ROI metrics
- `prediction_statistics`: Aggregated performance by period/league/team
- `analysis_runs`: Tracking of automated analysis executions
- `head_to_head`: Pre-computed H2H statistics
- `team_statistics`: Aggregated team performance metrics

**Infrastructure:**
- `cache_entries`: Database-level caching with expiration

## Critical Implementation Details

### Database Path Configuration
The system may incorrectly create a nested database at `./prisma/prisma/dev.db`. Always ensure `lib/db.ts` uses:
```typescript
process.env.DATABASE_URL = "file:./dev.db";
```
After schema changes, always run `npx prisma generate` before starting the app.

### Real Data Requirement
- **NO mock data allowed** - this system handles real money betting
- All predictions MUST use actual AwaStats data
- Aggressive caching is required to avoid API rate limits
- The system includes deterministic fallback in `bulk-analysis` when API is unavailable

### Match Display Policy
- All matches must be displayed without artificial limits
- The 400-match cap has been removed from `/api/matches/today`
- Use pagination in UI when needed, but don't filter server-side

### High-Confidence System
The system identifies and tracks high-confidence betting opportunities:
- **Platinum Tier** (85%+): Ultra-high confidence, displayed first
- **Gold Tier** (75-84%): High confidence
- **Silver Tier** (65-74%): Good confidence
- Thresholds: BTTS >0.72 or <0.28, Over/Under 2.5 >0.68 or <0.32
- Turkish recommendations: "Karşılıklı Gol Var/Yok", "Üst 2.5", "Alt 2.5"

### Environment Variables
```bash
AWASTATS_API_KEY=<your-key>         # Required for AwaStats data service
DATABASE_URL=file:./prisma/dev.db   # SQLite database path
NODE_ENV=development                 # development or production
```

### Algorithm Weight Configuration

The advanced prediction engine uses configurable weights in `lib/advanced-prediction-engine.ts`:

```typescript
weights: {
  form: 0.30,      // Recent form impact
  home: 0.15,      // Home advantage
  league: 0.15,    // League position
  goals: 0.20,     // Goal scoring/conceding
  defense: 0.15,   // Defensive strength
  h2h: 0.05        // Head-to-head history
}
```

### Prediction Algorithm Factors

**Basic Engine:**
1. **Team Form**: Last 5-10 matches (wins/draws/losses, goals scored/conceded)
2. **Head-to-Head**: Historical matchups, minimum 3 matches required
3. **League Position**: Current standings with home/away splits
4. **Home Advantage**: Boost factor (default 0.07), calculated from H2H
5. **Goal Analysis**: GoalFlux-based BGS with `firstHalfFactor=0.43`

**Advanced Engine Additional Factors:**
6. **Momentum Analysis**: Weighted recent form with decay factor
7. **Beklenen Gol Skoru (BGS)**: GoalFlux distribution for exact scores (`maxGoals=5`)
8. **Asian Handicap**: Power differential-based handicap lines
9. **Corner & Cards**: Statistical predictions based on averages
10. **Risk Classification**: Multi-factor risk assessment for bet recommendations

## Cache TTL Settings

Configured in `lib/cache.ts` with dual-layer caching (database + in-memory):

- **FIXTURES_TODAY**: 5 minutes (live match data, needs frequent updates)
- **FIXTURES_PAST**: 24 hours (historical data, rarely changes)
- **LEAGUE_STANDINGS**: 1 hour (standings update after matches)
- **PREDICTIONS**: 30 minutes (balance between freshness and API calls)
- **TEAM_INFO**: 24 hours (static team data)
- **STATISTICS**: 1 hour (match statistics)
- **HEAD_TO_HEAD**: 6 hours (historical H2H data)

The `prediction-sync` service has `skipIfFreshMinutes` (default: 120) to avoid redundant analysis runs.

## Frontend Architecture

### Tech Stack
- **Framework**: Next.js 15 with App Router and React Server Components
- **UI Library**: Radix UI primitives + custom shadcn/ui components
- **Styling**: Tailwind CSS with custom design system and dark mode support
- **State Management**:
  - Zustand for global client state
  - TanStack Query (React Query) v5 for server state and caching
  - Jotai for atomic state management
- **Charts & Visualization**:
  - Chart.js with react-chartjs-2 for standard charts
  - Recharts for responsive charts
  - Plotly.js for advanced interactive visualizations
- **Forms**: React Hook Form with Yup/Zod validation
- **Authentication**: NextAuth.js v4 with Prisma adapter
- **Theming**: next-themes for dark/light mode persistence
- **UI Components**: Full shadcn/ui component library in `components/ui/`

### Key Pages & Features

**`/` (Homepage)**:
- Optimized match list with virtualization (`components/optimized-match-list-enhanced.tsx`)
- Real-time match updates with live scores
- High-confidence recommendations tabs (KG/BTTS, Üst 2.5/Over 2.5)

**`/bulk-analysis`**:
- Bulk analysis dashboard with DataTables integration
- Automatic high-confidence goal analysis
- CSV export functionality
- MUI-based analysis panels

**`/statistics`**:
- League, team, and prediction performance statistics
- Interactive charts and trend analysis
- Backtest result visualizations

**`/predictions`**:
- Individual match prediction views
- Detailed analysis with confidence breakdowns

**Performance Optimizations:**
- Lazy loading with `components/lazy-components.tsx`
- Intersection Observer for viewport-based rendering
- Client/Server component separation
- Error boundaries for graceful failure handling
- Optimized bundle splitting

## Database Migration Workflow

1. **Schema Changes**: Edit `schema.prisma`
2. **Generate Migration**: `npx prisma migrate dev --name descriptive_name`
3. **Generate Client**: `npx prisma generate` (runs automatically with migrate)
4. **Commit**: Commit both `schema.prisma` and `migrations/` folder
5. **Reset If Needed**: `npx prisma migrate reset` (WARNING: deletes all data)

**Important:**
- Indexes are optimized for: `league_id`, `team_id`, `date`, `confidence_tier`, `is_high_confidence`
- The schema supports complex joins across matches, teams, leagues, standings, predictions
- Use `@@index` for query optimization when adding new filters
- The `bulk_analysis_results` table has extensive categorized fields - maintain naming conventions

## API Rate Limiting Strategy

**AwaStats Service Limits:**
- Free tier: 100 requests/day
- Paid tiers: Higher limits but still require caching
- Service may return 503 if overused

**Mitigation:**
- Aggressive dual-layer caching (database + in-memory)
- Batch requests when possible (e.g., `prediction-sync` caches API calls across fixtures)
- Deterministic fallback in `bulk-analysis` when API unavailable
- Rate limit monitoring in `lib/api-football.ts`
- Exponential backoff on failures (not yet implemented - add if needed)

## Performance Optimization

**Database:**
- SQLite with optimized indexes for common query patterns
- Prepared statements via Prisma prevent SQL injection
- Use `.findMany()` with proper `where`, `orderBy`, `take`, `skip` for pagination
- Avoid N+1 queries - use `include` for relations

**API Responses:**
- Paginate large datasets (matches, predictions)
- Use streaming responses for large data exports
- Cache headers for client-side caching

**Background Jobs:**
- `prediction-sync` orchestrates daily predictions
- Cron jobs at `/api/cron/` run automated analysis
- Use `force` flag to override caching during testing

**Real-time Betting:**
- 5-minute cache for today's fixtures enables near-real-time updates
- High-confidence recommendations pre-computed and cached
- WebSocket support not implemented (could be added for live score streaming)

## Security Implementation

**API Keys:**
- Store in `.env.local`, never commit
- Server-side only (`lib/api-football.ts` uses server runtime)
- Validate presence on startup

**Authentication:**
- NextAuth.js with Prisma adapter
- CSRF protection enabled in `/api/auth/csrf`
- Password hashing with bcryptjs
- JWT tokens for session management

**Input Validation:**
- Zod schemas for API route validation (partially implemented)
- Prisma types for compile-time safety
- Sanitize user inputs before database queries

**Rate Limiting:**
- Not yet implemented - add middleware for production
- Consider `next-rate-limit` or Vercel Edge Config

## Turkish Localization

The system provides Turkish betting terminology:
- **Karşılıklı Gol (KG)**: Both Teams to Score (BTTS)
- **Üst 2.5**: Over 2.5 goals
- **Alt 2.5**: Under 2.5 goals
- **Ev Sahibi**: Home team
- **Deplasman**: Away team
- **Handikap**: Asian Handicap

Turkish strings are embedded in:
- `lib/advanced-prediction-engine.ts` (risk recommendations)
- UI components (match cards, prediction displays)
- Analysis reports and CSV exports

## Algorithm Tuning Reference

For detailed algorithm parameters and tuning, see `ALGORITHMS.md`:
- Weight configurations for prediction engines
- Risk tier thresholds
- GoalFlux distribution parameters
- Confidence calculation formulas
- Data flow diagrams

Key tunable parameters:
- `form: 0.30` in advanced engine weights
- `firstHalfFactor: 0.6` for first-half predictions
- `maxGoals: 5` for GoalFlux exact score calculations
- High confidence thresholds: >0.70 (BTTS), >0.68 (O/U 2.5)
- `skipIfFreshMinutes: 120` in prediction-sync

## Troubleshooting

### Common Issues

**1. 503 Service Unavailable / API Errors:**
- Verify `AWASTATS_API_KEY` in `.env.local`
- Check API quota in your AwaStats account
- Review cache logs - may be hitting rate limits
- Use deterministic fallback mode in bulk-analysis

**2. Database Locked Error:**
- Ensure only one Prisma client instance (singleton in `lib/db.ts`)
- Close Prisma Studio before running migrations
- SQLite doesn't support concurrent writes - avoid parallel database updates

**3. Database in Wrong Location:**
- Check `lib/db.ts` has `process.env.DATABASE_URL = "file:./dev.db"`
- Delete `./prisma/prisma/dev.db` if it exists
- Run `npx prisma migrate dev` to create database in correct location

**4. Port Conflicts (EADDRINUSE):**
```bash
lsof -ti:3000 | xargs kill -9  # Kill process on port 3000
npm run dev                     # Restart
```

**5. Migration Issues:**
- Reset: `npx prisma migrate reset` (deletes all data!)
- Push without migration: `npx prisma db push` (dev only)
- Check migration status: `npx prisma migrate status`

**6. Missing Prisma Client:**
```bash
npx prisma generate  # Regenerate client
```

**7. Type Errors After Schema Changes:**
- Restart TypeScript server in editor
- Run `npx prisma generate`
- Check for breaking changes in model relationships

### Development Workflow

1. **Start Development:**
   ```bash
   npm run dev  # Starts on port 3000
   ```

2. **Monitor API Calls:**
   - Browser DevTools Network tab
   - Filter by upstream data host and `localhost:3000/api/`
   - Check response times and caching headers

3. **Database Inspection:**
   ```bash
   npx prisma studio  # Opens GUI on port 5555
   ```
   - View all tables, relationships
   - Manually query/edit data
   - Monitor cache entries and expiration

4. **Check Logs:**
   - Server logs in terminal (API errors, cache hits/misses)
   - Browser console (React errors, client-side issues)
   - Network tab (failed requests, slow endpoints)

5. **Testing Predictions:**
   - Use `/api/matches/today` to get fixture IDs
   - Call `/api/predictions/[matchId]` to generate prediction
   - Check `/api/bulk-analysis/results` for bulk analysis
   - Verify high-confidence recommendations at `/api/recommendations/high-confidence`

6. **Algorithm Iteration:**
   - Modify weights in `lib/advanced-prediction-engine.ts`
   - Clear cache: Delete relevant rows in `cache_entries` table
   - Re-run predictions with `force: true` flag
   - Compare results in bulk analysis dashboard

## Additional Resources

- **AwaStats Docs**: internal reference in `docs/prediction-fields-mapping.md`
- **Prisma Docs**: https://www.prisma.io/docs
- **Next.js 15 Docs**: https://nextjs.org/docs
- **Algorithm Details**: See `ALGORITHMS.md` in repository
- **Deployment Guide**: See `DEPLOYMENT-READY.md` for production setup