/**
 * POST /api/probet/daily-predictions
 *
 * Triggers prediction generation for ALL sports for today.
 * Each sport's prediction route is called internally, which saves to PG via
 * multi-sport-tracker / savePredictionAsync.
 *
 * This endpoint should be called by cron 3x daily (08:00, 14:00, 20:00).
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SPORT_ENDPOINTS = [
  { sport: 'football', url: '/api/probet?limit=50&majorLeagues=false' },
  { sport: 'basketball-v2', url: '/api/basketball-v2/daily-cron' },
];

// Individual game prediction endpoints for batch processing
const GAME_SPORTS = [
  { sport: 'hockey', gamesUrl: '/api/hockey/games/today', predUrl: '/api/hockey/predictions' },
  { sport: 'handball', gamesUrl: '/api/handball/games/today', predUrl: '/api/handball/predictions' },
  { sport: 'volleyball', gamesUrl: '/api/volleyball/games/today', predUrl: '/api/volleyball/predictions' },
];

export async function POST(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;
  const results: any[] = [];
  const startTime = Date.now();

  // 1. Trigger football + basketball bulk endpoints
  for (const ep of SPORT_ENDPOINTS) {
    try {
      const url = ep.url.startsWith('http') ? ep.url : baseUrl + ep.url;
      const method = ep.sport === 'basketball-v2' ? 'POST' : 'GET';
      const res = await fetch(url, { method });
      const data = await res.json();
      results.push({
        sport: ep.sport,
        success: data.success !== false,
        count: data.data?.stats?.successCount || data.data?.predictions?.length || 0,
      });
    } catch (err) {
      results.push({ sport: ep.sport, success: false, error: String(err) });
    }
  }

  // 2. For other sports, fetch game list then predict top 20 individually
  for (const gs of GAME_SPORTS) {
    try {
      const gamesRes = await fetch(baseUrl + gs.gamesUrl);
      const gamesData = await gamesRes.json();
      const games = gamesData.data?.games || [];
      const upcoming = games
        .filter((g: any) => g.status === 'NS' || g.status === 'TBD')
        .slice(0, 20);

      let predicted = 0;
      for (const game of upcoming) {
        try {
          const gameId = game.game_id || game.id || game.fixture_id;
          if (!gameId) continue;
          await fetch(baseUrl + gs.predUrl + '/' + gameId);
          predicted++;
          // Small delay to not overwhelm API
          await new Promise(r => setTimeout(r, 500));
        } catch { /* skip */ }
      }

      results.push({ sport: gs.sport, success: true, count: predicted, total: upcoming.length });
    } catch (err) {
      results.push({ sport: gs.sport, success: false, error: String(err) });
    }
  }

  // 3. Also resolve any finished predictions
  try {
    await fetch(baseUrl + '/api/probet/resolve-results?max=500', { method: 'POST' });
  } catch { /* silent */ }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return NextResponse.json({
    success: true,
    data: {
      results,
      totalPredicted: results.reduce((s, r) => s + (r.count || 0), 0),
      elapsedSeconds: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
    },
  });
}
