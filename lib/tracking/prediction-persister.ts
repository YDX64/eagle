/**
 * Prediction persister — writes normalized engine output to the production
 * `predictions` + `picks` + `system_bets` + `pattern_matches` + `player_prop_picks`
 * tables in a single transaction.
 *
 * Prediction ID convention: `{sport}:{api_game_id}` (matches legacy production data).
 */

import { prisma } from '@/lib/db';
import type { NormalizedPrediction, NormalizedPick, NormalizedPlayerProp } from './types';

export interface PersistResult {
  prediction_id: string;
  created: boolean;
  picks_saved: number;
  system_bets_saved: number;
  patterns_saved: number;
  player_props_saved: number;
}

/**
 * Build the prediction id from sport + game id.
 * Keeps compatibility with existing production data like "football:1461897".
 */
export function buildPredictionId(sport: string, api_game_id: number): string {
  return `${sport}:${api_game_id}`;
}

/**
 * Pick the "best" pick across the supplied list. Preference order:
 *  1. is_best flag if any engine explicitly marked one
 *  2. highest expected_value if known
 *  3. highest probability
 */
function selectBestPick(picks: NormalizedPick[]): NormalizedPick | undefined {
  if (!picks || picks.length === 0) return undefined;
  const marked = picks.find(p => p.is_best);
  if (marked) return marked;
  const withEV = picks.filter(p => typeof p.expected_value === 'number');
  if (withEV.length > 0) {
    return withEV.reduce((a, b) => ((a.expected_value ?? -Infinity) >= (b.expected_value ?? -Infinity) ? a : b));
  }
  return picks.reduce((a, b) => (a.probability >= b.probability ? a : b));
}

/**
 * Upsert a normalized prediction plus all its picks/system_bets/patterns/props.
 * Previous child rows for the same prediction_id are replaced atomically.
 */
export async function persistPrediction(pred: NormalizedPrediction): Promise<PersistResult> {
  const id = buildPredictionId(pred.sport, pred.api_game_id);
  const matchDate = typeof pred.match_date === 'string' ? new Date(pred.match_date) : pred.match_date;
  const best = selectBestPick(pred.picks);

  const existing = await prisma.predictions.findUnique({ where: { id } });

  const basePayload = {
    sport: pred.sport,
    fixture_id: pred.api_game_id,
    home_team: pred.home_team ?? null,
    away_team: pred.away_team ?? null,
    league: pred.league ?? null,
    match_date: matchDate ?? null,
    home_win_prob: pred.home_win_prob ?? null,
    draw_prob: pred.draw_prob ?? null,
    away_win_prob: pred.away_win_prob ?? null,
    confidence: pred.confidence ?? null,
    best_market: best?.market ?? null,
    best_pick_label: best?.pick_label ?? best?.market_label ?? null,
    best_probability: best?.probability ?? null,
    best_market_odds: best?.market_odds ?? null,
    best_expected_value: best?.expected_value ?? null,
    payload: {
      engine_name: pred.engine_name,
      engine_version: pred.engine_version,
      league_id: pred.league_id,
      raw: pred.raw_payload ?? null,
      saved_at: new Date().toISOString(),
    } as any,
  };

  await prisma.$transaction(async tx => {
    if (existing) {
      await tx.predictions.update({
        where: { id },
        data: basePayload,
      });
      await tx.picks.deleteMany({ where: { prediction_id: id } });
      await tx.system_bets.deleteMany({ where: { prediction_id: id } });
      await tx.pattern_matches.deleteMany({ where: { prediction_id: id } });
      await tx.player_prop_picks.deleteMany({ where: { prediction_id: id } });
    } else {
      await tx.predictions.create({
        data: {
          id,
          status: 'pending',
          ...basePayload,
        },
      });
    }

    if (pred.picks.length > 0) {
      await tx.picks.createMany({
        data: pred.picks.map(p => ({
          prediction_id: id,
          market: p.market,
          market_label: p.market_label ?? null,
          pick_label: p.pick_label ?? null,
          category: p.category ?? null,
          probability: p.probability ?? null,
          market_odds: p.market_odds ?? null,
          expected_value: p.expected_value ?? null,
          is_best: p === best,
          is_high_confidence: p.is_high_confidence ?? false,
          score_value: p.score_value ?? null,
        })),
      });
    }

    if (pred.system_bets && pred.system_bets.length > 0) {
      await tx.system_bets.createMany({
        data: pred.system_bets.map(b => ({
          prediction_id: id,
          market: b.market,
          pick_label: b.pick_label ?? null,
          model_probability: b.model_probability ?? null,
          market_odds: b.market_odds ?? null,
          expected_value: b.expected_value ?? null,
          kelly_stake: b.kelly_stake ?? null,
          risk_level: b.risk_level ?? null,
          category: b.category ?? null,
        })),
      });
    }

    if (pred.patterns && pred.patterns.length > 0) {
      await tx.pattern_matches.createMany({
        data: pred.patterns.map(p => ({
          prediction_id: id,
          pattern_id: p.pattern_id,
          pattern_name: p.pattern_name ?? null,
          pattern_category: p.pattern_category ?? null,
          hit_rate: p.hit_rate ?? null,
          sample_size: p.sample_size ?? null,
          is_banko: p.is_banko ?? false,
          predicted_market: p.predicted_market ?? null,
        })),
      });
    }

    if (pred.player_props && pred.player_props.length > 0) {
      await tx.player_prop_picks.createMany({
        data: pred.player_props.map(pp => ({
          sport: pred.sport,
          api_game_id: pred.api_game_id,
          prediction_id: id,
          player_id: pp.player_id,
          player_name: pp.player_name,
          team_id: pp.team_id ?? null,
          team_name: pp.team_name ?? null,
          position: pp.position ?? null,
          market: pp.market,
          market_label: pp.market_label ?? null,
          line: pp.line,
          selection: pp.selection,
          pick_label: pp.pick_label ?? null,
          probability: pp.probability,
          market_odds: pp.market_odds ?? null,
          expected_value: pp.expected_value ?? null,
          is_high_confidence: pp.is_high_confidence ?? false,
          is_best: pp.is_best ?? false,
          category: pp.category ?? null,
          confidence_tier: pp.confidence_tier ?? null,
          reasoning: pp.reasoning ?? null,
          factors_used: (pp.factors_used ?? null) as any,
        })),
      });
    }
  });

  return {
    prediction_id: id,
    created: !existing,
    picks_saved: pred.picks.length,
    system_bets_saved: pred.system_bets?.length ?? 0,
    patterns_saved: pred.patterns?.length ?? 0,
    player_props_saved: pred.player_props?.length ?? 0,
  };
}

/**
 * Persist a batch of predictions, streaming results for long-running cron jobs.
 * Errors on one prediction don't block the others — they are returned in `errors`.
 */
export async function persistPredictionBatch(
  preds: NormalizedPrediction[],
): Promise<{ results: PersistResult[]; errors: Array<{ sport: string; api_game_id: number; error: string }> }> {
  const results: PersistResult[] = [];
  const errors: Array<{ sport: string; api_game_id: number; error: string }> = [];
  for (const p of preds) {
    try {
      const r = await persistPrediction(p);
      results.push(r);
    } catch (err) {
      errors.push({
        sport: p.sport,
        api_game_id: p.api_game_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { results, errors };
}

/** Upsert a row in `sport_games` so every sport's game data lives in one place. */
export async function upsertSportGame(args: {
  sport: string;
  api_game_id: number;
  league_id?: number;
  league_name?: string;
  league_country?: string;
  season?: string;
  game_date: Date | string;
  timestamp?: number;
  status_short?: string;
  status_long?: string;
  status_elapsed?: number;
  home_team_id?: number;
  home_team_name: string;
  home_team_logo?: string;
  away_team_id?: number;
  away_team_name: string;
  away_team_logo?: string;
  home_score?: number | null;
  away_score?: number | null;
  home_score_ht?: number | null;
  away_score_ht?: number | null;
  raw_scores?: unknown;
  venue_name?: string;
  venue_city?: string;
  raw_fixture?: unknown;
}) {
  const id = `${args.sport}:${args.api_game_id}`;
  const game_date = typeof args.game_date === 'string' ? new Date(args.game_date) : args.game_date;
  const data = {
    sport: args.sport,
    api_game_id: args.api_game_id,
    league_id: args.league_id ?? null,
    league_name: args.league_name ?? null,
    league_country: args.league_country ?? null,
    season: args.season ?? null,
    game_date,
    timestamp: args.timestamp ?? null,
    status_short: args.status_short ?? null,
    status_long: args.status_long ?? null,
    status_elapsed: args.status_elapsed ?? null,
    home_team_id: args.home_team_id ?? null,
    home_team_name: args.home_team_name,
    home_team_logo: args.home_team_logo ?? null,
    away_team_id: args.away_team_id ?? null,
    away_team_name: args.away_team_name,
    away_team_logo: args.away_team_logo ?? null,
    home_score: args.home_score ?? null,
    away_score: args.away_score ?? null,
    home_score_ht: args.home_score_ht ?? null,
    away_score_ht: args.away_score_ht ?? null,
    raw_scores: (args.raw_scores ?? null) as any,
    venue_name: args.venue_name ?? null,
    venue_city: args.venue_city ?? null,
    raw_fixture: (args.raw_fixture ?? null) as any,
  };
  return prisma.sport_games.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
}
