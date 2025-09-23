# Eagle Football Prediction System - Replit Setup

## Project Overview
This is a Next.js-based football prediction system that provides AI-powered match predictions using advanced statistical modeling. The system integrates with API-Football.com for real-time match data and includes features like:

- Real-time match data display
- Advanced prediction algorithms with confidence scoring
- Historical performance validation (backtesting)
- SQLite database for data storage
- Modern UI with Radix UI components

## Current Status
✅ **Successfully configured for Replit environment**
- Next.js development server running on port 5000
- SQLite database set up and migrated
- All dependencies installed
- Deployment configuration completed

## Database Setup
- **Database Type**: SQLite (local file: `./dev.db`)
- **ORM**: Prisma
- **Schema**: Comprehensive football data models including matches, teams, predictions, etc.

## Environment Variables Required
To fully function, the application needs:
- `API_FOOTBALL_KEY`: Get from api-football.com (currently using placeholder)
- `NEXTAUTH_SECRET`: For authentication (currently using placeholder)

## Current Limitations
1. **API Key**: The application requires a valid API_FOOTBALL_KEY from api-football.com for live data
2. **Minor JS Error**: There's a syntax error in the browser console that should be investigated
3. **No Seed Data**: The database is empty - you may want to add some sample data

## Development Workflow
- The development server runs automatically via the configured workflow
- Port 5000 is properly configured for Replit's proxy system
- Hot reloading is working correctly
- CORS and host verification are properly configured for Replit

## Recent Changes Made for Replit Compatibility
- Modified `package.json` scripts to explicitly set DATABASE_URL and bind to 0.0.0.0:5000
- Updated `next.config.js` with proper allowedDevOrigins for Replit's proxy
- Fixed Prisma schema with missing model definitions
- Added cache control headers to prevent iframe caching issues

## Architecture
- **Frontend**: Next.js 15 with TypeScript and App Router
- **UI Components**: Radix UI with Tailwind CSS
- **State Management**: Zustand and Tanstack Query
- **Database**: SQLite with Prisma ORM
- **Charts**: Multiple charting libraries (Chart.js, Recharts, Plotly.js)