import { NextRequest, NextResponse } from 'next/server';
import { settlePendingPredictions, type GameResult } from '@/lib/tracking/market-settler';
import { ApiFootballService } from '@/lib/api-football';
import { basketballApi } from '@/lib/sports/basketball/api-basketball';
import { hockeyApi } from '@/lib/sports/hockey/api-hockey';
import { handballApi } from '@/lib/sports/handball/api-handball';
import { volleyballApi } from '@/lib/sports/volleyball/api-volleyball';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function fetchFootballResult(api_game_id: number): Promise<GameResult | null> {
  const f = await ApiFootballService.getFixture(api_game_id);
  if (!f) return null;
  return {
    sport: 'football',
    api_game_id,
    status_short: f.fixture.status.short,
    home: f.goals.home ?? 0,
    away: f.goals.away ?? 0,
    home_ht: f.score?.halftime?.home ?? null,
    away_ht: f.score?.halftime?.away ?? null,
    home_et: f.score?.extratime?.home ?? null,
    away_et: f.score?.extratime?.away ?? null,
    home_pen: f.score?.penalty?.home ?? null,
    away_pen: f.score?.penalty?.away ?? null,
  };
}

async function fetchGenericResult(sport: SportCode, api: any, api_game_id: number): Promise<GameResult | null> {
  const g = await api.getGameById(api_game_id);
  if (!g) return null;
  const s = g.scores;
  const result: GameResult = {
    sport,
    api_game_id,
    status_short: g.status?.short ?? '',
    home: s?.home?.total ?? 0,
    away: s?.away?.total ?? 0,
  };
  if (sport === 'hockey') {
    result.periods = [
      { home: s?.home?.period_1 ?? null, away: s?.away?.period_1 ?? null },
      { home: s?.home?.period_2 ?? null, away: s?.away?.period_2 ?? null },
      { home: s?.home?.period_3 ?? null, away: s?.away?.period_3 ?? null },
    ];
    result.home_et = s?.home?.overtime ?? null;
    result.away_et = s?.away?.overtime ?? null;
    result.home_pen = s?.home?.penalties ?? null;
    result.away_pen = s?.away?.penalties ?? null;
  }
  if (sport === 'volleyball') {
    result.sets = [
      { home: s?.home?.set_1 ?? null, away: s?.away?.set_1 ?? null },
      { home: s?.home?.set_2 ?? null, away: s?.away?.set_2 ?? null },
      { home: s?.home?.set_3 ?? null, away: s?.away?.set_3 ?? null },
      { home: s?.home?.set_4 ?? null, away: s?.away?.set_4 ?? null },
      { home: s?.home?.set_5 ?? null, away: s?.away?.set_5 ?? null },
    ];
  }
  if (sport === 'handball') {
    result.home_ht = s?.home?.half_1 ?? null;
    result.away_ht = s?.away?.half_1 ?? null;
    result.home_et = s?.home?.extra_time ?? null;
    result.away_et = s?.away?.extra_time ?? null;
    result.home_pen = s?.home?.penalties ?? null;
    result.away_pen = s?.away?.penalties ?? null;
  }
  if (sport === 'basketball') {
    result.periods = [
      { home: s?.home?.quarter_1 ?? null, away: s?.away?.quarter_1 ?? null },
      { home: s?.home?.quarter_2 ?? null, away: s?.away?.quarter_2 ?? null },
      { home: s?.home?.quarter_3 ?? null, away: s?.away?.quarter_3 ?? null },
      { home: s?.home?.quarter_4 ?? null, away: s?.away?.quarter_4 ?? null },
    ];
    result.home_et = s?.home?.over_time ?? null;
    result.away_et = s?.away?.over_time ?? null;
  }
  return result;
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const target: SportCode | 'all' = body?.sport ?? 'all';
  try {
    const res = await settlePendingPredictions(target, async (sport, gameId) => {
      try {
        if (sport === 'football') return await fetchFootballResult(gameId);
        if (sport === 'basketball') return await fetchGenericResult(sport, basketballApi, gameId);
        if (sport === 'hockey') return await fetchGenericResult(sport, hockeyApi, gameId);
        if (sport === 'handball') return await fetchGenericResult(sport, handballApi, gameId);
        if (sport === 'volleyball') return await fetchGenericResult(sport, volleyballApi, gameId);
        if (sport === 'baseball') {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { baseballApi } = require('@/lib/sports/baseball/api-baseball');
          return await fetchGenericResult(sport, baseballApi, gameId);
        }
        return null;
      } catch {
        return null;
      }
    });
    return NextResponse.json({ success: true, data: res });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
