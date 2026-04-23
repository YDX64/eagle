/**
 * GET /api/nba/players/[playerId]?season=2025
 *
 * Returns an NBA player's season averages with standard deviations + basic
 * prop projections (points/rebounds/assists/3PM O/U common lines).
 */

import { NextRequest, NextResponse } from 'next/server';
import { nbaApi } from '@/lib/sports/nba/api-nba';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId: playerIdStr } = await params;
  const playerId = parseInt(playerIdStr, 10);
  const url = new URL(request.url);
  const season = parseInt(url.searchParams.get('season') || String(nbaApi.getCurrentSeason()), 10);

  if (!Number.isFinite(playerId)) {
    return NextResponse.json({ success: false, error: 'Invalid player ID' }, { status: 400 });
  }

  try {
    const stats = await nbaApi.getPlayerSeasonStats(playerId, season);
    if (!stats) {
      return NextResponse.json(
        { success: false, error: 'No stats found for player/season' },
        { status: 404 }
      );
    }

    // Simple Gaussian prop projections
    const propLines = (mean: number, sigma: number, offsets: number[]) =>
      offsets.map((o) => {
        const line = Math.round(mean) + o + 0.5;
        if (line <= 0) return null;
        // Normal CDF approximation
        const erf = (x: number) => {
          const t = 1 / (1 + 0.3275911 * Math.abs(x));
          const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
          return x < 0 ? -y : y;
        };
        const cdf = (x: number) => 0.5 * (1 + erf((x - mean) / (sigma * Math.SQRT2)));
        return {
          line,
          over_prob: Number((1 - cdf(line)).toFixed(3)),
          under_prob: Number(cdf(line).toFixed(3)),
        };
      }).filter((x): x is NonNullable<typeof x> => x !== null);

    return NextResponse.json({
      success: true,
      sport: 'nba',
      data: {
        ...stats,
        props: {
          points: propLines(stats.ppg, stats.ppgStdDev || 5, [-4, -2, 0, 2, 4]),
          rebounds: propLines(stats.rpg, stats.rpgStdDev || 3, [-2, -1, 0, 1, 2]),
          assists: propLines(stats.apg, stats.apgStdDev || 2, [-2, -1, 0, 1, 2]),
          threes_made: propLines(stats.tpmpg, stats.tpmpgStdDev || 1, [-1, 0, 1]),
        },
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
