/**
 * Prediction Ensemble
 *
 * 3 kaynağı tek bir posterior olasılığa birleştirir:
 *   1. model:      Sport adapter'ın predict() sonucu (istatistiksel)
 *   2. market:     Bookmaker consensus (market-anchored, marketAnchored.ts)
 *   3. statsVault: Harici sağlayıcı predictions (opsiyonel, yüksek confidence'ta)
 *
 * Eksik kaynakların ağırlığı diğerlerine yeniden dağıtılır.
 *
 * Agreement bonusu: kaynaklar hemfikirse confidence +10%
 * Disagreement cezası: ±0.15+ ayrılık varsa confidence -20%
 *
 * Banko seçimi: ≥0.65 posterior + ≥2 kaynak onayı + spread < 0.15.
 */

import { calculateMarketConsensus, marketAnchoredPosterior, calculateUncertaintyFactor } from './marketAnchored';
import type { MarketConsensus, UncertaintyParams } from './marketAnchored';
import type { StatsVaultPrediction } from './statsVaultProvider';
import type { NormalizedOdds } from './types';

// ===== TIPLER =====
export interface ProbabilitySet {
  home: number;
  draw: number;
  away: number;
}

export type EnsembleSourceId = 'model' | 'market' | 'statsvault';

export interface EnsembleWeights {
  model: number;
  market: number;
  statsvault: number;
}

export const DEFAULT_ENSEMBLE_WEIGHTS: EnsembleWeights = {
  model: 0.45,
  market: 0.35,
  statsvault: 0.20,
};

export interface EnsembleSourceContribution {
  source: EnsembleSourceId;
  probability: number;
  weight: number;
  effectiveWeight: number;
  confidence: number;
}

export interface EnsembleResult {
  posterior: number;                           // 0-1 final probability
  sources: EnsembleSourceContribution[];
  sourceCount: number;
  agreementScore: number;                      // 0-1, 1 = identical
  disagreementSpread: number;                  // max - min across sources
  confidence: number;                          // 0-1
  banko: boolean;                              // Bu seçim banko kalitesinde mi?
  warnings: string[];
}

// ===== YARDIMCILAR =====

/** Ağırlıkları eksik kaynağa göre yeniden dağıtır (toplam = 1) */
function redistributeWeights(
  available: Record<EnsembleSourceId, boolean>,
  base: EnsembleWeights
): EnsembleWeights {
  const ids: EnsembleSourceId[] = ['model', 'market', 'statsvault'];
  const activeIds = ids.filter(id => available[id]);
  if (activeIds.length === 0) return { model: 0, market: 0, statsvault: 0 };

  const activeSum = activeIds.reduce((s, id) => s + base[id], 0);
  if (activeSum <= 0) {
    // Eşit dağıt
    const w = 1 / activeIds.length;
    return {
      model: available.model ? w : 0,
      market: available.market ? w : 0,
      statsvault: available.statsvault ? w : 0,
    };
  }

  return {
    model: available.model ? base.model / activeSum : 0,
    market: available.market ? base.market / activeSum : 0,
    statsvault: available.statsvault ? base.statsvault / activeSum : 0,
  };
}

/** Kaynaklar arası uyum skoru: 1 - (max - min) */
function agreementScore(probs: number[]): { score: number; spread: number } {
  if (probs.length < 2) return { score: 1, spread: 0 };
  const max = Math.max(...probs);
  const min = Math.min(...probs);
  const spread = max - min;
  return { score: Math.max(0, 1 - spread * 2), spread };
}

// ===== TEKIL SEÇIM ENSEMBLE =====
/**
 * Belirli bir seçim (örn 1X2'de "Home") için 3 kaynağı birleştirir.
 *
 * marketProbability: bookmaker consensus'tan gelen fair probability
 * modelProbability: adapter predict'ten gelen olasılık
 * statsVaultProbability: StatsVault tahmininden türetilen olasılık (varsa)
 */
export function combineSelection(params: {
  modelProbability?: number;
  marketProbability?: number;
  statsVaultProbability?: number;
  statsVaultConfidence?: number;      // StatsVault'un kendi confidence'ı
  weights?: EnsembleWeights;
  uncertainty?: UncertaintyParams;
}): EnsembleResult {
  const weights = params.weights ?? DEFAULT_ENSEMBLE_WEIGHTS;

  const available: Record<EnsembleSourceId, boolean> = {
    model: params.modelProbability !== undefined && params.modelProbability !== null,
    market: params.marketProbability !== undefined && params.marketProbability !== null,
    statsvault:
      params.statsVaultProbability !== undefined &&
      params.statsVaultProbability !== null &&
      (params.statsVaultConfidence ?? 0) >= 0.5,
  };

  const effective = redistributeWeights(available, weights);
  const warnings: string[] = [];

  const contributions: EnsembleSourceContribution[] = [];
  const probs: number[] = [];

  if (available.model) {
    contributions.push({
      source: 'model',
      probability: params.modelProbability!,
      weight: weights.model,
      effectiveWeight: effective.model,
      confidence: 0.75,
    });
    probs.push(params.modelProbability!);
  } else {
    warnings.push('model tahmini yok');
  }
  if (available.market) {
    contributions.push({
      source: 'market',
      probability: params.marketProbability!,
      weight: weights.market,
      effectiveWeight: effective.market,
      confidence: 0.90,
    });
    probs.push(params.marketProbability!);
  } else {
    warnings.push('market consensus yok');
  }
  if (available.statsvault) {
    contributions.push({
      source: 'statsvault',
      probability: params.statsVaultProbability!,
      weight: weights.statsvault,
      effectiveWeight: effective.statsvault,
      confidence: params.statsVaultConfidence ?? 0.70,
    });
    probs.push(params.statsVaultProbability!);
  }

  // Ağırlıklı ortalama
  let posterior = 0;
  for (const c of contributions) {
    posterior += c.probability * c.effectiveWeight;
  }

  const { score: agreement, spread } = agreementScore(probs);

  // Confidence: uncertainty * agreement * (source count bonus)
  const uncertaintyFactor = params.uncertainty
    ? calculateUncertaintyFactor(params.uncertainty)
    : 0.85;

  const sourceCount = contributions.length;
  const sourceBonus = sourceCount >= 3 ? 1.0 : sourceCount === 2 ? 0.9 : 0.75;

  let confidence = uncertaintyFactor * agreement * sourceBonus;

  // Agreement bonus/penalty
  if (sourceCount >= 2 && spread <= 0.05) {
    confidence = Math.min(1, confidence + 0.10);
  } else if (sourceCount >= 2 && spread >= 0.15) {
    confidence = Math.max(0, confidence - 0.20);
    warnings.push(`Kaynaklar ayrıştı (spread ${(spread * 100).toFixed(1)}%)`);
  }

  // Banko kriteri
  const banko =
    posterior >= 0.65 &&
    sourceCount >= 2 &&
    spread < 0.15 &&
    confidence >= 0.70;

  return {
    posterior: Math.max(0.01, Math.min(0.99, posterior)),
    sources: contributions,
    sourceCount,
    agreementScore: agreement,
    disagreementSpread: spread,
    confidence: Math.max(0, Math.min(1, confidence)),
    banko,
    warnings,
  };
}

// ===== 1X2 DISTRIBUTION ENSEMBLE =====
/**
 * 3 seçimli market (1X2) için her seçimi ayrı ayrı birleştirir ve
 * sonra yeniden normalize eder (toplam = 1).
 */
export function combine1X2(params: {
  model?: ProbabilitySet;
  market?: ProbabilitySet;
  statsVault?: ProbabilitySet;
  statsVaultConfidence?: number;
  weights?: EnsembleWeights;
  uncertainty?: UncertaintyParams;
}): {
  posterior: ProbabilitySet;
  details: {
    home: EnsembleResult;
    draw: EnsembleResult;
    away: EnsembleResult;
  };
  overallConfidence: number;
} {
  const home = combineSelection({
    modelProbability: params.model?.home,
    marketProbability: params.market?.home,
    statsVaultProbability: params.statsVault?.home,
    statsVaultConfidence: params.statsVaultConfidence,
    weights: params.weights,
    uncertainty: params.uncertainty,
  });
  const draw = combineSelection({
    modelProbability: params.model?.draw,
    marketProbability: params.market?.draw,
    statsVaultProbability: params.statsVault?.draw,
    statsVaultConfidence: params.statsVaultConfidence,
    weights: params.weights,
    uncertainty: params.uncertainty,
  });
  const away = combineSelection({
    modelProbability: params.model?.away,
    marketProbability: params.market?.away,
    statsVaultProbability: params.statsVault?.away,
    statsVaultConfidence: params.statsVaultConfidence,
    weights: params.weights,
    uncertainty: params.uncertainty,
  });

  // Normalize (toplam 1)
  const sum = home.posterior + draw.posterior + away.posterior;
  const posterior: ProbabilitySet =
    sum > 0
      ? {
          home: home.posterior / sum,
          draw: draw.posterior / sum,
          away: away.posterior / sum,
        }
      : { home: 0.33, draw: 0.33, away: 0.34 };

  const overallConfidence =
    (home.confidence + draw.confidence + away.confidence) / 3;

  return {
    posterior,
    details: { home, draw, away },
    overallConfidence,
  };
}

// ===== 2-way market (Over/Under, BTTS) =====
export interface TwoWayProbabilities {
  yes: number; // or 'over'
  no: number;  // or 'under'
}

export function combine2Way(params: {
  model?: TwoWayProbabilities;
  market?: TwoWayProbabilities;
  statsVault?: TwoWayProbabilities;
  statsVaultConfidence?: number;
  weights?: EnsembleWeights;
  uncertainty?: UncertaintyParams;
}): {
  posterior: TwoWayProbabilities;
  details: { yes: EnsembleResult; no: EnsembleResult };
  overallConfidence: number;
} {
  const yes = combineSelection({
    modelProbability: params.model?.yes,
    marketProbability: params.market?.yes,
    statsVaultProbability: params.statsVault?.yes,
    statsVaultConfidence: params.statsVaultConfidence,
    weights: params.weights,
    uncertainty: params.uncertainty,
  });
  const no = combineSelection({
    modelProbability: params.model?.no,
    marketProbability: params.market?.no,
    statsVaultProbability: params.statsVault?.no,
    statsVaultConfidence: params.statsVaultConfidence,
    weights: params.weights,
    uncertainty: params.uncertainty,
  });

  const sum = yes.posterior + no.posterior;
  const posterior: TwoWayProbabilities =
    sum > 0
      ? { yes: yes.posterior / sum, no: no.posterior / sum }
      : { yes: 0.5, no: 0.5 };

  return {
    posterior,
    details: { yes, no },
    overallConfidence: (yes.confidence + no.confidence) / 2,
  };
}

// ===== BOOKMAKER ODDS → MARKET PROBABILITIES =====
/**
 * NormalizedOdds'tan belirli bir market için fair probability seti çıkarır.
 * 1X2 için: betName "Match Winner" veya "Full Time Result" vs.
 *
 * Overround removed, multi-bookmaker consensus.
 */
export function marketProbabilitiesFromOdds(params: {
  odds: NormalizedOdds;
  betNameMatchers: string[];   // Örn ["Match Winner", "1X2", "Full Time Result"]
  selections: string[];         // Örn ["Home", "Draw", "Away"]
}): { probs: (number | null)[]; consensus: MarketConsensus[] } {
  const quotesBySelection = params.selections.map(() =>
    [] as { selectionOdds: number; allMarketOdds: number[] }[]
  );

  for (const bm of params.odds.bookmakers) {
    const matchingBet = bm.bets.find(b =>
      params.betNameMatchers.some(
        m => b.name.toLowerCase().trim() === m.toLowerCase().trim()
      )
    );
    if (!matchingBet) continue;

    const allMarketOdds = matchingBet.values.map(v => v.odd);

    params.selections.forEach((sel, idx) => {
      const found = matchingBet.values.find(v =>
        v.value.toLowerCase() === sel.toLowerCase() ||
        (sel === 'Home' && (v.value === '1' || v.value.toLowerCase() === 'home')) ||
        (sel === 'Draw' && (v.value === 'X' || v.value.toLowerCase() === 'draw')) ||
        (sel === 'Away' && (v.value === '2' || v.value.toLowerCase() === 'away'))
      );
      if (found) {
        quotesBySelection[idx].push({
          selectionOdds: found.odd,
          allMarketOdds,
        });
      }
    });
  }

  const consensus = quotesBySelection.map(qs => calculateMarketConsensus(qs));
  const probs = consensus.map(c => (c.bookmakerCount > 0 ? c.fairProb : null));

  return { probs, consensus };
}

// ===== FULL PIPELINE HELPER =====
/**
 * Tek çağrıda tüm kaynakları birleştirir.
 * Adapter'lar bu fonksiyonu kullanarak ensemble sonucu alır.
 */
export function fullEnsemble1X2(params: {
  modelProbs: ProbabilitySet;
  odds?: NormalizedOdds;
  marketBetNames: string[];
  statsVault?: StatsVaultPrediction | null;
  weights?: EnsembleWeights;
  uncertainty?: Partial<UncertaintyParams>;
}) {
  // Market
  let marketProbs: ProbabilitySet | undefined;
  let consensusList: MarketConsensus[] | undefined;
  if (params.odds) {
    const { probs, consensus } = marketProbabilitiesFromOdds({
      odds: params.odds,
      betNameMatchers: params.marketBetNames,
      selections: ['Home', 'Draw', 'Away'],
    });
    if (probs[0] !== null && probs[2] !== null) {
      marketProbs = {
        home: probs[0]!,
        draw: probs[1] ?? 0,
        away: probs[2]!,
      };
      consensusList = consensus;
    }
  }

  // StatsVault
  let statsVaultProbs: ProbabilitySet | undefined;
  if (params.statsVault) {
    const pct = params.statsVault.percent;
    if (pct.home !== null && pct.away !== null) {
      const draw = pct.draw ?? 0;
      const total = pct.home + draw + pct.away;
      if (total > 0) {
        statsVaultProbs = {
          home: pct.home / total,
          draw: draw / total,
          away: pct.away / total,
        };
      }
    }
  }

  // Uncertainty default params
  const avgConsensus = consensusList
    ? consensusList.reduce((s, c) => s + c.bookmakerCount, 0) / consensusList.length
    : 0;
  const avgSpread = consensusList
    ? consensusList.reduce((s, c) => s + c.spread, 0) / consensusList.length
    : 1;

  const uncertainty: UncertaintyParams = {
    bookmakerCount: Math.round(avgConsensus),
    marketSpread: avgSpread,
    ...params.uncertainty,
  };

  return combine1X2({
    model: params.modelProbs,
    market: marketProbs,
    statsVault: statsVaultProbs,
    statsVaultConfidence: params.statsVault?.confidence,
    weights: params.weights,
    uncertainty,
  });
}
