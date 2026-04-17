
import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService } from '@/lib/api-football';
import { PredictionEngine } from '@/lib/prediction-engine';
import { AdvancedPredictionEngine } from '@/lib/advanced-prediction-engine';
import { CacheService } from '@/lib/cache';
import { PredictionEnsemble } from '@/lib/prediction-ensemble';
import type { PredictionApiData } from '@/lib/types';
import type { EnsemblePrediction, EnsembleWeights } from '@/lib/types/ensemble-types';
import { buildEnsembleInput, buildPredictionMetadata, buildSourceSnapshots } from '@/lib/utils/prediction-ensemble-utils';
import weightsConfig from '@/lib/config/prediction-ensemble-weights.json';
import { prisma, saveEnsemblePrediction } from '@/lib/db';

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

    const predictionResult = await CacheService.cacheApiResponse<PredictionApiData>(
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

        // Get AwaStats predictions
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
          homeStanding ? {
            rank: homeStanding.rank,
            points: homeStanding.points
          } as any : undefined,
          awayStanding ? {
            rank: awayStanding.rank,
            points: awayStanding.points
          } as any : undefined
        );

        const ensemble = new PredictionEnsemble(weightsConfig as EnsembleWeights);
        const ensembleInput = buildEnsembleInput({
          apiFootballPrediction: apiPredictions,
          basicPrediction,
          advancedPrediction,
        });

        const ensemblePrediction: EnsemblePrediction = ensemble.combine(ensembleInput);

        const sourceSnapshots = buildSourceSnapshots({
          apiPredictions,
          basicPrediction,
          advancedPrediction,
        });

        const metadata = buildPredictionMetadata({
          homeForm,
          awayForm,
          h2hRecord,
          homeStanding,
          awayStanding,
        });

        // Save match data first to ensure foreign keys exist
        try {
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

          await saveEnsemblePrediction({
            matchId,
            ensemblePrediction,
            metadata,
            sourceSnapshots,
          });
        } catch (dbError) {
          console.error('[PREDICTION] Database error:', dbError);
        }

        return {
          match,
          ensemblePrediction,
          sourceDiagnostics: ensemblePrediction.diagnostics,
          bankoSelections: ensemblePrediction.bankoSelections,
          confidenceSummary: ensemblePrediction.confidence,
          sourceSnapshots,
          metadata,
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
