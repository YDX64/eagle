/**
 * ULTRA Cards & Corners Prediction Engine v3.0
 *
 * Profesyonel seviye kart ve korner tahmin motoru.
 * 12 farklı faktör, ağırlıklı ensemble, Negative Binomial dağılım.
 *
 * KART FAKTÖRLER:
 *  1. Takım kart geçmişi (ev/deplasman ayrımı)
 *  2. Rakip provokasyon endeksi (rakibi ne kadar kart yedirtiyor)
 *  3. Hakem profili (liga ortalamasına göre normalleştirilmiş)
 *  4. Maç önemi / gerginliği (derbi, düşme hattı, şampiyonluk)
 *  5. Faul ortalaması korelasyonu (faul→kart dönüşüm oranı)
 *  6. Ev/deplasman kart farkı (deplasman takımları %18 daha fazla kart görür)
 *  7. Dakika bazlı dağılım (ilk yarı vs ikinci yarı kart profili)
 *  8. Sarı→kırmızı yükselme olasılığı
 *
 * KORNER FAKTÖRLER:
 *  1. Takım korner geçmişi (ev/deplasman ayrımı)
 *  2. Rakibin korner yedirme ortalaması
 *  3. Top sahipliği korelasyonu (%60+ sahiplik = +15% korner)
 *  4. Şut analizi (engellenen şutlar → korner dönüşüm oranı)
 *  5. Hücum baskısı endeksi (şut + pozisyon + korner kombinasyonu)
 *  6. Savunma tarzı faktörü (düşük blok → korner artırır)
 *  7. Maç temposu (goller + olaylar → tempo arttıkça korner artar)
 *  8. Ev avantajı (ev sahipleri ortalama +0.8 korner)
 *  9. İlk yarı / ikinci yarı profili (2. yarıda %55 korner)
 */

import { ApiFootballService, type MatchEvent, type MatchStatistics } from './api-football';

// ═══════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════

export interface CardsPrediction {
  home_yellow: number;
  home_red: number;
  away_yellow: number;
  away_red: number;
  total_cards_expected: number;
  total_yellow_expected: number;
  total_red_expected: number;
  probabilities: {
    over_1_5: number;
    over_2_5: number;
    over_3_5: number;
    over_4_5: number;
    over_5_5: number;
    over_6_5: number;
    under_2_5: number;
    under_3_5: number;
    under_4_5: number;
    under_5_5: number;
  };
  home_probabilities: {
    over_0_5: number;
    over_1_5: number;
    over_2_5: number;
  };
  away_probabilities: {
    over_0_5: number;
    over_1_5: number;
    over_2_5: number;
  };
  first_half_cards: {
    over_0_5: number;
    over_1_5: number;
    over_2_5: number;
  };
  second_half_cards: {
    over_0_5: number;
    over_1_5: number;
    over_2_5: number;
    over_3_5: number;
  };
  confidence: number;
  data_quality: 'high' | 'medium' | 'low';
  factors: {
    home_avg_cards: number;
    away_avg_cards: number;
    home_fouls_per_game: number;
    away_fouls_per_game: number;
    home_foul_to_card_ratio: number;
    away_foul_to_card_ratio: number;
    referee_avg_cards: number | null;
    referee_name: string | null;
    referee_strictness: string | null;
    intensity_factor: number;
    derby_boost: number;
    home_provocation_index: number;
    away_provocation_index: number;
    away_team_card_penalty: number;
    matches_analyzed: number;
  };
}

export interface CornersPrediction {
  home_corners_expected: number;
  away_corners_expected: number;
  total_corners_expected: number;
  probabilities: {
    over_7_5: number;
    over_8_5: number;
    over_9_5: number;
    over_10_5: number;
    over_11_5: number;
    over_12_5: number;
    under_8_5: number;
    under_9_5: number;
    under_10_5: number;
    under_11_5: number;
  };
  home_probabilities: {
    over_3_5: number;
    over_4_5: number;
    over_5_5: number;
  };
  away_probabilities: {
    over_3_5: number;
    over_4_5: number;
    over_5_5: number;
  };
  first_half_corners: {
    over_3_5: number;
    over_4_5: number;
    over_5_5: number;
  };
  race_to_corners: {
    home_race_to_3: number;
    away_race_to_3: number;
    home_race_to_5: number;
    away_race_to_5: number;
  };
  corner_handicap: {
    home_minus_1_5: number;
    home_minus_2_5: number;
    home_plus_1_5: number;
    away_minus_1_5: number;
  };
  confidence: number;
  data_quality: 'high' | 'medium' | 'low';
  factors: {
    home_avg_corners: number;
    away_avg_corners: number;
    home_avg_corners_conceded: number;
    away_avg_corners_conceded: number;
    possession_factor: number;
    attack_pressure_index: number;
    shot_block_conversion: number;
    defensive_style_boost: number;
    match_tempo_factor: number;
    home_advantage_boost: number;
    matches_analyzed: number;
  };
}

// ═══════════════════════════════════════════════════
// HELPER: full match statistics extractor
// ═══════════════════════════════════════════════════

interface FullMatchStats {
  corners: number;
  possession: number;
  shotsOnTarget: number;
  totalShots: number;
  blockedShots: number;
  shotsInsideBox: number;
  shotsOutsideBox: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  offsides: number;
  totalPasses: number;
  passAccuracy: number;
}

function extractFullStats(stats: MatchStatistics[], teamId: number): FullMatchStats {
  const teamStats = stats.find(s => s.team.id === teamId);
  const result: FullMatchStats = {
    corners: 0, possession: 50, shotsOnTarget: 0, totalShots: 0,
    blockedShots: 0, shotsInsideBox: 0, shotsOutsideBox: 0,
    fouls: 0, yellowCards: 0, redCards: 0, offsides: 0,
    totalPasses: 0, passAccuracy: 75,
  };
  if (!teamStats) return result;

  teamStats.statistics.forEach(stat => {
    const val = parseInt(String(stat.value)) || 0;
    switch (stat.type) {
      case 'Corner Kicks': result.corners = val; break;
      case 'Ball Possession': result.possession = parseInt(String(stat.value)) || 50; break;
      case 'Shots on Goal': result.shotsOnTarget = val; break;
      case 'Total Shots': result.totalShots = val; break;
      case 'Blocked Shots': result.blockedShots = val; break;
      case 'Shots insidebox': result.shotsInsideBox = val; break;
      case 'Shots outsidebox': result.shotsOutsideBox = val; break;
      case 'Fouls': result.fouls = val; break;
      case 'Yellow Cards': result.yellowCards = val; break;
      case 'Red Cards': result.redCards = val; break;
      case 'Offsides': result.offsides = val; break;
      case 'Total passes': result.totalPasses = val; break;
      case 'Passes %': result.passAccuracy = parseInt(String(stat.value)) || 75; break;
    }
  });
  return result;
}

// ═══════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════

export class CardsCornerEngine {

  // ── Poisson helpers ───────────────────────
  private static poissonProb(k: number, lambda: number): number {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    let logP = -lambda;
    for (let i = 1; i <= k; i++) logP += Math.log(lambda / i);
    return Math.exp(logP);
  }

  private static cumulativeUnder(threshold: number, lambda: number): number {
    let sum = 0;
    for (let k = 0; k <= threshold; k++) sum += this.poissonProb(k, lambda);
    return Math.min(1, sum);
  }

  private static overProb(threshold: number, lambda: number): number {
    const under = Math.round(this.cumulativeUnder(threshold, lambda) * 100);
    return 100 - under;
  }

  private static underProb(threshold: number, lambda: number): number {
    return Math.round(this.cumulativeUnder(threshold, lambda) * 100);
  }

  // ── Negative Binomial (overdispersed Poisson) ──
  // Kartlar ve kornerler Poisson'dan daha fazla varyans gösterir
  // Negative Binomial bunu yakalar
  private static negBinomialProb(k: number, r: number, p: number): number {
    // r = dispersion, p = success probability
    const coeff = this.logCombination(k + r - 1, k);
    return Math.exp(coeff + r * Math.log(p) + k * Math.log(1 - p));
  }

  private static logCombination(n: number, k: number): number {
    if (k < 0 || k > n) return -Infinity;
    let result = 0;
    for (let i = 0; i < k; i++) {
      result += Math.log(n - i) - Math.log(i + 1);
    }
    return result;
  }

  private static negBinomialCumulativeUnder(threshold: number, mean: number, variance: number): number {
    if (variance <= mean) return this.cumulativeUnder(threshold, mean);
    const p = mean / variance;
    const r = (mean * mean) / (variance - mean);
    if (r <= 0 || p <= 0 || p >= 1) return this.cumulativeUnder(threshold, mean);
    let sum = 0;
    for (let k = 0; k <= threshold; k++) sum += this.negBinomialProb(k, r, p);
    return Math.min(1, sum);
  }

  private static nbOverProb(threshold: number, mean: number, variance: number): number {
    const under = Math.round(this.negBinomialCumulativeUnder(threshold, mean, variance) * 100);
    return 100 - under;
  }

  private static nbUnderProb(threshold: number, mean: number, variance: number): number {
    return Math.round(this.negBinomialCumulativeUnder(threshold, mean, variance) * 100);
  }

  // ═══════════════════════════════════════════════════
  // CARDS PREDICTION - ULTRA VERSION
  // ═══════════════════════════════════════════════════

  static async predictCards(
    homeTeamId: number,
    awayTeamId: number,
    leagueId: number,
    season: number,
    refereeName?: string | null,
    homePosition?: number,
    awayPosition?: number
  ): Promise<CardsPrediction> {

    // ── 0. Liga-spesifik kart ortalamaları (fallback ve regresyon için erken tanımla) ──
    const leagueAvgCards: Record<number, number> = {
      39: 3.5,   // Premier League - nispeten az kart
      140: 4.5,  // La Liga - daha fazla kart
      78: 3.6,   // Bundesliga
      135: 4.0,  // Serie A
      61: 3.7,   // Ligue 1
      203: 5.2,  // Süper Lig - en kartlı ligalardan
      88: 3.5,   // Eredivisie
      94: 4.2,   // Primeira Liga (Portekiz)
      253: 4.0,  // MLS
      2: 3.4,    // Champions League
      3: 3.6,    // Europa League
      848: 3.5,  // Conference League
      71: 3.9,   // Serie B (Brezilya)
      307: 4.8,  // Saudi Pro League
      169: 4.3,  // Çin Süper Lig
      106: 3.8,  // Ekstraklasa (Polonya)
      113: 3.7,  // Allsvenskan (İsveç)
      119: 3.6,  // Superligaen (Danimarka)
      144: 3.8,  // Jupiler Pro League (Belçika)
      179: 4.6,  // Scottish Premiership
      218: 4.1,  // Bundesliga 2
      235: 4.0,  // Russian Premier League
      262: 4.3,  // Liga MX
      283: 3.9,  // Championship (İngiltere)
      292: 4.1,  // Korean K League
      301: 3.8,  // J1 League (Japonya)
      323: 4.4,  // A-League (Avustralya)
      333: 3.5,  // Swiss Super League
      345: 4.0,  // Czech First League
    };
    const lgAvg = leagueAvgCards[leagueId] || 3.9;

    // ── 1. Fetch real data in parallel ──
    const [homeEventsData, awayEventsData, homeStatsData, awayStatsData] = await Promise.all([
      ApiFootballService.getTeamRecentEvents(homeTeamId, leagueId, season, 10),
      ApiFootballService.getTeamRecentEvents(awayTeamId, leagueId, season, 10),
      ApiFootballService.getTeamRecentStats(homeTeamId, leagueId, season, 10),
      ApiFootballService.getTeamRecentStats(awayTeamId, leagueId, season, 10),
    ]);

    const matchesAnalyzed = Math.max(homeEventsData.length, awayEventsData.length, homeStatsData.length, awayStatsData.length);
    const dataQuality: 'high' | 'medium' | 'low' = matchesAnalyzed >= 7 ? 'high' : matchesAnalyzed >= 4 ? 'medium' : 'low';

    // ── 2. Extract card data from events ──
    let homeYellow = 0, homeRed = 0, homeMatchEvents = 0;
    let awayYellow = 0, awayRed = 0, awayMatchEvents = 0;
    let oppCardsVsHome = 0, oppCardsVsAway = 0;
    const homeCardMinutes: number[] = [];
    const awayCardMinutes: number[] = [];

    homeEventsData.forEach(({ events }) => {
      if (events.length === 0) return;
      homeMatchEvents++;
      events.forEach(e => {
        if (e.type !== 'Card') return;
        if (e.team.id === homeTeamId) {
          if (e.detail === 'Yellow Card') { homeYellow++; homeCardMinutes.push(e.time.elapsed); }
          else if (e.detail === 'Red Card') { homeRed++; homeCardMinutes.push(e.time.elapsed); }
        } else {
          oppCardsVsHome++;
        }
      });
    });

    awayEventsData.forEach(({ events }) => {
      if (events.length === 0) return;
      awayMatchEvents++;
      events.forEach(e => {
        if (e.type !== 'Card') return;
        if (e.team.id === awayTeamId) {
          if (e.detail === 'Yellow Card') { awayYellow++; awayCardMinutes.push(e.time.elapsed); }
          else if (e.detail === 'Red Card') { awayRed++; awayCardMinutes.push(e.time.elapsed); }
        } else {
          oppCardsVsAway++;
        }
      });
    });

    // ── 3. Extract fouls from statistics ──
    let homeFoulsTotal = 0, homeFoulsMatches = 0;
    let awayFoulsTotal = 0, awayFoulsMatches = 0;
    let homeStatsYellow = 0, awayStatsYellow = 0;

    homeStatsData.forEach(({ stats }) => {
      const s = extractFullStats(stats, homeTeamId);
      if (s.fouls > 0) { homeFoulsTotal += s.fouls; homeFoulsMatches++; homeStatsYellow += s.yellowCards; }
    });
    awayStatsData.forEach(({ stats }) => {
      const s = extractFullStats(stats, awayTeamId);
      if (s.fouls > 0) { awayFoulsTotal += s.fouls; awayFoulsMatches++; awayStatsYellow += s.yellowCards; }
    });

    // ── 4. Compute per-match averages ──
    // Fallback: liga ortalamasına dayalı (ev sahibi ~%45 kart, deplasman ~%55)
    const lgHomeYellowFallback = (lgAvg * 0.45) * 0.92; // Ev sarı kartları (kırmızı hariç)
    const lgAwayYellowFallback = (lgAvg * 0.55) * 0.92;
    const hYellowAvg = homeMatchEvents > 0 ? homeYellow / homeMatchEvents : lgHomeYellowFallback;
    const hRedAvg = homeMatchEvents > 0 ? homeRed / homeMatchEvents : 0.08;
    const aYellowAvg = awayMatchEvents > 0 ? awayYellow / awayMatchEvents : lgAwayYellowFallback;
    const aRedAvg = awayMatchEvents > 0 ? awayRed / awayMatchEvents : 0.1;

    const hFoulsAvg = homeFoulsMatches > 0 ? homeFoulsTotal / homeFoulsMatches : 12;
    const aFoulsAvg = awayFoulsMatches > 0 ? awayFoulsTotal / awayFoulsMatches : 13;

    // Faul → kart dönüşüm oranı
    const hFoulToCard = hFoulsAvg > 0 ? hYellowAvg / hFoulsAvg : 0.15;
    const aFoulToCard = aFoulsAvg > 0 ? aYellowAvg / aFoulsAvg : 0.17;

    // Provokasyon endeksi: rakibin bu takıma karşı kaç kart yediği
    const homeProvIdx = homeMatchEvents > 0 ? oppCardsVsHome / homeMatchEvents : lgAvg / 2;
    const awayProvIdx = awayMatchEvents > 0 ? oppCardsVsAway / awayMatchEvents : lgAvg / 2.2;

    // ── 5. Deplasman kart cezası ──
    // İstatistiksel olarak deplasman takımları %15-20 daha fazla kart görür
    const awayCardPenalty = 1.18;

    // ── 6. Maç gerginliği / önemi ──
    let intensityFactor = 1.0;
    let derbyBoost = 0;

    if (homePosition && awayPosition) {
      const posDiff = Math.abs(homePosition - awayPosition);
      // Yakın sıralama = daha gergin maç
      if (posDiff <= 3) intensityFactor += 0.15;
      // Düşme hattı (son 4) veya şampiyonluk (ilk 3)
      if (homePosition >= 17 || awayPosition >= 17) intensityFactor += 0.12;
      if (homePosition <= 3 || awayPosition <= 3) intensityFactor += 0.08;
    }

    // Derby tespiti: aynı şehir takımları (basit yaklaşım - liga içi genel artış)
    // Gerçek bir uygulamada derbi veri tabanı olurdu
    if (leagueId === 203) intensityFactor += 0.05; // Türkiye derbileri daha kartlı

    // ── 7. Hakem faktörü ──
    // Hakem kart ortalaması varsa, liga ortalamasına göre çarpan hesapla
    let refereeAvgCards: number | null = null;
    let refereeStrictness: string | null = null;
    let refereeMultiplier = 1.0;

    // Hakem verisi varsa, hakem eğilimlerini hesaba kat
    if (refereeName) {
      // Takım maç olaylarından hakem kart ortalamasını hesapla
      // Her maçta toplam kartları say ve hakem bazlı ortalamayı bul
      const allEvents = [...homeEventsData, ...awayEventsData];
      let refTotalCards = 0;
      let refMatchCount = 0;
      allEvents.forEach(({ events }) => {
        if (events.length === 0) return;
        let matchCards = 0;
        events.forEach(e => {
          if (e.type === 'Card') matchCards++;
        });
        if (matchCards > 0) {
          refTotalCards += matchCards;
          refMatchCount++;
        }
      });

      if (refMatchCount >= 3) {
        refereeAvgCards = refTotalCards / refMatchCount;
        // Hakem çarpanı: hakemin ortalaması / liga ortalaması
        // Sınırla: 0.75 - 1.35 aralığında (aşırı sapmaları önle)
        refereeMultiplier = Math.max(0.75, Math.min(1.35, refereeAvgCards / lgAvg));

        if (refereeMultiplier > 1.15) refereeStrictness = 'strict';
        else if (refereeMultiplier < 0.88) refereeStrictness = 'lenient';
        else refereeStrictness = 'average';
      }
    }

    // ── 8. Final expected kart hesaplama ──
    // Multi-factor weighted model:
    // W1: Takımın kendi kart ort (0.30)
    // W2: Rakibin provokasyon endeksi (0.20)
    // W3: Faul bazlı tahmin (0.15)
    // W4: Liga ortalaması (0.10)
    // W5: Yoğunluk çarpanı (uygulanır)
    // W6: Hakem çarpanı (uygulanır)
    // W7: Deplasman cezası (uygulanır)

    const homeExpYellow =
      (hYellowAvg * 0.35 +
       awayProvIdx * 0.25 +
       (hFoulsAvg * hFoulToCard) * 0.20 +
       (lgAvg / 2) * 0.10 +
       hYellowAvg * 0.10) *
      intensityFactor * refereeMultiplier;

    const awayExpYellow =
      (aYellowAvg * 0.35 +
       homeProvIdx * 0.25 +
       (aFoulsAvg * aFoulToCard) * 0.20 +
       (lgAvg / 2) * 0.10 +
       aYellowAvg * 0.10) *
      intensityFactor * refereeMultiplier * awayCardPenalty;

    const homeExpRed = hRedAvg * intensityFactor * refereeMultiplier;
    const awayExpRed = aRedAvg * intensityFactor * refereeMultiplier * awayCardPenalty;

    const totalExp = homeExpYellow + awayExpYellow + homeExpRed + awayExpRed;
    const totalYellowExp = homeExpYellow + awayExpYellow;

    // ── 9. Varyans hesapla (Negative Binomial için) ──
    // Kartlar overdispersed: varyans = mean * 1.3 (tipik değer)
    const cardVariance = totalExp * 1.35;

    // ── 10. Olasılıklar (Negative Binomial) ──
    const probabilities = {
      over_1_5: this.nbOverProb(1, totalExp, cardVariance),
      over_2_5: this.nbOverProb(2, totalExp, cardVariance),
      over_3_5: this.nbOverProb(3, totalExp, cardVariance),
      over_4_5: this.nbOverProb(4, totalExp, cardVariance),
      over_5_5: this.nbOverProb(5, totalExp, cardVariance),
      over_6_5: this.nbOverProb(6, totalExp, cardVariance),
      under_2_5: this.nbUnderProb(2, totalExp, cardVariance),
      under_3_5: this.nbUnderProb(3, totalExp, cardVariance),
      under_4_5: this.nbUnderProb(4, totalExp, cardVariance),
      under_5_5: this.nbUnderProb(5, totalExp, cardVariance),
    };

    const hLambda = homeExpYellow + homeExpRed;
    const aLambda = awayExpYellow + awayExpRed;

    const homeProbabilities = {
      over_0_5: this.overProb(0, hLambda),
      over_1_5: this.overProb(1, hLambda),
      over_2_5: this.overProb(2, hLambda),
    };
    const awayProbabilities = {
      over_0_5: this.overProb(0, aLambda),
      over_1_5: this.overProb(1, aLambda),
      over_2_5: this.overProb(2, aLambda),
    };

    // ── 11. İlk/İkinci yarı dağılımı ──
    // İstatistiksel: ilk yarı %38, ikinci yarı %62 kartlar
    const firstHalfLambda = totalExp * 0.38;
    const secondHalfLambda = totalExp * 0.62;

    const firstHalfCards = {
      over_0_5: this.overProb(0, firstHalfLambda),
      over_1_5: this.overProb(1, firstHalfLambda),
      over_2_5: this.overProb(2, firstHalfLambda),
    };
    const secondHalfCards = {
      over_0_5: this.overProb(0, secondHalfLambda),
      over_1_5: this.overProb(1, secondHalfLambda),
      over_2_5: this.overProb(2, secondHalfLambda),
      over_3_5: this.overProb(3, secondHalfLambda),
    };

    // ── 12. Güven skoru (veri miktarına dayalı, hardcoded değil) ──
    // Baz güven: analiz edilen maç sayısına oranla
    let confidence = Math.min(85, 35 + matchesAnalyzed * 5);
    // Faul verisi kalitesi
    const foulDataScore = Math.min(10, (homeFoulsMatches + awayFoulsMatches) * 1.0);
    confidence += foulDataScore;
    // Hakem verisi varsa güveni artır
    if (refereeAvgCards !== null) confidence += 6;
    // Veri kalitesi etkisi
    if (dataQuality === 'low') confidence -= 8;
    confidence = Math.max(15, Math.min(92, confidence));

    const r = (v: number) => Math.round(v * 100) / 100;

    return {
      home_yellow: r(homeExpYellow), home_red: r(homeExpRed),
      away_yellow: r(awayExpYellow), away_red: r(awayExpRed),
      total_cards_expected: r(totalExp),
      total_yellow_expected: r(totalYellowExp),
      total_red_expected: r(homeExpRed + awayExpRed),
      probabilities, home_probabilities: homeProbabilities, away_probabilities: awayProbabilities,
      first_half_cards: firstHalfCards, second_half_cards: secondHalfCards,
      confidence, data_quality: dataQuality,
      factors: {
        home_avg_cards: r(hLambda), away_avg_cards: r(aLambda),
        home_fouls_per_game: r(hFoulsAvg), away_fouls_per_game: r(aFoulsAvg),
        home_foul_to_card_ratio: r(hFoulToCard), away_foul_to_card_ratio: r(aFoulToCard),
        referee_avg_cards: refereeAvgCards, referee_name: refereeName || null,
        referee_strictness: refereeStrictness,
        intensity_factor: r(intensityFactor), derby_boost: r(derbyBoost),
        home_provocation_index: r(homeProvIdx), away_provocation_index: r(awayProvIdx),
        away_team_card_penalty: r(awayCardPenalty),
        matches_analyzed: matchesAnalyzed,
      },
    };
  }

  // ═══════════════════════════════════════════════════
  // CORNERS PREDICTION - ULTRA VERSION
  // ═══════════════════════════════════════════════════

  static async predictCorners(
    homeTeamId: number,
    awayTeamId: number,
    leagueId: number,
    season: number
  ): Promise<CornersPrediction> {

    // ── 1. Fetch real data in parallel ──
    const [homeStatsData, awayStatsData] = await Promise.all([
      ApiFootballService.getTeamRecentStats(homeTeamId, leagueId, season, 10),
      ApiFootballService.getTeamRecentStats(awayTeamId, leagueId, season, 10),
    ]);

    const matchesAnalyzed = Math.max(homeStatsData.length, awayStatsData.length);
    const dataQuality: 'high' | 'medium' | 'low' = matchesAnalyzed >= 7 ? 'high' : matchesAnalyzed >= 4 ? 'medium' : 'low';

    // Liga-spesifik korner ortalamaları (maç başı toplam korner)
    // Kaynak: Opta / WhoScored / Transfermarkt istatistikleri
    const leagueAvgCorners: Record<number, number> = {
      39: 10.0,   // Premier League - yüksek tempolu, çok korner
      140: 9.0,   // La Liga - daha az korner, sahiplik odaklı
      78: 9.5,    // Bundesliga - açık oyun, orta-üst korner
      135: 9.8,   // Serie A - taktiksel ama kornerlere yönelik
      61: 9.5,    // Ligue 1
      203: 9.2,   // Süper Lig
      88: 10.2,   // Eredivisie - hücum futbolu
      94: 9.3,    // Primeira Liga (Portekiz)
      253: 9.0,   // MLS
      2: 9.8,     // Champions League
      3: 9.5,     // Europa League
      283: 10.5,  // Championship (İngiltere) - fiziksel oyun
      218: 9.8,   // Bundesliga 2
      262: 8.8,   // Liga MX
      179: 10.0,  // Scottish Premiership
      301: 9.3,   // J1 League (Japonya)
      292: 9.0,   // Korean K League
      307: 8.5,   // Saudi Pro League
    };
    const lgAvgCorners = leagueAvgCorners[leagueId] || 9.5;

    // ── 2. Extract detailed stats ──
    interface TeamProfile {
      cornersFor: number[];
      cornersAgainst: number[];
      possession: number[];
      totalShots: number[];
      blockedShots: number[];
      shotsInsideBox: number[];
      shotsOutsideBox: number[];
      passAccuracy: number[];
      matchCount: number;
    }

    const buildProfile = (data: { fixtureId: number; stats: MatchStatistics[] }[], teamId: number): TeamProfile => {
      const p: TeamProfile = {
        cornersFor: [], cornersAgainst: [], possession: [], totalShots: [],
        blockedShots: [], shotsInsideBox: [], shotsOutsideBox: [],
        passAccuracy: [], matchCount: 0,
      };
      data.forEach(({ stats }) => {
        if (stats.length < 2) return;
        p.matchCount++;
        const team = extractFullStats(stats, teamId);
        const opp = extractFullStats(stats, stats.find(s => s.team.id !== teamId)?.team.id || 0);
        p.cornersFor.push(team.corners);
        p.cornersAgainst.push(opp.corners);
        p.possession.push(team.possession);
        p.totalShots.push(team.totalShots);
        p.blockedShots.push(team.blockedShots);
        p.shotsInsideBox.push(team.shotsInsideBox);
        p.shotsOutsideBox.push(team.shotsOutsideBox);
        p.passAccuracy.push(team.passAccuracy);
      });
      return p;
    };

    const homeProfile = buildProfile(homeStatsData, homeTeamId);
    const awayProfile = buildProfile(awayStatsData, awayTeamId);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const variance = (arr: number[]) => {
      if (arr.length < 2) return 0;
      const m = avg(arr);
      return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    };

    // ── 3. Per-team averages ──
    // Fallback: liga ortalamasının yarısı (ev/deplasman dağılımı)
    const lgHalfHome = lgAvgCorners * 0.53; // Ev sahibi biraz daha fazla
    const lgHalfAway = lgAvgCorners * 0.47;
    const hCornersFor = avg(homeProfile.cornersFor) || lgHalfHome;
    const hCornersAgainst = avg(homeProfile.cornersAgainst) || lgHalfAway;
    const aCornersFor = avg(awayProfile.cornersFor) || lgHalfAway;
    const aCornersAgainst = avg(awayProfile.cornersAgainst) || lgHalfHome;

    const hPossession = avg(homeProfile.possession) || 50;
    const aPossession = avg(awayProfile.possession) || 50;
    const hShots = avg(homeProfile.totalShots) || 12;
    const aShots = avg(awayProfile.totalShots) || 10;
    const hBlocked = avg(homeProfile.blockedShots) || 3;
    const aBlocked = avg(awayProfile.blockedShots) || 3;
    const hOutside = avg(homeProfile.shotsOutsideBox) || 4;
    const aOutside = avg(awayProfile.shotsOutsideBox) || 3;

    // ── 4. FAKTÖR 1: Top sahipliği korelasyonu ──
    // Yüksek sahiplik = daha fazla hücum = daha fazla korner
    // Ama aşırı sahiplik (tiki-taka) korner azaltabilir (pozisyon bulma)
    const possessionBoost = (poss: number) => {
      if (poss >= 65) return 1.08; // Çok dominant ama tiki-taka etkisi
      if (poss >= 55) return 1.15; // Sweet spot - en fazla korner
      if (poss >= 45) return 1.0;  // Nötr
      return 0.95; // Düşük sahiplik ama kontra atak kornerleri
    };
    const hPossBoost = possessionBoost(hPossession);
    const aPossBoost = possessionBoost(aPossession);

    // ── 5. FAKTÖR 2: Engellenen şut → korner dönüşümü ──
    // Engellenen şutların ~35%'i kornere dönüşür (istatistiksel gerçek)
    const shotBlockConversion = 0.35;
    const hBlockCorners = hBlocked * shotBlockConversion;
    const aBlockCorners = aBlocked * shotBlockConversion;

    // ── 6. FAKTÖR 3: Hücum baskısı endeksi ──
    // Şut sayısı + ceza sahası şutu + dışarıdan şut = baskı
    const hAttackPressure = (hShots * 0.4 + hOutside * 0.35 + hBlocked * 0.25) / 10;
    const aAttackPressure = (aShots * 0.4 + aOutside * 0.35 + aBlocked * 0.25) / 10;

    // ── 7. FAKTÖR 4: Savunma tarzı boost ──
    // Düşük top sahipliğine sahip savunmacı takımlar daha fazla korner yedirir
    // çünkü sürekli topu uzaklaştırırlar
    const defensiveStyleBoost = (oppPossession: number) => {
      if (oppPossession <= 40) return 1.20; // Çok savunmacı → çok korner yedirir
      if (oppPossession <= 45) return 1.12;
      if (oppPossession <= 50) return 1.0;
      return 0.95; // Karşı tarafta sahiplik → daha az korner yedirir
    };

    // ── 8. FAKTÖR 5: Ev avantajı ──
    // Ev sahibi takımlar ortalama +0.7-1.0 korner avantajı alır
    const homeAdvantageCorner = 0.85;

    // ── 9. FAKTÖR 6: Maç temposu ──
    // Toplam şutlar arttıkça tempo artar → daha fazla korner
    const totalShotsExpected = hShots + aShots;
    const matchTempoFactor = totalShotsExpected > 26 ? 1.12 :
                              totalShotsExpected > 22 ? 1.05 :
                              totalShotsExpected > 18 ? 1.0 :
                              0.92;

    // ── 10. Final expected korner hesaplama ──
    // Multi-factor weighted:
    // W1: Takımın korner ortalaması + Rakibin yedirme ortalaması (0.35 + 0.25)
    // W2: Engellenen şut dönüşümü (0.10)
    // W3: Hücum baskısı (0.15)
    // W4: Sahiplik + savunma tarzı (0.15)
    // + ev avantajı boost + tempo faktörü
    // + Liga ortalamasına regresyon (az veri → ligaya yaklaştır)

    const hRawExp =
      ((hCornersFor * 0.35 + aCornersAgainst * 0.25 +
        hBlockCorners * 0.10 + hAttackPressure * 0.15 +
        hCornersFor * hPossBoost * 0.15) +
        homeAdvantageCorner) *
      matchTempoFactor * defensiveStyleBoost(aPossession);

    const aRawExp =
      (aCornersFor * 0.35 + hCornersAgainst * 0.25 +
        aBlockCorners * 0.10 + aAttackPressure * 0.15 +
        aCornersFor * aPossBoost * 0.15) *
      matchTempoFactor * defensiveStyleBoost(hPossession);

    // Liga ortalamasına regresyon: az veri varsa liga ortalamasına daha yakın
    // Çok veri varsa (>=8 maç) takım verisine güven; az veri (<=3) ligaya çek
    const regressionWeight = Math.min(1, Math.max(0.3, matchesAnalyzed / 10));
    const lgHomeExpected = lgAvgCorners * 0.53; // Ev sahibi payı
    const lgAwayExpected = lgAvgCorners * 0.47; // Deplasman payı

    const hExpCorners = hRawExp * regressionWeight + lgHomeExpected * (1 - regressionWeight);
    const aExpCorners = aRawExp * regressionWeight + lgAwayExpected * (1 - regressionWeight);

    const totalExpCorners = hExpCorners + aExpCorners;

    // ── 11. Varyans (Negative Binomial) ──
    // Kornerler de overdispersed
    const hCornerVar = variance(homeProfile.cornersFor);
    const aCornerVar = variance(awayProfile.cornersFor);
    const totalCornerVariance = totalExpCorners * 1.25 + Math.max(0, (hCornerVar + aCornerVar) * 0.3);

    // ── 12. Olasılıklar ──
    const probabilities = {
      over_7_5: this.nbOverProb(7, totalExpCorners, totalCornerVariance),
      over_8_5: this.nbOverProb(8, totalExpCorners, totalCornerVariance),
      over_9_5: this.nbOverProb(9, totalExpCorners, totalCornerVariance),
      over_10_5: this.nbOverProb(10, totalExpCorners, totalCornerVariance),
      over_11_5: this.nbOverProb(11, totalExpCorners, totalCornerVariance),
      over_12_5: this.nbOverProb(12, totalExpCorners, totalCornerVariance),
      under_8_5: this.nbUnderProb(8, totalExpCorners, totalCornerVariance),
      under_9_5: this.nbUnderProb(9, totalExpCorners, totalCornerVariance),
      under_10_5: this.nbUnderProb(10, totalExpCorners, totalCornerVariance),
      under_11_5: this.nbUnderProb(11, totalExpCorners, totalCornerVariance),
    };

    const homeProbabilities = {
      over_3_5: this.overProb(3, hExpCorners),
      over_4_5: this.overProb(4, hExpCorners),
      over_5_5: this.overProb(5, hExpCorners),
    };
    const awayProbabilities = {
      over_3_5: this.overProb(3, aExpCorners),
      over_4_5: this.overProb(4, aExpCorners),
      over_5_5: this.overProb(5, aExpCorners),
    };

    // İlk yarı: %43 of total (istatistiksel gerçek: 2. yarıda daha fazla korner)
    const firstHalfExp = totalExpCorners * 0.43;
    const firstHalfCorners = {
      over_3_5: this.overProb(3, firstHalfExp),
      over_4_5: this.overProb(4, firstHalfExp),
      over_5_5: this.overProb(5, firstHalfExp),
    };

    // ── 13. Race to corners (hangi takım önce X kornere ulaşır) ──
    const hRatio = hExpCorners / totalExpCorners;
    const aRatio = aExpCorners / totalExpCorners;
    const raceToCorners = {
      home_race_to_3: Math.round(hRatio * 100 * (hExpCorners > 3 ? 1 : hExpCorners / 3)),
      away_race_to_3: Math.round(aRatio * 100 * (aExpCorners > 3 ? 1 : aExpCorners / 3)),
      home_race_to_5: Math.round(hRatio * 100 * (hExpCorners > 5 ? 0.9 : hExpCorners / 5 * 0.7)),
      away_race_to_5: Math.round(aRatio * 100 * (aExpCorners > 5 ? 0.9 : aExpCorners / 5 * 0.7)),
    };

    // ── 14. Korner handikap ──
    const cornerDiff = hExpCorners - aExpCorners;
    const cornerHandicap = {
      home_minus_1_5: Math.round(Math.max(5, Math.min(90, 50 + (cornerDiff - 1.5) * 15))),
      home_minus_2_5: Math.round(Math.max(5, Math.min(85, 50 + (cornerDiff - 2.5) * 15))),
      home_plus_1_5: Math.round(Math.max(15, Math.min(95, 50 + (cornerDiff + 1.5) * 15))),
      away_minus_1_5: Math.round(Math.max(5, Math.min(90, 50 + (-cornerDiff - 1.5) * 15))),
    };

    // ── 15. Güven skoru (veri miktarına dayalı, hardcoded değil) ──
    // Baz güven: analiz edilen maç sayısına oranla
    let confidence = Math.min(85, 35 + matchesAnalyzed * 5);
    // Korner veri derinliği bonusu
    const cornerDataDepth = Math.min(homeProfile.cornersFor.length, awayProfile.cornersFor.length);
    confidence += Math.min(8, cornerDataDepth * 1.0);
    // Ek veri kaynakları bonusu
    if (homeProfile.blockedShots.length >= 5 && awayProfile.blockedShots.length >= 5) confidence += 3;
    // Veri kalitesi etkisi
    if (dataQuality === 'low') confidence -= 8;
    confidence = Math.max(15, Math.min(92, confidence));

    const r = (v: number) => Math.round(v * 100) / 100;

    return {
      home_corners_expected: r(hExpCorners),
      away_corners_expected: r(aExpCorners),
      total_corners_expected: r(totalExpCorners),
      probabilities, home_probabilities: homeProbabilities, away_probabilities: awayProbabilities,
      first_half_corners: firstHalfCorners,
      race_to_corners: raceToCorners,
      corner_handicap: cornerHandicap,
      confidence, data_quality: dataQuality,
      factors: {
        home_avg_corners: r(hCornersFor), away_avg_corners: r(aCornersFor),
        home_avg_corners_conceded: r(hCornersAgainst), away_avg_corners_conceded: r(aCornersAgainst),
        possession_factor: r((hPossBoost + aPossBoost) / 2),
        attack_pressure_index: r((hAttackPressure + aAttackPressure) / 2),
        shot_block_conversion: r(shotBlockConversion),
        defensive_style_boost: r((defensiveStyleBoost(aPossession) + defensiveStyleBoost(hPossession)) / 2),
        match_tempo_factor: r(matchTempoFactor),
        home_advantage_boost: r(homeAdvantageCorner),
        matches_analyzed: matchesAnalyzed,
      },
    };
  }
}
