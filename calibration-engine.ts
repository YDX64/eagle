/**
 * Odds Calibration & Cross-Validation Engine v1.0
 *
 * Bahisçi oranları milyarlarca dolarlık bilgiyi temsil eder.
 * Bu motor, kendi modelimizin tahminlerini bahisçi oranlarıyla
 * karşılaştırıp kalibre eder.
 *
 * Yaklaşım:
 * 1. Bahisçi oranlarından "gerçek" olasılıkları çıkar (overround temizle)
 * 2. Kendi modelimizin olasılıklarını bahisçi olasılıklarıyla karşılaştır
 * 3. Sapma büyükse → modelimizi bahisçiye doğru çek (shrinkage)
 * 4. Sapma küçükse → modelimiz edge bulmuş olabilir (value bet)
 * 5. Cross-validate: 3+ kaynak aynı yönde → güven artar
 *
 * Kaynaklar:
 * - Source A: AdvancedPredictionEngine (Poisson + form + standings)
 * - Source B: API-Football Predictions (harici ML model)
 * - Source C: Bookmaker Odds (piyasa konsensüsü)
 * - Source D: CardsCornerEngine (event-based)
 */

import { ApiFootballService, type FixtureOdds } from './api-football';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export interface CalibratedPrediction {
  market: string;
  selection: string;

  // Individual sources
  model_probability: number;      // Our Poisson model
  api_probability: number | null;  // API-Football ML
  market_probability: number | null; // Bookmaker odds

  // Calibrated output
  calibrated_probability: number;
  confidence: number;
  sources_agreeing: number;
  total_sources: number;

  // Value analysis
  is_value_bet: boolean;
  edge: number; // calibrated - market (positive = value)
  recommendation: 'strong_bet' | 'lean_bet' | 'avoid' | 'no_data';
}

export interface CalibrationResult {
  match_result: {
    home: CalibratedPrediction;
    draw: CalibratedPrediction;
    away: CalibratedPrediction;
  };
  goals: {
    over_1_5: CalibratedPrediction;
    over_2_5: CalibratedPrediction;
    over_3_5: CalibratedPrediction;
    under_2_5: CalibratedPrediction;
    under_3_5: CalibratedPrediction;
  };
  btts: {
    yes: CalibratedPrediction;
    no: CalibratedPrediction;
  };
  cards: {
    over_3_5: CalibratedPrediction;
    over_4_5: CalibratedPrediction;
    under_3_5: CalibratedPrediction;
  };
  corners: {
    over_8_5: CalibratedPrediction;
    over_9_5: CalibratedPrediction;
    under_9_5: CalibratedPrediction;
  };
  overall_confidence: number;
  cross_validation_score: number; // 0-100: how much sources agree
  top_picks: CalibratedPrediction[]; // Top 3 highest confidence bets
}

// ═══════════════════════════════════════
// CALIBRATION ENGINE
// ═══════════════════════════════════════

export class CalibrationEngine {

  /**
   * Convert decimal odds to probability and remove overround
   */
  private static oddsToFairProb(odds: number, overround: number): number {
    if (odds <= 1) return 100;
    const implied = (1 / odds) * 100;
    return implied / (100 + overround) * 100;
  }

  /**
   * Temperature scaling: olasılıkları daha keskin veya yumuşak hale getirir.
   * T < 1 → daha keskin (uç olasılıklar daha uç olur)
   * T > 1 → daha yumuşak (olasılıklar 50%'ye yaklaşır)
   * T = 1 → değişiklik yok
   * Sınırlar: [0.5, 2.0] aralığında tutulur
   */
  private static temperatureScale(prob: number, temperature: number): number {
    // Sınırla: 0.5 - 2.0 aralığında
    const T = Math.max(0.5, Math.min(2.0, temperature));
    if (T === 1.0) return prob;

    // Olasılığı log-odds'a dönüştür, temperature ile böl, geri dönüştür
    const p = prob / 100;
    // Uç değerlerde log-odds patlamasını önle
    const pClamped = Math.max(0.01, Math.min(0.99, p));
    const logOdds = Math.log(pClamped / (1 - pClamped));
    const scaledLogOdds = logOdds / T;
    const scaledP = 1 / (1 + Math.exp(-scaledLogOdds));
    return scaledP * 100;
  }

  /**
   * Calibrate a single prediction using shrinkage towards market
   *
   * shrinkage_factor: how much to trust the market (0=ignore market, 1=fully trust market)
   * Default 0.4 = 40% market weight, 60% our model
   * When model and market agree → boost confidence
   * When they disagree → pull towards market
   */
  private static calibrate(
    modelProb: number,
    apiProb: number | null,
    marketProb: number | null,
    shrinkageFactor: number = 0.4
  ): { calibrated: number; confidence: number; agreeing: number; total: number } {
    const sources: number[] = [modelProb];
    if (apiProb !== null && apiProb > 0) sources.push(apiProb);
    if (marketProb !== null && marketProb > 0) sources.push(marketProb);

    if (sources.length === 1) {
      // Kalibrasyon verisi yok → ham olasılığı değiştirmeden döndür
      // Güven skoru düşük tutulur çünkü cross-validation yapılamıyor
      return {
        calibrated: Math.max(1, Math.min(99, modelProb)),
        confidence: Math.min(40, Math.max(10, 20 + Math.abs(modelProb - 50) * 0.4)),
        agreeing: 1,
        total: 1
      };
    }

    // Weighted average with market as anchor
    let calibrated: number;
    if (marketProb !== null && marketProb > 0) {
      // Shrink towards market
      const modelWeight = 1 - shrinkageFactor;
      const marketWeight = shrinkageFactor;

      if (apiProb !== null && apiProb > 0) {
        // 3 sources: model 35%, API 25%, market 40%
        calibrated = modelProb * 0.35 + apiProb * 0.25 + marketProb * 0.40;
      } else {
        // 2 sources: model vs market
        calibrated = modelProb * modelWeight + marketProb * marketWeight;
      }
    } else if (apiProb !== null && apiProb > 0) {
      // No market, use model + API
      calibrated = modelProb * 0.6 + apiProb * 0.4;
    } else {
      calibrated = modelProb;
    }

    // Temperature scaling uygula: kaynaklar uyumlu değilse yumuşat (T>1),
    // kaynaklar uyumluysa hafifçe keskinleştir (T<1)
    const avg = sources.reduce((s, v) => s + v, 0) / sources.length;
    const variance = sources.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / sources.length;
    const stdDev = Math.sqrt(variance);

    // stdDev düşük → kaynaklar uyumlu → T biraz < 1 (keskinleştir)
    // stdDev yüksek → kaynaklar uyumsuz → T > 1 (yumuşat)
    // stdDev 0-5 → T=0.9, stdDev 20+ → T=1.5, lineer interpolasyon
    const temperature = Math.max(0.5, Math.min(2.0, 0.9 + stdDev * 0.03));
    calibrated = this.temperatureScale(calibrated, temperature);

    // Agreement score: low stddev = high agreement
    // stdDev < 5 → perfect agreement, stdDev > 20 → heavy disagreement
    const agreementScore = Math.max(0, 100 - stdDev * 4);

    // Count sources that agree with direction (>50% or <50%)
    const direction = calibrated > 50;
    const agreeing = sources.filter(s => (s > 50) === direction).length;

    // Confidence based on agreement + number of sources
    let confidence = agreementScore * 0.6 + (sources.length / 3) * 40 * 0.4;
    if (agreeing === sources.length) confidence = Math.min(95, confidence + 15);
    if (agreeing < sources.length / 2) confidence = Math.max(10, confidence - 20);

    return {
      calibrated: Math.max(1, Math.min(99, calibrated)),
      confidence: Math.max(5, Math.min(95, confidence)),
      agreeing,
      total: sources.length
    };
  }

  /**
   * Extract market probabilities from odds data
   */
  private static async getMarketProbabilities(fixtureId: number): Promise<{
    home: number; draw: number; away: number;
    over_1_5: number; under_1_5: number;
    over_2_5: number; under_2_5: number;
    over_3_5: number; under_3_5: number;
    btts_yes: number; btts_no: number;
    overround: number;
  } | null> {
    try {
      const oddsData = await ApiFootballService.getOdds(fixtureId);
      if (!oddsData || oddsData.length === 0) return null;

      // Aggregate across bookmakers for best estimate
      let homeOdds: number[] = [], drawOdds: number[] = [], awayOdds: number[] = [];
      let ou: Record<string, number[]> = {};
      let bttsYes: number[] = [], bttsNo: number[] = [];

      oddsData.forEach(entry => {
        entry.bookmakers.forEach(bk => {
          bk.bets.forEach(bet => {
            if (bet.name === 'Match Winner' || bet.id === 1) {
              bet.values.forEach(v => {
                const o = parseFloat(v.odd);
                if (v.value === 'Home') homeOdds.push(o);
                if (v.value === 'Draw') drawOdds.push(o);
                if (v.value === 'Away') awayOdds.push(o);
              });
            }
            if (bet.name === 'Goals Over/Under' || bet.id === 5) {
              bet.values.forEach(v => {
                const o = parseFloat(v.odd);
                if (!ou[v.value]) ou[v.value] = [];
                ou[v.value].push(o);
              });
            }
            if (bet.name === 'Both Teams Score' || bet.id === 8) {
              bet.values.forEach(v => {
                const o = parseFloat(v.odd);
                if (v.value === 'Yes') bttsYes.push(o);
                if (v.value === 'No') bttsNo.push(o);
              });
            }
          });
        });
      });

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b) / arr.length : 0;
      const toProb = (odds: number) => odds > 1 ? (1 / odds) * 100 : 0;

      const hAvg = avg(homeOdds);
      const dAvg = avg(drawOdds);
      const aAvg = avg(awayOdds);

      // Calculate overround
      const totalImplied = toProb(hAvg) + toProb(dAvg) + toProb(aAvg);
      const overround = totalImplied - 100;

      // Fair probabilities (overround removed)
      const fairHome = overround > 0 ? toProb(hAvg) / totalImplied * 100 : toProb(hAvg);
      const fairDraw = overround > 0 ? toProb(dAvg) / totalImplied * 100 : toProb(dAvg);
      const fairAway = overround > 0 ? toProb(aAvg) / totalImplied * 100 : toProb(aAvg);

      const ouProb = (key: string) => {
        const odds = avg(ou[key] || []);
        return odds > 0 ? toProb(odds) : 0;
      };

      return {
        home: fairHome, draw: fairDraw, away: fairAway,
        over_1_5: ouProb('Over 1.5'), under_1_5: ouProb('Under 1.5'),
        over_2_5: ouProb('Over 2.5'), under_2_5: ouProb('Under 2.5'),
        over_3_5: ouProb('Over 3.5'), under_3_5: ouProb('Under 3.5'),
        btts_yes: toProb(avg(bttsYes)), btts_no: toProb(avg(bttsNo)),
        overround,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract API-Football prediction probabilities
   */
  private static parseApiPredictions(apiPred: any): {
    home: number; draw: number; away: number;
    btts_yes: number | null;
    advice: string | null;
  } | null {
    if (!apiPred?.predictions) return null;
    const p = apiPred.predictions;
    const pct = apiPred.predictions?.percent;
    if (!pct) return null;

    return {
      home: parseFloat(pct.home) || 0,
      draw: parseFloat(pct.draw) || 0,
      away: parseFloat(pct.away) || 0,
      btts_yes: null, // API doesn't give BTTS probability directly
      advice: p.advice || null,
    };
  }

  /**
   * Main calibration: takes all sources and produces calibrated predictions
   */
  static async calibrateAll(
    fixtureId: number,
    modelPrediction: any, // AdvancedMatchPrediction
    cardsPrediction: any, // CardsPrediction
    cornersPrediction: any, // CornersPrediction
    apiPredictions: any, // API-Football predictions response
  ): Promise<CalibrationResult> {

    // Get market probabilities
    const market = await this.getMarketProbabilities(fixtureId);
    const apiProbs = this.parseApiPredictions(apiPredictions);

    const mp = modelPrediction;

    // ── MATCH RESULT ──
    const homeCalib = this.calibrate(
      mp.match_result.home_win.probability,
      apiProbs?.home ?? null,
      market?.home ?? null
    );
    const drawCalib = this.calibrate(
      mp.match_result.draw.probability,
      apiProbs?.draw ?? null,
      market?.draw ?? null
    );
    const awayCalib = this.calibrate(
      mp.match_result.away_win.probability,
      apiProbs?.away ?? null,
      market?.away ?? null
    );

    // Normalize 1X2 to sum to 100, sonra [1%, 99%] sınırlarını uygula
    const total1x2 = homeCalib.calibrated + drawCalib.calibrated + awayCalib.calibrated;
    if (total1x2 > 0) {
      homeCalib.calibrated = Math.max(1, Math.min(99, homeCalib.calibrated / total1x2 * 100));
      drawCalib.calibrated = Math.max(1, Math.min(99, drawCalib.calibrated / total1x2 * 100));
      awayCalib.calibrated = Math.max(1, Math.min(99, awayCalib.calibrated / total1x2 * 100));
      // Yeniden normalize et (sınırlama sonrası toplam değişmiş olabilir)
      const reTotal = homeCalib.calibrated + drawCalib.calibrated + awayCalib.calibrated;
      homeCalib.calibrated = homeCalib.calibrated / reTotal * 100;
      drawCalib.calibrated = drawCalib.calibrated / reTotal * 100;
      awayCalib.calibrated = awayCalib.calibrated / reTotal * 100;
    }

    // ── GOALS ──
    const goalsCalib = {
      over_1_5: this.calibrate(mp.total_goals.over_1_5.probability, null, market?.over_1_5 ?? null),
      over_2_5: this.calibrate(mp.total_goals.over_2_5.probability, null, market?.over_2_5 ?? null),
      over_3_5: this.calibrate(mp.total_goals.over_3_5.probability, null, market?.over_3_5 ?? null),
      under_2_5: this.calibrate(mp.total_goals.under_2_5.probability, null, market?.under_2_5 ?? null),
      under_3_5: this.calibrate(mp.total_goals.under_3_5.probability, null, market?.under_3_5 ?? null),
    };

    // ── BTTS ──
    const bttsCalib = {
      yes: this.calibrate(mp.both_teams_score.probability, apiProbs?.btts_yes ?? null, market?.btts_yes ?? null),
      no: this.calibrate(100 - mp.both_teams_score.probability, null, market?.btts_no ?? null),
    };

    // ── CARDS (no market odds typically, use model + cross-check with goals intensity) ──
    // Cards correlate with match intensity: more goals = more fouls = more cards
    // Sürekli (continuous) bir faktör kullan, binary değil
    // over_2_5 olasılığına göre lineer interpolasyon: 30%-70% arası → 0.93-1.08 arası
    const goalsProb = mp.total_goals.over_2_5.probability;
    const goalsIntensityFactor = 0.93 + (Math.max(30, Math.min(70, goalsProb)) - 30) * (0.15 / 40);

    // Olasılıkları ayarla ama [1, 99] sınırlarını aşma
    const adjustCardProb = (prob: number, factor: number): number => {
      return Math.max(1, Math.min(99, prob * factor));
    };

    const cardsCalib = {
      over_3_5: this.calibrate(adjustCardProb(cardsPrediction.probabilities.over_3_5, goalsIntensityFactor), null, null, 0),
      over_4_5: this.calibrate(adjustCardProb(cardsPrediction.probabilities.over_4_5, goalsIntensityFactor), null, null, 0),
      under_3_5: this.calibrate(adjustCardProb(cardsPrediction.probabilities.under_3_5, 1 / goalsIntensityFactor), null, null, 0),
    };

    // ── CORNERS (cross-check with possession and shots data) ──
    const cornersCalib = {
      over_8_5: this.calibrate(cornersPrediction.probabilities.over_8_5, null, null, 0),
      over_9_5: this.calibrate(cornersPrediction.probabilities.over_9_5, null, null, 0),
      under_9_5: this.calibrate(cornersPrediction.probabilities.under_9_5, null, null, 0),
    };

    // ── BUILD CALIBRATED PREDICTIONS ──
    const buildCP = (
      market: string, selection: string,
      modelProb: number, apiProb: number | null, marketProb: number | null,
      calib: { calibrated: number; confidence: number; agreeing: number; total: number }
    ): CalibratedPrediction => {
      const edge = marketProb ? calib.calibrated - marketProb : 0;
      return {
        market, selection,
        model_probability: Math.round(modelProb * 100) / 100,
        api_probability: apiProb !== null ? Math.round(apiProb * 100) / 100 : null,
        market_probability: marketProb !== null ? Math.round(marketProb * 100) / 100 : null,
        calibrated_probability: Math.round(calib.calibrated * 100) / 100,
        confidence: Math.round(calib.confidence),
        sources_agreeing: calib.agreeing,
        total_sources: calib.total,
        is_value_bet: edge > 3,
        edge: Math.round(edge * 100) / 100,
        recommendation: calib.confidence >= 70 && calib.calibrated > 55 ? 'strong_bet' :
                        calib.confidence >= 50 && calib.calibrated > 50 ? 'lean_bet' :
                        calib.total < 2 ? 'no_data' : 'avoid',
      };
    };

    const result: CalibrationResult = {
      match_result: {
        home: buildCP('1X2', 'Home', mp.match_result.home_win.probability, apiProbs?.home ?? null, market?.home ?? null, homeCalib),
        draw: buildCP('1X2', 'Draw', mp.match_result.draw.probability, apiProbs?.draw ?? null, market?.draw ?? null, drawCalib),
        away: buildCP('1X2', 'Away', mp.match_result.away_win.probability, apiProbs?.away ?? null, market?.away ?? null, awayCalib),
      },
      goals: {
        over_1_5: buildCP('Goals', 'Over 1.5', mp.total_goals.over_1_5.probability, null, market?.over_1_5 ?? null, goalsCalib.over_1_5),
        over_2_5: buildCP('Goals', 'Over 2.5', mp.total_goals.over_2_5.probability, null, market?.over_2_5 ?? null, goalsCalib.over_2_5),
        over_3_5: buildCP('Goals', 'Over 3.5', mp.total_goals.over_3_5.probability, null, market?.over_3_5 ?? null, goalsCalib.over_3_5),
        under_2_5: buildCP('Goals', 'Under 2.5', mp.total_goals.under_2_5.probability, null, market?.under_2_5 ?? null, goalsCalib.under_2_5),
        under_3_5: buildCP('Goals', 'Under 3.5', mp.total_goals.under_3_5.probability, null, market?.under_3_5 ?? null, goalsCalib.under_3_5),
      },
      btts: {
        yes: buildCP('BTTS', 'Yes', mp.both_teams_score.probability, apiProbs?.btts_yes ?? null, market?.btts_yes ?? null, bttsCalib.yes),
        no: buildCP('BTTS', 'No', 100 - mp.both_teams_score.probability, null, market?.btts_no ?? null, bttsCalib.no),
      },
      cards: {
        over_3_5: buildCP('Cards', 'Over 3.5', cardsPrediction.probabilities.over_3_5, null, null, cardsCalib.over_3_5),
        over_4_5: buildCP('Cards', 'Over 4.5', cardsPrediction.probabilities.over_4_5, null, null, cardsCalib.over_4_5),
        under_3_5: buildCP('Cards', 'Under 3.5', cardsPrediction.probabilities.under_3_5, null, null, cardsCalib.under_3_5),
      },
      corners: {
        over_8_5: buildCP('Corners', 'Over 8.5', cornersPrediction.probabilities.over_8_5, null, null, cornersCalib.over_8_5),
        over_9_5: buildCP('Corners', 'Over 9.5', cornersPrediction.probabilities.over_9_5, null, null, cornersCalib.over_9_5),
        under_9_5: buildCP('Corners', 'Under 9.5', cornersPrediction.probabilities.under_9_5, null, null, cornersCalib.under_9_5),
      },
      overall_confidence: 0,
      cross_validation_score: 0,
      top_picks: [],
    };

    // ── CROSS-VALIDATION SCORE ──
    // How much do all sources agree across all markets
    const allPredictions = [
      result.match_result.home, result.match_result.draw, result.match_result.away,
      result.goals.over_2_5, result.goals.under_2_5,
      result.btts.yes, result.btts.no,
    ];
    const totalAgreeing = allPredictions.reduce((s, p) => s + p.sources_agreeing, 0);
    const totalSources = allPredictions.reduce((s, p) => s + p.total_sources, 0);
    result.cross_validation_score = totalSources > 0 ? Math.round((totalAgreeing / totalSources) * 100) : 30;

    // Overall confidence
    const allConfidences = allPredictions.map(p => p.confidence);
    result.overall_confidence = Math.round(allConfidences.reduce((s, c) => s + c, 0) / allConfidences.length);

    // ── TOP PICKS ──
    const allCPs = [
      result.match_result.home, result.match_result.draw, result.match_result.away,
      result.goals.over_1_5, result.goals.over_2_5, result.goals.over_3_5,
      result.goals.under_2_5, result.goals.under_3_5,
      result.btts.yes, result.btts.no,
      result.cards.over_3_5, result.cards.over_4_5,
      result.corners.over_8_5, result.corners.over_9_5,
    ];

    result.top_picks = allCPs
      .filter(p => p.recommendation === 'strong_bet' || p.recommendation === 'lean_bet')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    return result;
  }
}
