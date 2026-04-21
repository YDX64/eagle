
import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService, CURRENT_SEASON } from '@/lib/api-football';
import { PredictionEngine } from '@/lib/prediction-engine';
import { AdvancedPredictionEngine } from '@/lib/advanced-prediction-engine';
import { CacheService } from '@/lib/cache';
import { prisma } from '@/lib/db';

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId: matchIdStr } = await params;
  try {
    const matchId = parseInt(matchIdStr);
    
    if (isNaN(matchId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid match ID' },
        { status: 400 }
      );
    }

    const cacheKey = CacheService.generateApiKey('prediction', { matchId });
    
    const predictionResult = await CacheService.cacheApiResponse(
      cacheKey,
      async () => {
        // Get match details
        const match = await ApiFootballService.getFixture(matchId);
        if (!match) {
          throw new Error('Match not found');
        }

        const homeTeamId = match.teams.home.id;
        const awayTeamId = match.teams.away.id;
        const leagueId = match.league.id;
        const season = match.league.season;

        // Get recent form (last 10 matches for each team) - fetch once and reuse
        const leagueMatches = await ApiFootballService.getFixturesByLeague(leagueId, season, 'FT');

        // Filter matches for each team (last 10)
        const homeMatches = leagueMatches
          .filter(m => m.teams.home.id === homeTeamId || m.teams.away.id === homeTeamId)
          .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
          .slice(0, 10)
          .map(apiMatch => ({
            id: apiMatch.fixture.id,
            home_team_id: apiMatch.teams.home.id,
            away_team_id: apiMatch.teams.away.id,
            home_goals: apiMatch.goals.home,
            away_goals: apiMatch.goals.away,
            date: new Date(apiMatch.fixture.date),
          }));

        const awayMatches = leagueMatches
          .filter(m => m.teams.home.id === awayTeamId || m.teams.away.id === awayTeamId)
          .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
          .slice(0, 10)
          .map(apiMatch => ({
            id: apiMatch.fixture.id,
            home_team_id: apiMatch.teams.home.id,
            away_team_id: apiMatch.teams.away.id,
            home_goals: apiMatch.goals.home,
            away_goals: apiMatch.goals.away,
            date: new Date(apiMatch.fixture.date),
          }));

        // Calculate team form
        const homeForm = PredictionEngine.calculateTeamForm(homeMatches as any[], homeTeamId);
        const awayForm = PredictionEngine.calculateTeamForm(awayMatches as any[], awayTeamId);

        // Get head-to-head records
        let h2hRecord = null;
        try {
          const h2hData = await ApiFootballService.getHeadToHead(`${homeTeamId}-${awayTeamId}`);
          if (h2hData.length > 0) {
            let homeWins = 0, awayWins = 0, draws = 0;
            h2hData.forEach(match => {
              if (match.goals.home > match.goals.away) {
                if (match.teams.home.id === homeTeamId) homeWins++;
                else awayWins++;
              } else if (match.goals.home < match.goals.away) {
                if (match.teams.away.id === homeTeamId) homeWins++;
                else awayWins++;
              } else {
                draws++;
              }
            });
            
            h2hRecord = {
              total_matches: h2hData.length,
              team1_wins: homeWins,
              team2_wins: awayWins,
              draws: draws
            };
          }
        } catch (error) {
        }

        // Get league standings
        let homeStanding = null, awayStanding = null;
        try {
          const standings = await ApiFootballService.getStandings(leagueId, season);
          homeStanding = standings.find(s => s.team.id === homeTeamId);
          awayStanding = standings.find(s => s.team.id === awayTeamId);
        } catch (error) {
        }

        // Get API-Football predictions
        const apiPredictions = await ApiFootballService.getPredictions(matchId);
        
        // Generate advanced prediction
        const advancedPrediction = await AdvancedPredictionEngine.generateAdvancedPrediction(
          homeTeamId,
          awayTeamId,
          leagueId,
          season,
          matchId
        );
        
        // Also generate basic prediction for backward compatibility
        const basicPrediction = await PredictionEngine.predictMatch(
          match.teams.home as any,
          match.teams.away as any,
          homeForm,
          awayForm,
          h2hRecord as any,
          homeStanding as any,
          awayStanding as any
        );

        // Save match data to database (only if PostgreSQL is configured)
        const dbUrl = process.env.DATABASE_URL || '';
        const useDb = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
        try {
          if (!useDb) throw new Error('skip-db');
          // Save league - check if exists first
          const existingLeague = await prisma.league.findFirst({
            where: {
              id: match.league.id,
              season: match.league.season
            }
          });

          if (!existingLeague) {
            await prisma.league.create({
              data: {
                id: match.league.id,
                name: match.league.name,
                country: match.league.country,
                logo: match.league.logo,
                season: match.league.season,
                type: 'league',
                current: true
              }
            });
          } else {
            await prisma.league.update({
              where: {
                id_season: {
                  id: match.league.id,
                  season: match.league.season
                }
              },
              data: {
                name: match.league.name,
                country: match.league.country,
                logo: match.league.logo,
              }
            });
          }

          // Save teams
          await prisma.team.upsert({
            where: { id: match.teams.home.id },
            create: {
              id: match.teams.home.id,
              name: match.teams.home.name,
              logo: match.teams.home.logo,
              country: match.league.country
            },
            update: {
              name: match.teams.home.name,
              logo: match.teams.home.logo,
            }
          });

          await prisma.team.upsert({
            where: { id: match.teams.away.id },
            create: {
              id: match.teams.away.id,
              name: match.teams.away.name,
              logo: match.teams.away.logo,
              country: match.league.country
            },
            update: {
              name: match.teams.away.name,
              logo: match.teams.away.logo,
            }
          });

          // Save match
          await prisma.match.upsert({
            where: { id: match.fixture.id },
            create: {
              id: match.fixture.id,
              referee: match.fixture.referee,
              timezone: match.fixture.timezone,
              date: new Date(match.fixture.date),
              timestamp: match.fixture.timestamp,
              venue_id: match.fixture.venue?.id,
              venue_name: match.fixture.venue?.name,
              venue_city: match.fixture.venue?.city,
              status_long: match.fixture.status.long,
              status_short: match.fixture.status.short,
              status_elapsed: match.fixture.status.elapsed,
              league_id: match.league.id,
              league_season: match.league.season,
              league_round: match.league.round,
              home_team_id: match.teams.home.id,
              away_team_id: match.teams.away.id,
              home_goals: match.goals.home,
              away_goals: match.goals.away,
              home_score_ht: match.score.halftime?.home,
              away_score_ht: match.score.halftime?.away,
              home_score_ft: match.score.fulltime?.home,
              away_score_ft: match.score.fulltime?.away,
              home_score_et: match.score.extratime?.home,
              away_score_et: match.score.extratime?.away,
              home_score_pen: match.score.penalty?.home,
              away_score_pen: match.score.penalty?.away
            },
            update: {
              status_long: match.fixture.status.long,
              status_short: match.fixture.status.short,
              status_elapsed: match.fixture.status.elapsed,
              home_goals: match.goals.home,
              away_goals: match.goals.away,
              home_score_ft: match.score.fulltime?.home,
              away_score_ft: match.score.fulltime?.away
            }
          });

          // Now save prediction - check if it already exists first
          const existingPrediction = await prisma.prediction.findFirst({
            where: {
              match_id: matchId,
              prediction_type: 'match_winner',
              algorithm_version: '2.0'
            }
          });

          if (!existingPrediction) {
            await prisma.prediction.create({
              data: {
                match_id: matchId,
                prediction_type: 'match_winner',
                predicted_value: advancedPrediction.match_result.home_win.probability > advancedPrediction.match_result.away_win.probability
                  ? (advancedPrediction.match_result.home_win.probability > advancedPrediction.match_result.draw.probability ? 'home' : 'draw')
                  : (advancedPrediction.match_result.away_win.probability > advancedPrediction.match_result.draw.probability ? 'away' : 'draw'),
                confidence_score: advancedPrediction.prediction_confidence / 100,
                home_form_score: homeForm.form_score,
                away_form_score: awayForm.form_score,
                head_to_head_score: advancedPrediction.analysis_factors.head_to_head_weight,
                home_advantage_score: advancedPrediction.analysis_factors.home_advantage_weight,
                goals_analysis_score: advancedPrediction.analysis_factors.recent_performance_weight,
                factors_used: advancedPrediction.analysis_factors as any,
                algorithm_version: '2.0'
              }
            });
            console.log(`[PREDICTION] Successfully saved prediction for match ${matchId}`);
          } else {
            console.log(`[PREDICTION] Prediction already exists for match ${matchId}`);
          }
        } catch (dbError) {
          // Silently skip DB errors when PostgreSQL is not configured
        }

        return {
          match,
          prediction: basicPrediction, // For backward compatibility
          advancedPrediction, // New comprehensive predictions
          apiPredictions, // API-Football predictions
          metadata: {
            homeForm,
            awayForm,
            h2hRecord,
            homeStanding,
            awayStanding
          }
        };
      },
      CacheService.TTL.PREDICTIONS
    );

    return NextResponse.json({
      success: true,
      data: predictionResult
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate prediction',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
