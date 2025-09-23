# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Football Prediction System

This is a real-money football betting prediction system using API-Football data. The system generates predictions using advanced algorithms and tracks performance through backtesting.

## Development Commands

```bash
# Development
npm run dev          # Start development server on port 3000

# Build & Production
npm run build        # Build for production
npm run start        # Start production server

# Database
npx prisma migrate dev     # Run database migrations
npx prisma generate        # Generate Prisma client
npx prisma studio         # Open Prisma Studio GUI
npx prisma db seed        # Seed database (if seed script exists)

# Testing predictions
curl http://localhost:3000/api/matches/today     # Get today's matches
curl http://localhost:3000/api/predictions/{id}  # Generate prediction for match
```

## Architecture Overview

### Core Services (`/lib`)

- **api-football.ts**: API-Football.com integration for real match data (fixtures, standings, statistics)
- **prediction-engine.ts**: Basic prediction algorithm using form, H2H, standings
- **advanced-prediction-engine.ts**: Advanced algorithm with poisson distribution, momentum analysis
- **backtest-engine.ts**: Backtesting system for measuring prediction accuracy
- **cache.ts**: Dual caching system (database + in-memory) with TTL management
- **db.ts**: Prisma client with SQLite configuration override

### API Routes (`/app/api`)

- `/matches/today`: Returns all matches (no 400 limit) with live scores
- `/predictions/[matchId]`: Generates and saves prediction for specific match
- `/backtest/run`: Runs backtest analysis on saved predictions
- `/statistics/*`: League, team, and prediction statistics endpoints

### Database

SQLite database at `./prisma/dev.db` with tables:
- matches: Game fixtures with scores
- predictions: Generated predictions with confidence scores
- teams, leagues: Reference data
- backtest_results: Historical performance metrics

## Critical Implementation Details

### Database Path Issue
The system may create nested database at `./prisma/prisma/dev.db`. Ensure `lib/db.ts` uses:
```typescript
process.env.DATABASE_URL = "file:./dev.db";
```

### Real Data Requirement
- NO mock data allowed - system uses real money
- All predictions must use actual API-Football data
- Cache responses to avoid API rate limits

### Match Display
All matches must be shown without artificial limits (removed 400 match cap in `/api/matches/today`)

### Environment Variables Required
```
API_FOOTBALL_KEY=<your-key>  # Required for API-Football.com
DATABASE_URL=file:./prisma/dev.db
```

## Prediction Algorithm Factors

1. **Team Form**: Last 10 matches performance
2. **Head-to-Head**: Historical matchups between teams
3. **League Position**: Current standings
4. **Home Advantage**: Home team boost factor
5. **Poisson Distribution**: Goal probability modeling
6. **Momentum Analysis**: Recent performance trends

## Cache TTL Settings

- FIXTURES_TODAY: 5 minutes (live data)
- FIXTURES_PAST: 24 hours (historical)
- LEAGUE_STANDINGS: 1 hour
- PREDICTIONS: 30 minutes
- TEAM_INFO: 24 hours
- STATISTICS: 1 hour
- HEAD_TO_HEAD: 6 hours

## Frontend Architecture

### Tech Stack
- **Framework**: Next.js 15 with App Router
- **UI Components**: Radix UI primitives with custom styling
- **Styling**: Tailwind CSS with custom design system
- **State Management**: Zustand for global state, React Query for server state
- **Charts**: Chart.js, Plotly.js, Recharts for data visualization
- **Forms**: React Hook Form with Yup validation
- **Authentication**: NextAuth.js

### Key Frontend Features
- Real-time match updates with live scores
- Interactive prediction charts and analytics
- Comprehensive backtest visualizations
- Responsive design with mobile optimization
- Dark/light theme support with next-themes

## Database Migration Notes

- Always run `npx prisma generate` after schema changes
- Use `npx prisma migrate dev --name description` for new migrations
- Database supports complex queries with joins across multiple tables
- Indexes are optimized for common query patterns (league_id, team_id, dates)

## API Rate Limiting

- API-Football.com has rate limits - cache aggressively
- Use database cache for expensive API calls
- In-memory cache for frequently accessed data
- Implement exponential backoff for API failures

## Performance Considerations

- Database queries use proper indexing for performance
- API responses are paginated to handle large datasets
- Caching strategy reduces API calls and improves response times
- Background jobs handle data synchronization
- Optimized for real-time betting scenarios

## Security Notes

- Never expose API keys in client-side code
- All API endpoints have proper authentication where needed
- Rate limiting prevents abuse
- Input validation on all user inputs
- CSRF protection enabled

## Troubleshooting

### Common Issues
1. **503 Service Unavailable**: Check API_FOOTBALL_KEY is valid
2. **Database locked**: Ensure only one Prisma client instance
3. **Port conflicts**: Kill processes on ports 3000-3004 before starting
4. **Migration issues**: Reset with `npx prisma migrate reset` if needed

### Development Workflow
1. Start with `npm run dev`
2. Monitor API calls in browser network tab
3. Use Prisma Studio for database inspection
4. Check console logs for detailed error information