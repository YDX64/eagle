/**
 * Risk Tier Sınıflandırma
 *
 * Eagle `advanced-prediction-engine.ts` risk sınıflandırma mantığının
 * all-sports mimarisine uyarlanmış versiyonu.
 *
 * Tier'lar:
 *   - Platinum: Çok yüksek güven, çok düşük risk. Tek maç bahsi için ideal.
 *   - Gold:     Yüksek güven, düşük risk. Banko/ikili kupon.
 *   - Silver:   Orta güven. 3'lü kombinasyon.
 *   - Bronze:   Düşük güven. Sadece değer bahsi kombine edilirse.
 *   - Reject:   Kriterleri karşılamıyor.
 */

import type { MarketConsensus } from './marketAnchored';

export type RiskTier = 'platinum' | 'gold' | 'silver' | 'bronze' | 'reject';

export interface RiskTierInput {
  trueProbability: number;          // 0-1, ensemble sonrası
  edge: number;                     // (true - implied) / implied
  odds: number;
  consensus?: MarketConsensus;      // Market anchor bilgisi
  statsVaultConfidence?: number;    // 0-1, StatsVault onayı (varsa)
  sourceCount: number;              // Ensemble'a giren kaynak sayısı
  agreementScore?: number;          // 0-1, kaynaklar ne kadar aynı fikirde
}

export interface RiskTierResult {
  tier: RiskTier;
  score: number;                    // 0-100, risk-adjusted composite
  reason: string;
  breakdown: {
    trueProbability: number;
    edge: number;
    bookmakerCount: number;
    marketSpread: number;
    sourceCount: number;
    agreementScore: number;
    statsVaultBonus: number;
  };
}

/**
 * Platinum eşikleri: en katı.
 * - trueProb >= 0.85
 * - edge >= 0.08 (ama < 0.25 — çok büyük edge = bug/trap)
 * - bookmakerCount >= 5
 * - marketSpread < 0.03
 * - sourceCount >= 3 (model + market + statsVault)
 * - agreementScore >= 0.85 (kaynaklar yakın)
 */
const PLATINUM_THRESHOLDS = {
  minTrueProb: 0.85,
  minEdge: 0.08,
  maxEdge: 0.25,
  minBookmakerCount: 5,
  maxMarketSpread: 0.03,
  minSourceCount: 3,
  minAgreement: 0.85,
};

const GOLD_THRESHOLDS = {
  minTrueProb: 0.75,
  minEdge: 0.05,
  maxEdge: 0.30,
  minBookmakerCount: 3,
  maxMarketSpread: 0.05,
  minSourceCount: 2,
  minAgreement: 0.70,
};

const SILVER_THRESHOLDS = {
  minTrueProb: 0.65,
  minEdge: 0.03,
  maxEdge: 0.40,
  minBookmakerCount: 2,
  maxMarketSpread: 0.08,
  minSourceCount: 2,
  minAgreement: 0.55,
};

const BRONZE_THRESHOLDS = {
  minTrueProb: 0.55,
  minEdge: 0.02,
  maxEdge: 0.50,
  minBookmakerCount: 1,
  maxMarketSpread: 0.12,
  minSourceCount: 1,
  minAgreement: 0.0,
};

/**
 * Risk tier hesapla. En yüksek kriterden başlar, ilk geçeni döner.
 */
export function classifyRiskTier(input: RiskTierInput): RiskTierResult {
  const breakdown = {
    trueProbability: input.trueProbability,
    edge: input.edge,
    bookmakerCount: input.consensus?.bookmakerCount ?? 0,
    marketSpread: input.consensus?.spread ?? 1.0,
    sourceCount: input.sourceCount,
    agreementScore: input.agreementScore ?? 0.5,
    statsVaultBonus: input.statsVaultConfidence ?? 0,
  };

  // Reject: negatif edge, çok düşük prob, çok yüksek edge (trap)
  if (input.edge < 0) {
    return { tier: 'reject', score: 0, reason: `Negatif edge: ${(input.edge * 100).toFixed(1)}%`, breakdown };
  }
  if (input.trueProbability < BRONZE_THRESHOLDS.minTrueProb) {
    return {
      tier: 'reject',
      score: 0,
      reason: `True prob ${(input.trueProbability * 100).toFixed(1)}% < ${BRONZE_THRESHOLDS.minTrueProb * 100}%`,
      breakdown,
    };
  }
  if (input.edge > PLATINUM_THRESHOLDS.maxEdge && input.consensus && input.consensus.spread > 0.05) {
    return {
      tier: 'reject',
      score: 0,
      reason: `Edge ${(input.edge * 100).toFixed(1)}% çok yüksek + bookmaker ayrılığı (muhtemelen bug)`,
      breakdown,
    };
  }

  const check = (t: typeof PLATINUM_THRESHOLDS): boolean =>
    input.trueProbability >= t.minTrueProb &&
    input.edge >= t.minEdge &&
    input.edge <= t.maxEdge &&
    breakdown.bookmakerCount >= t.minBookmakerCount &&
    breakdown.marketSpread <= t.maxMarketSpread &&
    input.sourceCount >= t.minSourceCount &&
    breakdown.agreementScore >= t.minAgreement;

  let tier: RiskTier;
  let score: number;
  let reason: string;

  if (check(PLATINUM_THRESHOLDS)) {
    tier = 'platinum';
    score = 90 + (input.trueProbability - 0.85) * 100 * 0.7; // 90-100
    reason = 'Platinum: ultra yüksek güven, geniş bookmaker onayı, kaynaklar hemfikir';
  } else if (check(GOLD_THRESHOLDS)) {
    tier = 'gold';
    score = 75 + (input.trueProbability - 0.75) * 100 * 1.5; // 75-90
    reason = 'Gold: yüksek güven, sağlam market anchor';
  } else if (check(SILVER_THRESHOLDS)) {
    tier = 'silver';
    score = 60 + (input.trueProbability - 0.65) * 100 * 1.5; // 60-75
    reason = 'Silver: iyi güven, temkinli kupon kullanım';
  } else if (check(BRONZE_THRESHOLDS)) {
    tier = 'bronze';
    score = 45 + (input.trueProbability - 0.55) * 100 * 1.5; // 45-60
    reason = 'Bronze: orta güven, sadece kombinasyon için';
  } else {
    tier = 'reject';
    score = 0;
    reason = 'Kriterleri karşılamıyor';
  }

  // StatsVault yüksek confidence bonusu (uygulanabilir tier'larda)
  if (input.statsVaultConfidence && input.statsVaultConfidence >= 0.70 && tier !== 'reject') {
    score = Math.min(100, score + 5);
    reason += ` + StatsVault %${(input.statsVaultConfidence * 100).toFixed(0)} onayı`;
  }

  return { tier, score: Math.round(score), reason, breakdown };
}

/**
 * Tier görsel etiketi (UI renk kodu)
 */
export function tierColor(tier: RiskTier): string {
  switch (tier) {
    case 'platinum': return '#e5e4e2';
    case 'gold':     return '#ffd700';
    case 'silver':   return '#c0c0c0';
    case 'bronze':   return '#cd7f32';
    case 'reject':   return '#ff4040';
  }
}

/**
 * Tier Türkçe adı
 */
export function tierLabelTR(tier: RiskTier): string {
  switch (tier) {
    case 'platinum': return 'Platin';
    case 'gold':     return 'Altın';
    case 'silver':   return 'Gümüş';
    case 'bronze':   return 'Bronz';
    case 'reject':   return 'Red';
  }
}

/**
 * Kupon önerisi: tier'a göre önerilen stake yüzdesi (bankroll %)
 */
export function suggestedStakePercent(tier: RiskTier): number {
  switch (tier) {
    case 'platinum': return 3.0;  // %3 bankroll
    case 'gold':     return 2.0;
    case 'silver':   return 1.0;
    case 'bronze':   return 0.5;
    case 'reject':   return 0;
  }
}
