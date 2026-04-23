/**
 * Daily-all-sports prediction orchestrator.
 *
 * For each enabled sport:
 *   1. Fetch today's fixtures from api-sports
 *   2. Run the sport's prediction engine
 *   3. Normalize via engine-adapter
 *   4. Persist to predictions + picks via prediction-persister
 *   5. Optionally snapshot bookmaker odds into odds_snapshots_v2
 *   6. Record audit trail in prediction_runs
 *
 * Designed to be invoked by a cron endpoint (/api/cron/daily-all-sports).
 */

import { prisma } from '@/lib/db';
import { ApiFootballService } from '@/lib/api-football';
import { basketballApi } from '@/lib/sports/basketball/api-basketball';
import { hockeyApi } from '@/lib/sports/hockey/api-hockey';
import { handballApi } from '@/lib/sports/handball/api-handball';
import { volleyballApi } from '@/lib/sports/volleyball/api-volleyball';
import { BasketballPredictionEngine } from '@/lib/sports/basketball/prediction-engine';
import { HockeyPredictionEngine } from '@/lib/sports/hockey/prediction-engine';
import { HandballPredictionEngine } from '@/lib/sports/handball/prediction-engine';
import { VolleyballPredictionEngine } from '@/lib/sports/volleyball/prediction-engine';
import { AdvancedPredictionEngine } from '@/lib/advanced-prediction-engine';

import { adaptFootballPrediction, adaptSportResult } from './engine-adapter';
import { persistPrediction, upsertSportGame } from './prediction-persister';
import { snapshotOdds } from './odds-snapshotter';
import type { NormalizedPrediction, SportCode } from './types';

export interface DailyRunnerOptions {
  date?: string; // YYYY-MM-DD; default = today (UTC)
  sports?: SportCode[];
  max_per_sport?: number;
  snapshot_odds?: boolean;
  run_type?: 'daily' | 'hourly' | 'manual' | 'backfill';
}

export interface DailyRunnerResult {
  run_id: string;
  started_at: Date;
  finished_at: Date;
  status: 'completed' | 'partial' | 'failed';
  by_sport: Array<{
    sport: SportCode;
    fixtures_scanned: number;
    predictions_saved: number;
    picks_saved: number;
    odds_snapshots: number;
    errors: Array<{ api_game_id: number; error: string }>;
  }>;
  total_predictions: number;
  total_picks: number;
  total_snapshots: number;
}

const DEFAULT_SPORTS: SportCode[] = [
  'football',
  'basketball',
  'hockey',
  'handball',
  'volleyball',
  'baseball',
];

function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Run one sport's daily pipeline. Isolated so a failure in one sport doesn't
 * cascade into the rest.
 */
async function runSport(sport: SportCode, opts: { date: string; max: number; snapshot: boolean }) {
  const out = {
    sport,
    fixtures_scanned: 0,
    predictions_saved: 0,
    picks_saved: 0,
    odds_snapshots: 0,
    errors: [] as Array<{ api_game_id: number; error: string }>,
  };

  let fixtures: any[] = [];
  try {
    if (sport === 'football') {
      fixtures = await ApiFootballService.getFixturesByDate(opts.date);
    } else if (sport === 'basketball') {
      fixtures = await basketballApi.getGamesByDate(opts.date);
    } else if (sport === 'hockey') {
      fixtures = await hockeyApi.getGamesByDate(opts.date);
    } else if (sport === 'handball') {
      fixtures = await handballApi.getGamesByDate(opts.date);
    } else if (sport === 'volleyball') {
      fixtures = await volleyballApi.getGamesByDate(opts.date);
    } else if (sport === 'baseball') {
      // Baseball API service exposed from lib/sports/baseball (lazy require to avoid hard dep)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { baseballApi } = require('@/lib/sports/baseball/api-baseball');
        fixtures = await baseballApi.getGamesByDate(opts.date);
      } catch (err) {
        console.error(`[daily-runner] baseball api not available:`, err);
      }
    }
  } catch (err) {
    console.error(`[daily-runner] fetch failed for ${sport}:`, err);
    return out;
  }

  out.fixtures_scanned = fixtures.length;
  const slice = fixtures.slice(0, opts.max);

  for (const fixture of slice) {
    let api_game_id: number;
    let home_team = '';
    let away_team = '';
    let league: string | undefined;
    let league_id: number | undefined;
    let match_date: Date;

    try {
      if (sport === 'football') {
        api_game_id = fixture.fixture.id;
        home_team = fixture.teams.home.name;
        away_team = fixture.teams.away.name;
        league = fixture.league?.name;
        league_id = fixture.league?.id;
        match_date = new Date(fixture.fixture.date);
      } else {
        api_game_id = fixture.id;
        home_team = fixture.teams?.home?.name ?? '';
        away_team = fixture.teams?.away?.name ?? '';
        league = fixture.league?.name;
        league_id = fixture.league?.id;
        match_date = new Date(fixture.date ?? fixture.timestamp * 1000);
      }

      await upsertSportGame({
        sport,
        api_game_id,
        league_id,
        league_name: league,
        league_country: fixture.country?.name ?? fixture.league?.country,
        season: String(fixture.league?.season ?? ''),
        game_date: match_date,
        timestamp: fixture.timestamp ?? fixture.fixture?.timestamp,
        status_short: fixture.status?.short ?? fixture.fixture?.status?.short,
        status_long: fixture.status?.long ?? fixture.fixture?.status?.long,
        home_team_id: fixture.teams?.home?.id,
        home_team_name: home_team,
        home_team_logo: fixture.teams?.home?.logo,
        away_team_id: fixture.teams?.away?.id,
        away_team_name: away_team,
        away_team_logo: fixture.teams?.away?.logo,
        home_score: fixture.scores?.home?.total ?? fixture.goals?.home,
        away_score: fixture.scores?.away?.total ?? fixture.goals?.away,
        home_score_ht: fixture.score?.halftime?.home,
        away_score_ht: fixture.score?.halftime?.away,
        raw_scores: fixture.scores ?? fixture.score,
        venue_name: fixture.fixture?.venue?.name,
        venue_city: fixture.fixture?.venue?.city,
        raw_fixture: fixture,
      });

      let normalized: NormalizedPrediction | null = null;

      if (sport === 'football') {
        const homeTeamId = Number(fixture.teams?.home?.id ?? 0);
        const awayTeamId = Number(fixture.teams?.away?.id ?? 0);
        const seasonYear = Number(fixture.league?.season ?? new Date(match_date).getFullYear());
        if (!homeTeamId || !awayTeamId || !league_id) {
          throw new Error('missing football team/league ids');
        }
        const prediction = await AdvancedPredictionEngine.generateAdvancedPrediction(
          homeTeamId,
          awayTeamId,
          league_id,
          seasonYear,
          api_game_id,
        );
        normalized = adaptFootballPrediction({
          api_game_id,
          home_team,
          away_team,
          league,
          league_id,
          match_date,
          result: prediction,
          engine_name: 'football-advanced',
        });
      } else if (sport === 'basketball') {
        const result = await BasketballPredictionEngine.generatePrediction(api_game_id, basketballApi);
        normalized = adaptSportResult({ sport, api_game_id, home_team, away_team, league, league_id, match_date, result, engine_name: 'basketball-ensemble' });
      } else if (sport === 'hockey') {
        const result = await HockeyPredictionEngine.generatePrediction(api_game_id, hockeyApi);
        normalized = adaptSportResult({ sport, api_game_id, home_team, away_team, league, league_id, match_date, result, engine_name: 'hockey-ensemble' });
      } else if (sport === 'handball') {
        const result = await HandballPredictionEngine.generatePrediction(api_game_id, handballApi);
        normalized = adaptSportResult({ sport, api_game_id, home_team, away_team, league, league_id, match_date, result, engine_name: 'handball-ensemble' });
      } else if (sport === 'volleyball') {
        const result = await VolleyballPredictionEngine.generatePrediction(api_game_id, volleyballApi);
        normalized = adaptSportResult({ sport, api_game_id, home_team, away_team, league, league_id, match_date, result, engine_name: 'volleyball-ensemble' });
      } else if (sport === 'baseball') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { BaseballPredictionEngine } = require('@/lib/sports/baseball/prediction-engine');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { baseballApi } = require('@/lib/sports/baseball/api-baseball');
          const result = await BaseballPredictionEngine.generatePrediction(api_game_id, baseballApi);
          normalized = adaptSportResult({ sport, api_game_id, home_team, away_team, league, league_id, match_date, result, engine_name: 'baseball-ensemble' });
        } catch (err) {
          console.error(`[daily-runner] baseball engine not available:`, err);
        }
      }

      if (normalized && normalized.picks.length > 0) {
        const res = await persistPrediction(normalized);
        out.predictions_saved++;
        out.picks_saved += res.picks_saved + res.player_props_saved;
      }

      if (opts.snapshot) {
        try {
          const snap = await snapshotOdds(sport, api_game_id);
          out.odds_snapshots += snap.snapshots_written;
        } catch (err) {
          // Non-fatal; many games have no odds yet.
        }
      }
    } catch (err) {
      out.errors.push({
        api_game_id: fixture.id ?? fixture.fixture?.id ?? 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

/**
 * Main orchestrator. Does not throw — errors are collected per sport.
 */
export async function runDailyPipeline(opts: DailyRunnerOptions = {}): Promise<DailyRunnerResult> {
  const date = opts.date ?? today();
  const sports = opts.sports ?? DEFAULT_SPORTS;
  const max = opts.max_per_sport ?? 100;
  const snapshot = opts.snapshot_odds ?? true;
  const run_type = opts.run_type ?? 'daily';

  const run = await prisma.prediction_runs.create({
    data: {
      run_type,
      target_date: new Date(date + 'T00:00:00Z'),
      target_sports: sports as any,
      status: 'running',
    },
  });

  const by_sport: DailyRunnerResult['by_sport'] = [];
  for (const sport of sports) {
    const result = await runSport(sport, { date, max, snapshot });
    by_sport.push(result);
  }

  const finished_at = new Date();
  const totalPreds = by_sport.reduce((s, x) => s + x.predictions_saved, 0);
  const totalPicks = by_sport.reduce((s, x) => s + x.picks_saved, 0);
  const totalSnap = by_sport.reduce((s, x) => s + x.odds_snapshots, 0);
  const totalErrors = by_sport.reduce((s, x) => s + x.errors.length, 0);
  const status: DailyRunnerResult['status'] = totalErrors === 0 ? 'completed' : totalPreds > 0 ? 'partial' : 'failed';

  await prisma.prediction_runs.update({
    where: { id: run.id },
    data: {
      status,
      finished_at,
      fixtures_scanned: by_sport.reduce((s, x) => s + x.fixtures_scanned, 0),
      predictions_saved: totalPreds,
      picks_saved: totalPicks,
      odds_snapshots: totalSnap,
      errors: by_sport.map(s => ({ sport: s.sport, errors: s.errors })) as any,
    },
  });

  return {
    run_id: run.id,
    started_at: run.started_at,
    finished_at,
    status,
    by_sport,
    total_predictions: totalPreds,
    total_picks: totalPicks,
    total_snapshots: totalSnap,
  };
}
