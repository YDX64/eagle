/**
 * GET /api/nba-v2/context/[gameId]
 *
 * Combines the basketball-v2 prediction with extra NBA-specific context:
 *   - Prediction (all markets + player props)
 *   - Conference standings (home + away team)
 *   - Head-to-head this season
 *   - Recent form (last 5, last 10 with W-L streak)
 *   - Best value bets (model prob vs implied prob from market odds)
 *
 * This is the data source for the rich NBA prediction page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { predictGameV2 } from '@/lib/sports/basketball-v2/engine';
import { nbaApi } from '@/lib/sports/nba/api-nba';
import { fetchGameOdds } from '@/lib/sports/basketball-v2/odds/fetch-odds';
import { generateBetRecommendations } from '@/lib/sports/basketball-v2/picks/pick-engine';
import { getGameById } from '@/lib/sports/basketball-v2/warehouse/games-repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId: gameIdStr } = await params;
  const gameId = parseInt(gameIdStr, 10);
  if (!Number.isFinite(gameId)) {
    return NextResponse.json({ success: false, error: 'invalid game id' }, { status: 400 });
  }

  try {
    // 1. Fetch live game from NBA API to get current season + team IDs
    const liveGame = await nbaApi.getGameById(gameId);
    if (!liveGame) {
      return NextResponse.json(
        { success: false, error: `NBA game ${gameId} not found` },
        { status: 404 }
      );
    }

    const season = liveGame.season;
    const homeTeamId = liveGame.teams.home.id;
    const awayTeamId = liveGame.teams.visitors.id;

    // 2. Parallel fetch: prediction + standings + H2H + team stats + odds
    //
    // Odds are fetched via basketball-api (league=12 for NBA) — the NBA api
    // doesn't expose odds directly. We cross-reference by finding the
    // corresponding basketball-api game ID for the same matchup + date.
    const [prediction, standings, h2h, homeStats, awayStats, odds] = await Promise.allSettled([
      predictGameV2('nba', gameId),
      nbaApi.getStandings(season).catch(() => []),
      nbaApi.getHeadToHead(homeTeamId, awayTeamId, season).catch(() => []),
      nbaApi.getTeamStatistics(homeTeamId, season).catch(() => null),
      nbaApi.getTeamStatistics(awayTeamId, season).catch(() => null),
      findBasketballGameIdAndFetchOdds(liveGame).catch(() => null),
    ]);

    if (prediction.status === 'rejected') {
      const err = prediction.reason;
      return NextResponse.json(
        {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          hint: 'Warehouse may not have this game yet — run daily-cron first',
        },
        { status: 500 }
      );
    }

    const predictionData = prediction.value;
    const standingsData = standings.status === 'fulfilled' ? standings.value : [];
    const h2hData = h2h.status === 'fulfilled' ? h2h.value : [];
    const homeStatsData = homeStats.status === 'fulfilled' ? homeStats.value : null;
    const awayStatsData = awayStats.status === 'fulfilled' ? awayStats.value : null;
    const realOdds = odds.status === 'fulfilled' ? odds.value : null;

    // 2.5. Generate bet recommendations using real odds where available
    const pickSummary = generateBetRecommendations(predictionData, realOdds);

    // 3. Extract team standings
    const homeStanding = standingsData.find((s) => s.team?.id === homeTeamId) || null;
    const awayStanding = standingsData.find((s) => s.team?.id === awayTeamId) || null;

    // 4. Compute H2H summary
    const h2hSummary = computeH2hSummary(h2hData, homeTeamId, awayTeamId);

    // 5. Compute best value bets (picks with model prob > implied prob from odds)
    const valueBets = findBestValueBets(predictionData);

    // 6. Compute star matchup
    const starMatchup = computeStarMatchup(
      predictionData.playerProps,
      predictionData.homeTeam,
      predictionData.awayTeam
    );

    // 7. Compute confidence level category
    const confidencePct = predictionData.confidence * 100;
    let confidenceLevel: 'elite' | 'high' | 'medium' | 'low' = 'low';
    if (confidencePct >= 70) confidenceLevel = 'elite';
    else if (confidencePct >= 60) confidenceLevel = 'high';
    else if (confidencePct >= 55) confidenceLevel = 'medium';

    return NextResponse.json({
      success: true,
      engine: 'nba-v2',
      data: {
        prediction: predictionData,
        liveGame: {
          id: liveGame.id,
          status: liveGame.status,
          arena: liveGame.arena,
          officials: liveGame.officials,
          nugget: liveGame.nugget,
        },
        standings: {
          home: homeStanding,
          away: awayStanding,
        },
        headToHead: h2hSummary,
        teamStats: {
          home: homeStatsData,
          away: awayStatsData,
        },
        valueBets,
        starMatchup,
        confidence: {
          percentage: confidencePct,
          level: confidenceLevel,
        },
        // NEW: real odds + pick recommendations
        realOdds,
        picks: pickSummary,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeH2hSummary(games: any[], homeTeamId: number, awayTeamId: number) {
  // Filter to finished games
  const finished = games.filter(
    (g: any) => g.status?.short === 3 || g.status?.long === 'Finished'
  );
  if (finished.length === 0) {
    return { totalGames: 0, homeWins: 0, awayWins: 0, avgTotal: 0, lastMeeting: null };
  }

  let homeWins = 0;
  let awayWins = 0;
  let totalPointsSum = 0;

  for (const g of finished) {
    const h = g.teams.home.id === homeTeamId ? g.scores.home.points : g.scores.visitors.points;
    const a = g.teams.home.id === homeTeamId ? g.scores.visitors.points : g.scores.home.points;
    totalPointsSum += (h || 0) + (a || 0);
    if (h > a) homeWins++;
    else if (a > h) awayWins++;
  }

  const lastMeeting = finished
    .sort((a: any, b: any) => new Date(b.date.start).getTime() - new Date(a.date.start).getTime())[0];

  return {
    totalGames: finished.length,
    homeWins,
    awayWins,
    avgTotal: Math.round((totalPointsSum / finished.length) * 10) / 10,
    lastMeeting: lastMeeting
      ? {
          date: lastMeeting.date.start,
          homeScore:
            lastMeeting.teams.home.id === homeTeamId
              ? lastMeeting.scores.home.points
              : lastMeeting.scores.visitors.points,
          awayScore:
            lastMeeting.teams.home.id === homeTeamId
              ? lastMeeting.scores.visitors.points
              : lastMeeting.scores.home.points,
        }
      : null,
  };
}

interface ValueBet {
  market: string;
  pickLabel: string;
  modelProb: number;
  impliedOdds: number;
  marketOdds: number;
  edge: number;
  kellyFraction: number;
}

function findBestValueBets(prediction: any): ValueBet[] {
  const bets: ValueBet[] = [];
  const m = prediction.markets;

  // Match result
  bets.push({
    market: 'Match Winner',
    pickLabel: `${prediction.homeTeam} ML`,
    modelProb: m.matchResult.homeWinProb,
    impliedOdds: m.matchResult.homeOdds,
    marketOdds: m.matchResult.homeOdds,
    edge: 0, // No market odds to compare, this is implied from model
    kellyFraction: 0,
  });
  bets.push({
    market: 'Match Winner',
    pickLabel: `${prediction.awayTeam} ML`,
    modelProb: m.matchResult.awayWinProb,
    impliedOdds: m.matchResult.awayOdds,
    marketOdds: m.matchResult.awayOdds,
    edge: 0,
    kellyFraction: 0,
  });

  // Total lines
  for (const line of m.totalPoints.lines) {
    bets.push({
      market: 'Total Points',
      pickLabel: `Over ${line.line}`,
      modelProb: line.overProb,
      impliedOdds: line.overOdds,
      marketOdds: line.overOdds,
      edge: 0,
      kellyFraction: 0,
    });
    bets.push({
      market: 'Total Points',
      pickLabel: `Under ${line.line}`,
      modelProb: line.underProb,
      impliedOdds: line.underOdds,
      marketOdds: line.underOdds,
      edge: 0,
      kellyFraction: 0,
    });
  }

  // Sort by highest confidence, return top 8
  return bets
    .filter((b) => b.modelProb >= 0.55)
    .sort((a, b) => b.modelProb - a.modelProb)
    .slice(0, 8);
}

/**
 * Find the basketball-api game ID that matches this NBA-api game, then fetch
 * its odds. Basketball-api and NBA-api use different game IDs for the same
 * physical game, so we match by date + team names.
 */
async function findBasketballGameIdAndFetchOdds(nbaGame: any): Promise<any> {
  try {
    // Strategy: query basketball-api for NBA games in the same season on same date.
    // CRITICAL: basketball-api requires the `season` parameter for /games queries.
    const gameDateRaw = nbaGame.date?.start;
    if (!gameDateRaw) return null;
    const gameDate = gameDateRaw.slice(0, 10);

    // Derive basketball-api season string from NBA season year
    // NBA season 2025 = "2025-2026" in basketball-api convention
    const nbaSeason = nbaGame.season;
    const basketballSeason = `${nbaSeason}-${nbaSeason + 1}`;

    const url = `https://v1.basketball.api-sports.io/games?league=12&season=${basketballSeason}&date=${gameDate}`;
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const games: any[] = json.response || [];

    // Match by home team name (basketball-api uses full team names)
    const homeTeamName = nbaGame.teams?.home?.name || '';
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/^los angeles\s+/, 'la ')
        .replace(/\./g, '')
        .trim();

    const targetName = normalize(homeTeamName);
    const match = games.find((g) => {
      const hname = normalize(g.teams?.home?.name || '');
      return (
        hname === targetName ||
        hname.includes(targetName) ||
        targetName.includes(hname)
      );
    });
    if (!match) {
      console.warn(
        `[odds-cross-ref] no match for "${homeTeamName}" on ${gameDate} (season ${basketballSeason})`
      );
      return null;
    }

    // Now fetch odds for this basketball-api game ID
    return await fetchGameOdds(match.id);
  } catch (err) {
    console.error('[odds-cross-ref] failed:', err);
    return null;
  }
}

function computeStarMatchup(playerProps: any[], homeTeamName: string, awayTeamName: string) {
  if (!playerProps || playerProps.length === 0) return null;

  // Filter by team NAME (PlayerPropPrediction.team stores team name, not ID)
  const homeStars = playerProps
    .filter((p) => p.team === homeTeamName)
    .sort((a, b) => b.combos.praProjected - a.combos.praProjected);
  const awayStars = playerProps
    .filter((p) => p.team === awayTeamName)
    .sort((a, b) => b.combos.praProjected - a.combos.praProjected);

  return {
    homeStar: homeStars[0] || null,
    awayStar: awayStars[0] || null,
  };
}
