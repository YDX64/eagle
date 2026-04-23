/**
 * Market-Anchored Bayesian Prediction
 *
 * Felsefe: Piyasa (bookmaker consensus) = Bayesian prior.
 * İstatistiksel model sadece ±5% küçük düzeltme yapabilir.
 * Piyasaya "daha iyi biliyorum" iddia etme imkansız olmalı.
 *
 * Pipeline:
 *   1. Bookmaker'lardan tüm oranları topla
 *   2. Overround'u düzelt (bookmaker marjı çıkar)
 *   3. Multi-bookmaker consensus prior hesapla
 *   4. Model predictionı ±5% içinde clamp et
 *   5. Uncertainty penalty uygula
 *   6. Final probability döndür (veya REJECT)
 */

/**
 * Fair probability: bookmaker'ın overround'u çıkarılmış implied probability
 *
 * Bookmaker odds genelde 100+%'ye ekleniyor (overround = vig/margin).
 * Gerçek fair probability'yi bulmak için her leg'i toplam implied'a böl.
 *
 * Ex: H/D/A odds = 2.00/3.50/4.00
 *   implied = 0.50 / 0.286 / 0.25 = 1.036 toplam
 *   fair = 0.50/1.036, 0.286/1.036, 0.25/1.036 = 0.483, 0.276, 0.241
 */
export function removeOverround(oddsSet: number[]): number[] {
  if (oddsSet.length === 0) return [];
  const impliedSum = oddsSet.reduce((sum, o) => sum + 1 / o, 0);
  if (impliedSum <= 0) return oddsSet.map(() => 0);
  return oddsSet.map(o => 1 / o / impliedSum);
}

/**
 * Tek bir market/selection için market consensus hesapla
 * Bookmaker'lar arasında geometrik ortalama (daha robust)
 */
export interface MarketConsensus {
  fairProb: number;        // Ortalama fair probability
  bookmakerCount: number;  // Kaç bookmaker kote etti
  spread: number;          // Bookmaker'lar arası standart sapma
  minFair: number;
  maxFair: number;
  median: number;
  highConsensus: boolean;  // Tüm bookmakerlar yakın mı?
}

/**
 * Bookmaker oranlarından fair consensus oluştur.
 * Tek bir selection için (örn "Home" in 1X2 market).
 *
 * Input: array of {oddsForThisSelection, allOddsInSameMarket}
 *   - oddsForThisSelection: bookmaker'ın bu seçim için verdiği oran
 *   - allOddsInSameMarket: aynı bookmaker'ın aynı market için tüm oranları (overround hesabı için)
 */
export function calculateMarketConsensus(
  bookmakerQuotes: { selectionOdds: number; allMarketOdds: number[] }[]
): MarketConsensus {
  if (bookmakerQuotes.length === 0) {
    return {
      fairProb: 0, bookmakerCount: 0, spread: 0,
      minFair: 0, maxFair: 0, median: 0, highConsensus: false,
    };
  }

  const fairProbs: number[] = [];

  for (const q of bookmakerQuotes) {
    if (q.selectionOdds < 1.01) continue;
    const noOverround = removeOverround(q.allMarketOdds);
    const idx = q.allMarketOdds.indexOf(q.selectionOdds);
    if (idx >= 0 && idx < noOverround.length) {
      fairProbs.push(noOverround[idx]);
    } else {
      // Fallback: sadece implied
      fairProbs.push(1 / q.selectionOdds);
    }
  }

  if (fairProbs.length === 0) {
    return {
      fairProb: 0, bookmakerCount: 0, spread: 0,
      minFair: 0, maxFair: 0, median: 0, highConsensus: false,
    };
  }

  const mean = fairProbs.reduce((a, b) => a + b, 0) / fairProbs.length;
  const variance = fairProbs.reduce((a, b) => a + (b - mean) ** 2, 0) / fairProbs.length;
  const std = Math.sqrt(variance);

  const sorted = [...fairProbs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const minFair = sorted[0];
  const maxFair = sorted[sorted.length - 1];

  // High consensus: tüm bookmaker'lar ortalamanın ±3% içinde
  const highConsensus = std < 0.03;

  return {
    fairProb: mean,
    bookmakerCount: fairProbs.length,
    spread: std,
    minFair,
    maxFair,
    median,
    highConsensus,
  };
}

/**
 * Uncertainty / Confidence Factor hesaplama
 *
 * Multi-factor: her faktör confidence'ı azaltır.
 * Başlangıç: 1.0. Her olumsuz sinyal çarpan uygular.
 *
 * Output: [0, 1]. 1 = mükemmel güven. 0 = kullanma.
 */
export interface UncertaintyParams {
  sampleSize?: number;        // Takımın analiz edildiği maç sayısı
  marketSpread?: number;      // Bookmaker'lar arası std (0-0.3 tipik)
  bookmakerCount?: number;    // Kaç bookmaker oran verdi
  dataFreshness?: number;     // 0-1: 1 = güncel, 0 = çok eski
  leagueTier?: 'top' | 'mid' | 'low'; // Lig kalitesi
  modelDisagreement?: number; // |model - market| fazlaysa azalt (0-1)
}

export function calculateUncertaintyFactor(p: UncertaintyParams): number {
  let confidence = 1.0;

  // Sample size: en az 10 maç verisi olsun
  if (p.sampleSize !== undefined) {
    if (p.sampleSize < 5) confidence *= 0.5;
    else if (p.sampleSize < 10) confidence *= 0.75;
    else if (p.sampleSize < 20) confidence *= 0.9;
  }

  // Market spread: bookmaker'lar farklı düşünüyorsa belirsizlik yüksek
  if (p.marketSpread !== undefined) {
    if (p.marketSpread > 0.05) confidence *= 0.7;
    else if (p.marketSpread > 0.03) confidence *= 0.85;
    else if (p.marketSpread > 0.015) confidence *= 0.95;
  }

  // Bookmaker count: en az 3 bookmaker olsun
  if (p.bookmakerCount !== undefined) {
    if (p.bookmakerCount < 2) confidence *= 0.5;
    else if (p.bookmakerCount < 3) confidence *= 0.75;
  }

  // Data freshness
  if (p.dataFreshness !== undefined) {
    confidence *= Math.max(0.5, p.dataFreshness);
  }

  // League tier
  if (p.leagueTier === 'low') confidence *= 0.8;
  else if (p.leagueTier === 'mid') confidence *= 0.95;

  // Model disagreement: model ve market çok farklıysa model muhtemelen yanılıyor
  if (p.modelDisagreement !== undefined) {
    if (p.modelDisagreement > 0.10) confidence *= 0.6;
    else if (p.modelDisagreement > 0.05) confidence *= 0.85;
  }

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Market-Anchored Posterior Probability
 *
 * Bayesian güncellemenin sadeleştirilmiş hali:
 *   posterior = prior + clamp(model - prior, -maxAdjust, +maxAdjust)
 *
 * Sonra uncertainty penalty uygulanır.
 *
 * maxAdjustment: model'in prior'dan ne kadar sapabileceği. Default ±5%.
 *   Bu kritik — çok büyük değer overconfidence yaratır, çok küçük model faydasız.
 */
export interface PosteriorParams {
  marketPrior: number;        // 0-1, piyasa consensus
  modelProb: number;          // 0-1, istatistiksel model çıktısı
  uncertaintyFactor: number;  // 0-1, confidence multiplier
  maxAdjustment?: number;     // Default 0.05 (5%)
}

export function marketAnchoredPosterior(p: PosteriorParams): {
  posterior: number;
  priorWeight: number;
  modelWeight: number;
  adjustment: number;
} {
  const maxAdjust = p.maxAdjustment ?? 0.05;

  if (p.marketPrior <= 0 || p.marketPrior >= 1) {
    return { posterior: 0, priorWeight: 1, modelWeight: 0, adjustment: 0 };
  }

  const rawAdjustment = p.modelProb - p.marketPrior;
  const clampedAdjustment = Math.max(-maxAdjust, Math.min(maxAdjust, rawAdjustment));

  // Uncertainty shrinks the adjustment toward 0
  // Low confidence = rely more on market, not model
  const effectiveAdjustment = clampedAdjustment * p.uncertaintyFactor;

  const posterior = p.marketPrior + effectiveAdjustment;

  return {
    posterior: Math.max(0.01, Math.min(0.99, posterior)),
    priorWeight: 1 - p.uncertaintyFactor,
    modelWeight: p.uncertaintyFactor,
    adjustment: effectiveAdjustment,
  };
}

/**
 * Quality-First Bet Qualification
 *
 * Quality-First hedefi: Az sayıda, yüksek güvenli, +ROI bahis.
 * Eşikler screenshotta %16 tutan mevcut sistemi eleyecek, %55-60 hedef.
 */
export interface QualityFirstCriteria {
  // Min values (0-1)
  minMarketPrior: number;       // Piyasa da favori demeli. Default 0.55
  minPosterior: number;          // Final olasılık. Default 0.58
  maxOdds: number;               // Çok yüksek oran = gerçek risk. Default 2.20
  minOdds: number;               // Default 1.60
  // Max values
  maxEdge: number;               // Big edge = trap/bug. Default 0.05 (5%)
  maxMarketSpread: number;       // Bookmaker ayrılığı. Default 0.04
  // Min confidence
  minConfidence: number;         // Default 0.75
  minBookmakers: number;         // Default 3
}

export const QUALITY_FIRST_DEFAULTS: QualityFirstCriteria = {
  minMarketPrior: 0.55,
  minPosterior: 0.58,
  maxOdds: 2.20,
  minOdds: 1.60,
  maxEdge: 0.05,
  maxMarketSpread: 0.04,
  minConfidence: 0.75,
  minBookmakers: 3,
};

export interface QualificationResult {
  qualified: boolean;
  reason?: string;
  // Full breakdown for debugging/transparency
  breakdown: {
    odds: number;
    impliedProb: number;
    marketPrior: number;
    modelProb: number;
    posterior: number;
    edge: number;
    confidence: number;
    marketSpread: number;
    bookmakerCount: number;
  };
}

export function qualifyBet(params: {
  odds: number;
  modelProb: number;
  consensus: MarketConsensus;
  uncertainty: UncertaintyParams;
  criteria?: Partial<QualityFirstCriteria>;
}): QualificationResult {
  const criteria: QualityFirstCriteria = { ...QUALITY_FIRST_DEFAULTS, ...params.criteria };

  const impliedProb = 1 / params.odds;
  const uncertaintyFactor = calculateUncertaintyFactor(params.uncertainty);

  const { posterior } = marketAnchoredPosterior({
    marketPrior: params.consensus.fairProb,
    modelProb: params.modelProb,
    uncertaintyFactor,
    maxAdjustment: 0.05,
  });

  const edge = (posterior - impliedProb) / impliedProb;

  const breakdown = {
    odds: params.odds,
    impliedProb,
    marketPrior: params.consensus.fairProb,
    modelProb: params.modelProb,
    posterior,
    edge,
    confidence: uncertaintyFactor,
    marketSpread: params.consensus.spread,
    bookmakerCount: params.consensus.bookmakerCount,
  };

  // Filter pipeline
  if (params.odds < criteria.minOdds) {
    return { qualified: false, reason: `Odds ${params.odds} below min ${criteria.minOdds}`, breakdown };
  }
  if (params.odds > criteria.maxOdds) {
    return { qualified: false, reason: `Odds ${params.odds} above max ${criteria.maxOdds} (too risky)`, breakdown };
  }
  if (params.consensus.fairProb < criteria.minMarketPrior) {
    return { qualified: false, reason: `Market prior ${(params.consensus.fairProb * 100).toFixed(1)}% below ${(criteria.minMarketPrior * 100).toFixed(0)}%`, breakdown };
  }
  if (posterior < criteria.minPosterior) {
    return { qualified: false, reason: `Posterior ${(posterior * 100).toFixed(1)}% below ${(criteria.minPosterior * 100).toFixed(0)}%`, breakdown };
  }
  if (edge > criteria.maxEdge) {
    return { qualified: false, reason: `Edge ${(edge * 100).toFixed(1)}% too high (likely bug/trap)`, breakdown };
  }
  if (edge < 0) {
    return { qualified: false, reason: `Negative edge ${(edge * 100).toFixed(1)}%`, breakdown };
  }
  if (params.consensus.spread > criteria.maxMarketSpread) {
    return { qualified: false, reason: `Bookmakers disagree (spread ${(params.consensus.spread * 100).toFixed(1)}% > ${(criteria.maxMarketSpread * 100).toFixed(0)}%)`, breakdown };
  }
  if (uncertaintyFactor < criteria.minConfidence) {
    return { qualified: false, reason: `Confidence ${(uncertaintyFactor * 100).toFixed(1)}% below ${(criteria.minConfidence * 100).toFixed(0)}%`, breakdown };
  }
  if (params.consensus.bookmakerCount < criteria.minBookmakers) {
    return { qualified: false, reason: `Only ${params.consensus.bookmakerCount} bookmaker(s), need ${criteria.minBookmakers}+`, breakdown };
  }

  return { qualified: true, breakdown };
}
