
import { ValueBet, SportType } from './types';

/**
 * Cross-sport value bet scanner
 * Scans all sports for high-value betting opportunities
 */
export class ValueScanner {

  /**
   * Filter and rank value bets across all sports
   * Only returns bets with positive expected value and minimum edge
   */
  static filterHighValueBets(
    allBets: ValueBet[],
    options: {
      minEdge?: number;        // Minimum value edge (default 5%)
      minConfidence?: number;  // Minimum confidence score (default 50)
      maxBets?: number;        // Maximum bets to return (default 20)
      sports?: SportType[];    // Filter by sport
      tiers?: string[];        // Filter by tier
    } = {}
  ): ValueBet[] {
    const {
      minEdge = 5,
      minConfidence = 50,
      maxBets = 20,
      sports,
      tiers,
    } = options;

    let filtered = allBets.filter((bet) => {
      if (bet.value_edge < minEdge) return false;
      if (bet.confidence_score < minConfidence) return false;
      if (bet.expected_value <= 0) return false;
      if (sports && !sports.includes(bet.sport)) return false;
      if (tiers && !tiers.includes(bet.confidence_tier)) return false;
      return true;
    });

    // Sort by expected value * confidence (best value first)
    filtered.sort((a, b) => {
      // Platinum > Gold > Silver
      const tierOrder: Record<string, number> = { platinum: 3, gold: 2, silver: 1 };
      const tierDiff = (tierOrder[b.confidence_tier] || 0) - (tierOrder[a.confidence_tier] || 0);
      if (tierDiff !== 0) return tierDiff;

      // Then by expected value
      return b.expected_value - a.expected_value;
    });

    return filtered.slice(0, maxBets);
  }

  /**
   * Generate a summary of value bets grouped by sport
   */
  static generateSummary(bets: ValueBet[]) {
    const bySport: Record<string, ValueBet[]> = {};
    const byTier: Record<string, ValueBet[]> = {};

    bets.forEach((bet) => {
      if (!bySport[bet.sport]) bySport[bet.sport] = [];
      bySport[bet.sport].push(bet);

      if (!byTier[bet.confidence_tier]) byTier[bet.confidence_tier] = [];
      byTier[bet.confidence_tier].push(bet);
    });

    return {
      total_bets: bets.length,
      by_sport: Object.entries(bySport).map(([sport, sportBets]) => ({
        sport,
        count: sportBets.length,
        avg_edge: Math.round(sportBets.reduce((s, b) => s + b.value_edge, 0) / sportBets.length * 100) / 100,
        avg_ev: Math.round(sportBets.reduce((s, b) => s + b.expected_value, 0) / sportBets.length * 100) / 100,
        total_kelly: Math.round(sportBets.reduce((s, b) => s + b.kelly_percentage, 0) * 100) / 100,
      })),
      by_tier: Object.entries(byTier).map(([tier, tierBets]) => ({
        tier,
        count: tierBets.length,
        avg_confidence: Math.round(tierBets.reduce((s, b) => s + b.confidence_score, 0) / tierBets.length),
      })),
      top_picks: bets.slice(0, 5).map((b) => ({
        sport: b.sport,
        match: `${b.home_team} vs ${b.away_team}`,
        market: b.market,
        selection: b.selection,
        edge: b.value_edge,
        ev: b.expected_value,
        tier: b.confidence_tier,
      })),
    };
  }
}
