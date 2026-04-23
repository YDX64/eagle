/**
 * Shared helper that turns a player projection (mean, std dev, distribution)
 * into one or more PlayerPropLine objects across a fixed list of book lines.
 *
 * Usage (from each sport generator):
 *   const lines = buildLinesForPlayer({...});
 *   emitted.push(...lines);
 */

import type { ConfidenceTier } from '@/lib/tracking/types';
import {
  buildMarketCode,
  classifyConfidence,
  getTurkishMarketLabel,
  type PlayerPropFactors,
  type PlayerPropLine,
  type PlayerPropMarket,
  type SportPrefix,
  type StatDistribution,
} from './types';
import { getOverProbability } from './stat-distributions';

export interface BuildLinesInput {
  sport_prefix: SportPrefix;
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  market: PlayerPropMarket;
  distribution: StatDistribution;
  projected_mean: number;
  projected_std_dev: number;
  book_lines: readonly number[];
  factors: PlayerPropFactors;
  /**
   * Turkish reasoning string template. Receives (line, side, over_prob) and
   * returns the full Turkish sentence for PlayerPropLine.reasoning.
   */
  reasoning_builder: (args: {
    line: number;
    side: 'OVER' | 'UNDER';
    prob: number;
    mean: number;
  }) => string;
  /**
   * Only emit lines where over_prob stays inside this range. Default is
   * [0.35, 0.75] per the spec — outside of that the pick is either
   * uninformative (coin-flip is still <0.55 confidence) or extreme enough
   * that it's probably a model artefact rather than a real edge.
   */
  over_prob_range?: [number, number];
  /** Minimum confidence to emit (default 0.55 = silver threshold). */
  min_confidence?: number;
}

/**
 * Build a list of PlayerPropLine objects for a single player × market pair.
 *
 * For every book line in `book_lines` we compute over_prob via the chosen
 * distribution, then:
 *   - If over_prob ∈ [35%, 75%] we emit one line (picking the stronger side).
 *   - Otherwise we skip it (too lopsided or too near coin-flip to be useful).
 *   - We also require confidence ≥ silver threshold (0.55) to avoid noise.
 */
export function buildLinesForPlayer(input: BuildLinesInput): PlayerPropLine[] {
  const {
    sport_prefix,
    player_id,
    player_name,
    team_id,
    team_name,
    position,
    market,
    distribution,
    projected_mean,
    projected_std_dev,
    book_lines,
    factors,
    reasoning_builder,
  } = input;

  const [lowP, highP] = input.over_prob_range ?? [0.35, 0.75];
  const minConfidence = input.min_confidence ?? 0.55;

  const lines: PlayerPropLine[] = [];
  const marketLabel = getTurkishMarketLabel(market);

  for (const line of book_lines) {
    const over = getOverProbability(projected_mean, projected_std_dev, line, distribution);
    const under = 1 - over;

    // Skip lines where we have no edge / no informative side to recommend.
    if (over < lowP || over > highP) continue;

    // Pick the stronger side — the one whose probability is >= 0.5.
    // If over=0.5 exactly we default to OVER (arbitrary; won't happen often).
    const pickOver = over >= 0.5;
    const confidence = pickOver ? over : under;
    if (confidence < minConfidence) continue;

    const tier: ConfidenceTier | null = classifyConfidence(confidence);
    if (!tier) continue;

    const selection: 'OVER' | 'UNDER' = pickOver ? 'OVER' : 'UNDER';
    const market_code = buildMarketCode(sport_prefix, market, line, selection);

    const sideLabel = pickOver ? 'üstü' : 'altı';
    const recommendation = `${player_name} ${line} ${sideLabel}`;

    lines.push({
      player_id,
      player_name,
      team_id,
      team_name,
      position,
      market,
      market_code,
      market_label: marketLabel,
      line,
      selection,
      over_prob: round4(over),
      under_prob: round4(under),
      recommendation,
      confidence: round4(confidence),
      confidence_tier: tier,
      reasoning: reasoning_builder({ line, side: selection, prob: confidence, mean: projected_mean }),
      factors,
    });
  }

  return lines;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
