import { NextRequest, NextResponse } from 'next/server';
import { LargeScaleBacktest } from '@/lib/large-scale-backtest';
import { MAJOR_LEAGUES } from '@/lib/api-football';

export const dynamic = 'force-dynamic';

/**
 * Large-Scale Backtest API
 *
 * Yüzlerce/binlerce maç ile geriye dönük backtest.
 * Lig başına sadece 2 API çağrısı (standings + fixtures).
 *
 * GET /api/backtest/large-scale?league=39&season=2024
 * GET /api/backtest/large-scale?preset=top5&season=2024
 * GET /api/backtest/large-scale?league=39,140,78&season=2024
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const preset = searchParams.get('preset');
    const leagueParam = searchParams.get('league');
    const season = parseInt(searchParams.get('season') || '2024');
    const maxMatches = searchParams.get('max') ? parseInt(searchParams.get('max')!) : undefined;
    const minRound = parseInt(searchParams.get('minRound') || '5');

    // Preset: Top 5 European leagues
    if (preset === 'top5') {
      const result = await LargeScaleBacktest.runTop5Backtest(season);
      return NextResponse.json({
        success: true,
        preset: 'top5',
        season,
        ...result,
      });
    }

    // Single or multiple leagues
    if (leagueParam) {
      const leagueIds = leagueParam.split(',').map(id => parseInt(id.trim()));

      if (leagueIds.length === 1) {
        // Single league backtest
        const result = await LargeScaleBacktest.runLeagueBacktest(leagueIds[0], season, {
          maxMatches,
          minRound,
        });
        return NextResponse.json({
          success: true,
          ...result,
        });
      }

      // Multi-league
      const leagueNames: Record<number, string> = {
        [MAJOR_LEAGUES.PREMIER_LEAGUE]: 'Premier League',
        [MAJOR_LEAGUES.LA_LIGA]: 'La Liga',
        [MAJOR_LEAGUES.BUNDESLIGA]: 'Bundesliga',
        [MAJOR_LEAGUES.SERIE_A]: 'Serie A',
        [MAJOR_LEAGUES.LIGUE_1]: 'Ligue 1',
        [MAJOR_LEAGUES.SUPER_LIG]: 'Süper Lig',
        [MAJOR_LEAGUES.EREDIVISIE]: 'Eredivisie',
        [MAJOR_LEAGUES.PRIMEIRA_LIGA]: 'Primeira Liga',
        [MAJOR_LEAGUES.CHAMPIONS_LEAGUE]: 'Champions League',
        [MAJOR_LEAGUES.EUROPA_LEAGUE]: 'Europa League',
      };

      const leagues = leagueIds.map(id => ({
        id,
        name: leagueNames[id] || `League ${id}`,
      }));

      const result = await LargeScaleBacktest.runMultiLeagueBacktest(leagues, season, {
        maxMatchesPerLeague: maxMatches,
        minRound,
      });

      return NextResponse.json({
        success: true,
        season,
        ...result,
      });
    }

    // No parameters - show usage
    return NextResponse.json({
      success: false,
      error: 'Missing parameters',
      usage: {
        single_league: '/api/backtest/large-scale?league=39&season=2024',
        multi_league: '/api/backtest/large-scale?league=39,140,78&season=2024',
        top5_preset: '/api/backtest/large-scale?preset=top5&season=2024',
        turkish_league: '/api/backtest/large-scale?league=203&season=2024',
        parameters: {
          league: 'League ID(s), comma-separated',
          season: 'Season year (default: 2024)',
          preset: 'top5 = Top 5 European leagues',
          max: 'Max matches per league (optional)',
          minRound: 'Skip first N rounds (default: 5, data unreliable early)',
        },
        league_ids: {
          'Premier League': 39,
          'La Liga': 140,
          'Bundesliga': 78,
          'Serie A': 135,
          'Ligue 1': 61,
          'Süper Lig': 203,
          'Champions League': 2,
          'Eredivisie': 88,
        },
      },
    });
  } catch (error: any) {
    console.error('[BACKTEST API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Backtest failed',
    }, { status: 500 });
  }
}
