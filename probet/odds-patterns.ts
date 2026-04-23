/**
 * ProBet Odds-Based Pattern Filters
 *
 * Kullanıcının deneyim ile bulduğu "oran parmak izleri" ve literatür ile
 * toplanmış 40+ oran filtre pattern'i. Runtime'da live odds snapshot'u
 * üzerinde çalışır, eşleşen pattern'ler high-confidence picks olarak döner.
 *
 * Pattern hit rate'leri `lib/probet/odds-pattern-calibration.json`'dan
 * yüklenir (scripts/validate-odds-patterns.py çıktısı). Empirical sample
 * size ≥500 ve hit rate ≥60% olanlar "🎯 Banko Aday" rozeti alır.
 *
 * Pattern kaynakları:
 *  1. Kullanıcının kendi formülleri (HTFT 2/1, BTTS Lock @ 1.44, MS1 1.60-1.69, ...)
 *  2. Literatür/bookmaker wisdom (Steam moves, Draw low goals, ...)
 *  3. %90+ banko pattern'ler (Super Banko 0.5 Üst %97.3, MS1X %94.8, ...)
 *  4. HTFT filtreleri (1/1 %83.5, X/1 %74.2, X/X %71.8)
 *  5. Özel korelasyonlar (MS1 1.60-1.69 → 51.52% BTTS, MSX 4.33 → 74.31% İY gol)
 *  6. League-specific (Norway Div 2 → 64% BTTS, Iran Pro → 33% draw)
 */

export type OddsMarketKey =
  // 1X2
  | 'MS1_CLOSE' | 'MS1_OPEN'
  | 'MSX_CLOSE' | 'MSX_OPEN'
  | 'MS2_CLOSE' | 'MS2_OPEN'
  // Double chance
  | 'DC_1X_CLOSE' | 'DC_12_CLOSE' | 'DC_X2_CLOSE'
  // Draw no bet
  | 'DNB_1_CLOSE' | 'DNB_2_CLOSE'
  // Over/Under
  | 'OVER_05_CLOSE' | 'UNDER_05_CLOSE'
  | 'OVER_15_CLOSE' | 'UNDER_15_CLOSE'
  | 'OVER_25_CLOSE' | 'UNDER_25_CLOSE' | 'OVER_25_OPEN'
  | 'OVER_35_CLOSE' | 'UNDER_35_CLOSE'
  | 'OVER_45_CLOSE'
  // BTTS
  | 'BTTS_YES_CLOSE' | 'BTTS_NO_CLOSE' | 'BTTS_YES_OPEN'
  // First half
  | 'HT_05_OVER_CLOSE' | 'HT_05_UNDER_CLOSE'
  | 'HT_15_OVER_CLOSE' | 'HT_15_UNDER_CLOSE'
  | 'HT_MS1_CLOSE' | 'HT_MSX_CLOSE' | 'HT_MS2_CLOSE'
  | 'HT_BTTS_CLOSE'
  // HTFT (9 outcomes)
  | 'HTFT_11_CLOSE' | 'HTFT_11_OPEN'
  | 'HTFT_1X_CLOSE' | 'HTFT_1X_OPEN'
  | 'HTFT_12_CLOSE'
  | 'HTFT_X1_CLOSE' | 'HTFT_X1_OPEN'
  | 'HTFT_XX_CLOSE' | 'HTFT_XX_OPEN'
  | 'HTFT_X2_CLOSE'
  | 'HTFT_21_CLOSE' | 'HTFT_21_OPEN'
  | 'HTFT_2X_CLOSE'
  | 'HTFT_22_CLOSE' | 'HTFT_22_OPEN';

/**
 * Single condition: a market's odds must satisfy min/max bounds, optionally
 * checking for drift (open vs close comparison).
 */
export interface OddsCondition {
  market: OddsMarketKey;
  min?: number;
  max?: number;
  /**
   * If set, requires the odds to have moved in this direction from open to
   * close. 'shortening' = odds went DOWN (market expects outcome more),
   * 'drifting' = odds went UP (market expects outcome less).
   */
  drift?: 'shortening' | 'drifting';
  /** Minimum drift magnitude (ratio). E.g. 0.05 = 5% move. */
  driftThreshold?: number;
}

/**
 * Target market that a pattern predicts. Must match
 * `MarketKey` in `probet-engine.ts` so that UI can show a unified pick.
 */
export type PatternPredictionMarket =
  | 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'
  | 'DC_1X' | 'DC_12' | 'DC_X2'
  | 'OVER_05' | 'OVER_15' | 'OVER_25' | 'OVER_35'
  | 'UNDER_15' | 'UNDER_25' | 'UNDER_35'
  | 'BTTS_YES' | 'BTTS_NO'
  | 'HT_OVER_05' | 'HT_OVER_15' | 'HT_UNDER_15'
  | 'HT_HOME' | 'HT_DRAW' | 'HT_AWAY'
  | 'HTFT_11' | 'HTFT_1X' | 'HTFT_12'
  | 'HTFT_X1' | 'HTFT_XX' | 'HTFT_X2'
  | 'HTFT_21' | 'HTFT_2X' | 'HTFT_22';

export interface OddsPattern {
  id: string;
  name: string;
  category: 'htft' | 'goals' | 'btts' | 'result' | 'ht' | 'combo' | 'league';
  description: string;
  prediction: PatternPredictionMarket;
  predictionLabel: string;
  /** ALL conditions must be true (AND). */
  conditions: OddsCondition[];
  /**
   * Expected hit rate from the pattern source. Will be verified by
   * validate-odds-patterns.py against Pinnacle DB.
   */
  sourceHitRate: number;
  /**
   * Empirical hit rate from the historical DB (once validated).
   * Loaded from odds-pattern-calibration.json at runtime.
   */
  empiricalHitRate?: number;
  empiricalSampleSize?: number;
  /** When true, show as "🎯 Banko" — passes quality gate. */
  isBanko?: boolean;
  /** League restriction (optional) — only apply in these league IDs. */
  leagueIds?: number[];
}

export interface LiveOddsSnapshot {
  [K: string]: number | undefined;
}

export interface PatternMatch {
  pattern: OddsPattern;
  evidence: Array<{
    market: OddsMarketKey;
    oddsValue: number;
    satisfies: string;
  }>;
  hitRate: number;
  sampleSize: number;
  isBanko: boolean;
}

// ============================================================================
// BUILT-IN PATTERNS
// ============================================================================

export const BUILTIN_PATTERNS: OddsPattern[] = [
  // --------------------------------------------------------------------------
  // GROUP 1: KULLANICININ PAYLAŞTIĞI CORE PATTERN'LER
  // --------------------------------------------------------------------------
  {
    id: 'htft_2_1_classic',
    name: 'HTFT 2/1 Klasik Drift',
    category: 'htft',
    description:
      'MS1 kapanış 1.40-2.75, HTFT 2/1 açılıştan kapanışa kısalıyor (market 2/1 bekliyor), ' +
      'İY 1.5 Under, MS 2.5 Over, BTTS Yes makul — kullanıcının deneyim filtresi',
    prediction: 'HTFT_21',
    predictionLabel: 'İlk Yarı Deplasman / Maç Sonu Ev',
    conditions: [
      { market: 'MS1_CLOSE', min: 1.4, max: 2.75 },
      { market: 'HTFT_21_OPEN', min: 15, max: 51 },
      { market: 'HTFT_21_CLOSE', max: 35 },
      { market: 'HTFT_21_CLOSE', drift: 'shortening', driftThreshold: 0.05 },
      { market: 'HT_15_UNDER_CLOSE', min: 1.3, max: 1.8 },
      { market: 'OVER_25_CLOSE', max: 2.05 },
      { market: 'BTTS_YES_CLOSE', max: 1.95 },
    ],
    sourceHitRate: 0.065, // 6.5% is roughly 4x base rate
  },
  {
    id: 'btts_lock_o25_144',
    name: 'BTTS Lock @ O2.5 1.44',
    category: 'btts',
    description: 'Over 2.5 kapanış 1.40-1.48 aralığı → Bet365 sample verisine göre yüksek KG oranı',
    prediction: 'BTTS_YES',
    predictionLabel: 'KG Var',
    conditions: [
      { market: 'OVER_25_CLOSE', min: 1.4, max: 1.48 },
    ],
    sourceHitRate: 0.76,
  },
  {
    id: 'ms1_160_169_btts',
    name: 'MS1 1.60-1.69 → KG',
    category: 'btts',
    description:
      'Ev sahibi galibiyet oranı 1.60-1.69 → genelde KG var (empirical 51.52% across 39,810 matches)',
    prediction: 'BTTS_YES',
    predictionLabel: 'KG Var',
    conditions: [
      { market: 'MS1_CLOSE', min: 1.6, max: 1.69 },
    ],
    sourceHitRate: 0.5152,
  },
  {
    id: 'ms1_220_home',
    name: 'MS1 ~2.20 → Ev Kazanır',
    category: 'result',
    description: 'Ev sahibi galibiyet oranı 2.15-2.30 → tarihsel olarak ev sahibi galibiyet oranı yüksek',
    prediction: 'HOME_WIN',
    predictionLabel: 'Ev Sahibi Kazanır',
    conditions: [
      { market: 'MS1_CLOSE', min: 2.15, max: 2.3 },
    ],
    sourceHitRate: 0.48,
  },
  {
    id: 'msx_433_iy_gol',
    name: 'MSX 4.33 → İY Gol',
    category: 'ht',
    description:
      'Beraberlik oranı 4.15-4.55 → ilk yarıda en az bir gol olma olasılığı çok yüksek ' +
      '(empirical 74.31% across 15,683 matches)',
    prediction: 'HT_OVER_05',
    predictionLabel: 'İlk Yarı 0.5 Üst',
    conditions: [
      { market: 'MSX_CLOSE', min: 4.15, max: 4.55 },
    ],
    sourceHitRate: 0.7431,
  },
  {
    id: 'goal_stack_filter',
    name: 'Goal Stack Filtresi',
    category: 'combo',
    description:
      'İY 1.5 Over düşük + İY 0.5 Over çok düşük + DC 1X düşük + BTTS düşük → ' +
      '2.5 Üst / KG banko (kullanıcının goal stack formülü)',
    prediction: 'OVER_15',
    predictionLabel: '1.5 Üst',
    conditions: [
      { market: 'HT_15_OVER_CLOSE', max: 2.15 },
      { market: 'HT_05_OVER_CLOSE', max: 1.3 },
      { market: 'DC_1X_CLOSE', max: 1.35 },
      { market: 'BTTS_YES_CLOSE', max: 1.85 },
    ],
    sourceHitRate: 0.92,
  },
  {
    id: 'footystats_btts_stack',
    name: 'FootyStats BTTS Stack',
    category: 'combo',
    description:
      'BTTS ≤1.85 + Over 2.5 ≤1.70 + Over 1.5 ≤1.35 → BTTS banko ' +
      '(FootyStats tarzı combo filter)',
    prediction: 'BTTS_YES',
    predictionLabel: 'KG Var',
    conditions: [
      { market: 'BTTS_YES_CLOSE', max: 1.85 },
      { market: 'OVER_25_CLOSE', max: 1.7 },
      { market: 'OVER_15_CLOSE', max: 1.35 },
    ],
    sourceHitRate: 0.78,
  },

  // --------------------------------------------------------------------------
  // GROUP 2: LITERATÜR / BOOKMAKER WISDOM (10)
  // --------------------------------------------------------------------------
  {
    id: 'draw_low_goals',
    name: 'Beraberlik + Az Gol',
    category: 'result',
    description: 'Beraberlik oranı düşük + Over 2.5 oranı yüksek → defansif maç, beraberlik çıkabilir',
    prediction: 'DRAW',
    predictionLabel: 'Beraberlik',
    conditions: [
      { market: 'MSX_CLOSE', max: 3.5 },
      { market: 'OVER_25_CLOSE', min: 2.2 },
    ],
    sourceHitRate: 0.38,
  },
  {
    id: 'over_35_lock',
    name: 'Over 3.5 Lock',
    category: 'goals',
    description: 'Over 3.5 oranı 1.80-2.10 + BTTS ≤1.85 → yüksek gollü maç beklentisi',
    prediction: 'OVER_35',
    predictionLabel: '3.5 Üst',
    conditions: [
      { market: 'OVER_35_CLOSE', min: 1.8, max: 2.1 },
      { market: 'BTTS_YES_CLOSE', max: 1.85 },
    ],
    sourceHitRate: 0.56,
  },
  {
    id: 'underdog_win_value',
    name: 'Underdog Win Value',
    category: 'result',
    description: 'Deplasman oranı 5-8 + beraberlik oranı ≤3.30 → market fiyatlamasında deplasmana değer',
    prediction: 'AWAY_WIN',
    predictionLabel: 'Deplasman Kazanır',
    conditions: [
      { market: 'MS2_CLOSE', min: 5.0, max: 8.0 },
      { market: 'MSX_CLOSE', max: 3.3 },
    ],
    sourceHitRate: 0.18,
  },
  {
    id: 'strong_fav_home',
    name: 'Güçlü Ev Sahibi Favori',
    category: 'result',
    description: 'MS1 ≤1.50 + Over 1.5 ≤1.30 → ev sahibi net favori, yüksek güvenle kazanır',
    prediction: 'HOME_WIN',
    predictionLabel: 'Ev Sahibi Kazanır',
    conditions: [
      { market: 'MS1_CLOSE', max: 1.5 },
      { market: 'OVER_15_CLOSE', max: 1.3 },
    ],
    sourceHitRate: 0.72,
  },
  {
    id: 'defensive_match',
    name: 'Defansif Maç',
    category: 'goals',
    description: 'Over 2.5 oranı ≥2.35 + BTTS oranı ≥2.10 → az gollü maç beklentisi',
    prediction: 'UNDER_25',
    predictionLabel: '2.5 Alt',
    conditions: [
      { market: 'OVER_25_CLOSE', min: 2.35 },
      { market: 'BTTS_YES_CLOSE', min: 2.1 },
    ],
    sourceHitRate: 0.58,
  },
  {
    id: 'high_scoring_lock',
    name: 'Yüksek Skorlu Lock',
    category: 'goals',
    description: 'Over 1.5 ≤1.20 + Over 2.5 ≤1.65 → gollü maç neredeyse garanti',
    prediction: 'OVER_15',
    predictionLabel: '1.5 Üst',
    conditions: [
      { market: 'OVER_15_CLOSE', max: 1.2 },
      { market: 'OVER_25_CLOSE', max: 1.65 },
    ],
    sourceHitRate: 0.94,
  },
  {
    id: 'reverse_line_home',
    name: 'Reverse Line Move → Ev',
    category: 'result',
    description: 'MS1 açılıştan kapanışa %5+ kısalmış → sharp money evde, ev kazanır',
    prediction: 'HOME_WIN',
    predictionLabel: 'Ev Sahibi Kazanır',
    conditions: [
      { market: 'MS1_CLOSE', drift: 'shortening', driftThreshold: 0.05 },
    ],
    sourceHitRate: 0.52,
  },
  {
    id: 'steam_away',
    name: 'Steam Move → Deplasman',
    category: 'result',
    description: 'MS2 açılıştan kapanışa %5+ kısalmış → sharp money deplasmanda',
    prediction: 'AWAY_WIN',
    predictionLabel: 'Deplasman Kazanır',
    conditions: [
      { market: 'MS2_CLOSE', drift: 'shortening', driftThreshold: 0.05 },
    ],
    sourceHitRate: 0.5,
  },
  {
    id: 'dc_x2_safe',
    name: 'X2 Güvenli',
    category: 'result',
    description: 'DC X2 ≤1.35 + Over 2.5 ≤1.85 → deplasman kaybetmez + gol gelir',
    prediction: 'DC_X2',
    predictionLabel: 'Çifte Şans X2',
    conditions: [
      { market: 'DC_X2_CLOSE', max: 1.35 },
      { market: 'OVER_25_CLOSE', max: 1.85 },
    ],
    sourceHitRate: 0.78,
  },
  {
    id: 'btts_no_defensive',
    name: 'KG Yok Defansif',
    category: 'btts',
    description: 'BTTS No ≤1.75 + Over 2.5 ≥2.20 → gol olmaz',
    prediction: 'BTTS_NO',
    predictionLabel: 'KG Yok',
    conditions: [
      { market: 'BTTS_NO_CLOSE', max: 1.75 },
      { market: 'OVER_25_CLOSE', min: 2.2 },
    ],
    sourceHitRate: 0.62,
  },

  // --------------------------------------------------------------------------
  // GROUP 3: %90+ SUPER BANKO FILTRELERI
  // --------------------------------------------------------------------------
  {
    id: 'super_banko_over_05',
    name: 'Super Banko 0.5 Üst %97.3',
    category: 'goals',
    description:
      '0.5 Üst oranı 1.01-1.10 + 1.5 Alt oranı 2.20-3.50 → maçta en az bir gol olma olasılığı %97.3',
    prediction: 'OVER_05',
    predictionLabel: '0.5 Üst',
    conditions: [
      { market: 'OVER_05_CLOSE', min: 1.01, max: 1.1 },
      { market: 'UNDER_15_CLOSE', min: 2.2, max: 3.5 },
    ],
    sourceHitRate: 0.973,
  },
  {
    id: 'super_banko_ms1x',
    name: 'Super Banko MS1X %94.8',
    category: 'result',
    description: 'DC 1X oranı 1.20-1.30 + MS2 oranı 3.80-5.50 → ev sahibi kaybetmez',
    prediction: 'DC_1X',
    predictionLabel: 'Çifte Şans 1X',
    conditions: [
      { market: 'DC_1X_CLOSE', min: 1.2, max: 1.3 },
      { market: 'MS2_CLOSE', min: 3.8, max: 5.5 },
    ],
    sourceHitRate: 0.948,
  },
  {
    id: 'super_banko_ms2x',
    name: 'Super Banko MS2X %93.5',
    category: 'result',
    description: 'DC X2 oranı 1.25-1.35 + MS1 oranı 3.50-5.00 → deplasman kaybetmez',
    prediction: 'DC_X2',
    predictionLabel: 'Çifte Şans X2',
    conditions: [
      { market: 'DC_X2_CLOSE', min: 1.25, max: 1.35 },
      { market: 'MS1_CLOSE', min: 3.5, max: 5.0 },
    ],
    sourceHitRate: 0.935,
  },
  {
    id: 'super_banko_btts_no',
    name: 'Super Banko KG Yok %91.2',
    category: 'btts',
    description: 'BTTS No oranı 1.50-1.70 + Over 2.5 oranı 2.20-2.80 → KG gelmez',
    prediction: 'BTTS_NO',
    predictionLabel: 'KG Yok',
    conditions: [
      { market: 'BTTS_NO_CLOSE', min: 1.5, max: 1.7 },
      { market: 'OVER_25_CLOSE', min: 2.2, max: 2.8 },
    ],
    sourceHitRate: 0.912,
  },
  {
    id: 'low_scoring_match',
    name: 'Düşük Skorlu Maç %89.7',
    category: 'goals',
    description: 'Over 2.5 oranı 2.50-3.20 + BTTS No oranı 1.50-1.70 → 2.5 Alt geliyor',
    prediction: 'UNDER_25',
    predictionLabel: '2.5 Alt',
    conditions: [
      { market: 'OVER_25_CLOSE', min: 2.5, max: 3.2 },
      { market: 'BTTS_NO_CLOSE', min: 1.5, max: 1.7 },
    ],
    sourceHitRate: 0.897,
  },
  {
    id: 'strong_favorite_win',
    name: 'Favori Takım Kazanır %92.3',
    category: 'result',
    description: 'MS1 1.20-1.40 + DC 1X 1.05-1.15 → ev sahibi güçlü favori, yüksek kazanma oranı',
    prediction: 'HOME_WIN',
    predictionLabel: 'Ev Sahibi Kazanır',
    conditions: [
      { market: 'MS1_CLOSE', min: 1.2, max: 1.4 },
      { market: 'DC_1X_CLOSE', min: 1.05, max: 1.15 },
    ],
    sourceHitRate: 0.923,
  },

  // --------------------------------------------------------------------------
  // GROUP 4: HTFT ÖZELLİKLİ FILTRELER
  // --------------------------------------------------------------------------
  {
    id: 'htft_1_1_lock',
    name: 'HTFT 1/1 Lock %83.5',
    category: 'htft',
    description:
      'HTFT 1/1 kapanış 2.80-3.60 + MS1 1.45-1.80 + İY 1.5 Alt 1.40-1.70 → ev hem ilk yarı hem maç kazanır',
    prediction: 'HTFT_11',
    predictionLabel: 'İlk Yarı & Maç Sonu Ev',
    conditions: [
      { market: 'HTFT_11_CLOSE', min: 2.8, max: 3.6 },
      { market: 'MS1_CLOSE', min: 1.45, max: 1.8 },
      { market: 'HT_15_UNDER_CLOSE', min: 1.4, max: 1.7 },
    ],
    sourceHitRate: 0.835,
  },
  {
    id: 'htft_x_1_classic',
    name: 'HTFT X/1 Klasik %74.2',
    category: 'htft',
    description:
      'HTFT X/1 kapanış 4.50-6.00 + İY MSX 1.80-2.30 + MS1 1.60-2.10 → ev ikinci yarıda öne geçer',
    prediction: 'HTFT_X1',
    predictionLabel: 'İlk Yarı Beraberlik / Maç Sonu Ev',
    conditions: [
      { market: 'HTFT_X1_CLOSE', min: 4.5, max: 6.0 },
      { market: 'HT_MSX_CLOSE', min: 1.8, max: 2.3 },
      { market: 'MS1_CLOSE', min: 1.6, max: 2.1 },
    ],
    sourceHitRate: 0.742,
  },
  {
    id: 'htft_x_x_draw',
    name: 'HTFT X/X Beraberlik %71.8',
    category: 'htft',
    description: 'HTFT X/X kapanış 4.50-5.50 + MSX 3.00-3.50 + Over 2.5 oranı ≥2.20 → iki yarı da beraberlik',
    prediction: 'HTFT_XX',
    predictionLabel: 'İlk Yarı & Maç Sonu Beraberlik',
    conditions: [
      { market: 'HTFT_XX_CLOSE', min: 4.5, max: 5.5 },
      { market: 'MSX_CLOSE', min: 3.0, max: 3.5 },
      { market: 'OVER_25_CLOSE', min: 2.2 },
    ],
    sourceHitRate: 0.718,
  },
  {
    id: 'htft_2_2_away_lock',
    name: 'HTFT 2/2 Deplasman Lock',
    category: 'htft',
    description:
      'HTFT 2/2 kapanış 3.50-5.00 + MS2 1.65-2.30 + İY MS2 2.20-3.00 → deplasman her iki yarıyı da kazanır',
    prediction: 'HTFT_22',
    predictionLabel: 'İlk Yarı & Maç Sonu Deplasman',
    conditions: [
      { market: 'HTFT_22_CLOSE', min: 3.5, max: 5.0 },
      { market: 'MS2_CLOSE', min: 1.65, max: 2.3 },
      { market: 'HT_MS2_CLOSE', min: 2.2, max: 3.0 },
    ],
    sourceHitRate: 0.69,
  },

  // --------------------------------------------------------------------------
  // GROUP 5: ÖZEL KORELASYONLAR
  // --------------------------------------------------------------------------
  {
    id: 'msx_310_320_draw',
    name: 'MSX 3.10-3.20 → Beraberlik',
    category: 'result',
    description:
      'Beraberlik oranı 3.10-3.20 aralığı → historical 28.92% across 102,985 matches',
    prediction: 'DRAW',
    predictionLabel: 'Beraberlik',
    conditions: [
      { market: 'MSX_CLOSE', min: 3.1, max: 3.2 },
    ],
    sourceHitRate: 0.2892,
  },
  {
    id: 'ms1_185_203_home',
    name: 'MS1 1.85-2.03 → Ev Sahibi',
    category: 'result',
    description: 'MS1 1.85-2.03 aralığında → ev kazanma oranı yüksek, underdog için küçük',
    prediction: 'HOME_WIN',
    predictionLabel: 'Ev Sahibi Kazanır',
    conditions: [
      { market: 'MS1_CLOSE', min: 1.85, max: 2.03 },
    ],
    sourceHitRate: 0.48,
  },
  {
    id: 'ms1_250_300_upset',
    name: 'MS1 2.50-3.00 Sürpriz Beraberlik',
    category: 'result',
    description: 'MS1 2.50-3.00 → yakın maç, beraberlik ihtimali yüksek',
    prediction: 'DRAW',
    predictionLabel: 'Beraberlik',
    conditions: [
      { market: 'MS1_CLOSE', min: 2.5, max: 3.0 },
      { market: 'MSX_CLOSE', max: 3.25 },
    ],
    sourceHitRate: 0.31,
  },

  // --------------------------------------------------------------------------
  // GROUP 6: LIG-SPECIFIC PATTERN'LER
  // --------------------------------------------------------------------------
  {
    id: 'norway_div2_btts',
    name: 'Norveç Div 2 → KG',
    category: 'league',
    description: 'Norveç Division 2 Gruplari → historical 64% BTTS oranı',
    prediction: 'BTTS_YES',
    predictionLabel: 'KG Var',
    conditions: [
      { market: 'BTTS_YES_CLOSE', max: 1.95 },
    ],
    sourceHitRate: 0.64,
    leagueIds: [104], // Norway Division 2 — placeholder, gerçek ID set'lenecek
  },
  {
    id: 'iran_pro_draw',
    name: 'Iran Pro League → Beraberlik Yüksek',
    category: 'league',
    description: 'Iran Pro League → tarihsel 33.39% beraberlik oranı',
    prediction: 'DRAW',
    predictionLabel: 'Beraberlik',
    conditions: [
      { market: 'MSX_CLOSE', max: 3.6 },
    ],
    sourceHitRate: 0.3339,
    leagueIds: [290], // Iran Pro League — placeholder
  },

  // --------------------------------------------------------------------------
  // GROUP 7: ADDITIONAL HIGH-VALUE FILTRELER
  // --------------------------------------------------------------------------
  {
    id: 'ht_goal_msx_lock',
    name: 'İY Gol (MSX Yüksek)',
    category: 'ht',
    description: 'Beraberlik oranı ≥4.00 + İY 0.5 Over ≤1.30 → ilk yarı gol banko',
    prediction: 'HT_OVER_05',
    predictionLabel: 'İlk Yarı 0.5 Üst',
    conditions: [
      { market: 'MSX_CLOSE', min: 4.0 },
      { market: 'HT_05_OVER_CLOSE', max: 1.3 },
    ],
    sourceHitRate: 0.78,
  },
  {
    id: 'ht_no_goal_defensive',
    name: 'İY Gol Yok (Defansif)',
    category: 'ht',
    description: 'İY 0.5 Under ≤1.80 + Over 2.5 ≥2.50 → ilk yarı gol gelmez',
    prediction: 'HT_UNDER_15',
    predictionLabel: 'İlk Yarı 1.5 Alt',
    conditions: [
      { market: 'HT_05_UNDER_CLOSE', max: 1.8 },
      { market: 'OVER_25_CLOSE', min: 2.5 },
    ],
    sourceHitRate: 0.85,
  },
  {
    id: 'mega_goals_lock',
    name: 'Mega Gol Lock',
    category: 'goals',
    description: 'Over 0.5 ≤1.05 + Over 1.5 ≤1.22 + Over 2.5 ≤1.50 → 2.5 Üst neredeyse garanti',
    prediction: 'OVER_25',
    predictionLabel: '2.5 Üst',
    conditions: [
      { market: 'OVER_05_CLOSE', max: 1.05 },
      { market: 'OVER_15_CLOSE', max: 1.22 },
      { market: 'OVER_25_CLOSE', max: 1.5 },
    ],
    sourceHitRate: 0.88,
  },
];

// ============================================================================
// RUNTIME PATTERN MATCHING
// ============================================================================

/**
 * Check if live odds snapshot satisfies a single condition.
 */
function checkCondition(
  condition: OddsCondition,
  snapshot: LiveOddsSnapshot
): { satisfied: boolean; value: number; reason: string } {
  const value = snapshot[condition.market];
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 1.0) {
    return { satisfied: false, value: 0, reason: `${condition.market} yok` };
  }

  // Min/max bounds check
  if (condition.min !== undefined && value < condition.min) {
    return {
      satisfied: false,
      value,
      reason: `${condition.market} ${value.toFixed(2)} < ${condition.min}`,
    };
  }
  if (condition.max !== undefined && value > condition.max) {
    return {
      satisfied: false,
      value,
      reason: `${condition.market} ${value.toFixed(2)} > ${condition.max}`,
    };
  }

  // Drift check (compare OPEN vs CLOSE for same market)
  if (condition.drift) {
    const openKey = condition.market.replace('_CLOSE', '_OPEN') as OddsMarketKey;
    const openValue = snapshot[openKey];
    if (openValue === undefined || openValue === null || !Number.isFinite(openValue) || openValue <= 1.0) {
      // No open value available — skip drift check (don't fail)
      return {
        satisfied: true,
        value,
        reason: `${condition.market} ${value.toFixed(2)} (drift check skipped — no open odds)`,
      };
    }
    const ratio = (openValue - value) / openValue;
    const threshold = condition.driftThreshold ?? 0.03;
    if (condition.drift === 'shortening' && ratio < threshold) {
      return {
        satisfied: false,
        value,
        reason: `${condition.market} kısalması yetersiz (${(ratio * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%)`,
      };
    }
    if (condition.drift === 'drifting' && -ratio < threshold) {
      return {
        satisfied: false,
        value,
        reason: `${condition.market} genişlemesi yetersiz`,
      };
    }
  }

  const rangeStr =
    condition.min !== undefined && condition.max !== undefined
      ? `[${condition.min}-${condition.max}]`
      : condition.min !== undefined
        ? `≥${condition.min}`
        : condition.max !== undefined
          ? `≤${condition.max}`
          : '';
  return {
    satisfied: true,
    value,
    reason: `${condition.market} ${value.toFixed(2)} ∈ ${rangeStr}`,
  };
}

/**
 * Check all conditions of a pattern — returns match result with evidence.
 */
export function matchPattern(
  pattern: OddsPattern,
  snapshot: LiveOddsSnapshot,
  leagueId?: number
): PatternMatch | null {
  // League filter
  if (pattern.leagueIds && pattern.leagueIds.length > 0 && leagueId !== undefined) {
    if (!pattern.leagueIds.includes(leagueId)) return null;
  }

  const evidence: PatternMatch['evidence'] = [];
  for (const condition of pattern.conditions) {
    const result = checkCondition(condition, snapshot);
    if (!result.satisfied) return null;
    evidence.push({
      market: condition.market,
      oddsValue: result.value,
      satisfies: result.reason,
    });
  }

  const hitRate = pattern.empiricalHitRate ?? pattern.sourceHitRate;
  const sampleSize = pattern.empiricalSampleSize ?? 0;
  // "Banko" gate: either empirically validated OR has strong source claim
  const isBanko =
    pattern.isBanko ??
    (hitRate >= 0.75 && (sampleSize >= 500 || pattern.sourceHitRate >= 0.85));

  return {
    pattern,
    evidence,
    hitRate,
    sampleSize,
    isBanko,
  };
}

/**
 * Match all built-in patterns against a live odds snapshot.
 * Returns matched patterns sorted by hit rate descending (banko first).
 */
export function matchAllPatterns(
  snapshot: LiveOddsSnapshot,
  options: {
    leagueId?: number;
    patterns?: OddsPattern[];
    minHitRate?: number;
  } = {}
): PatternMatch[] {
  const patterns = options.patterns ?? BUILTIN_PATTERNS;
  const minHitRate = options.minHitRate ?? 0.0;

  const matches: PatternMatch[] = [];
  for (const pattern of patterns) {
    const match = matchPattern(pattern, snapshot, options.leagueId);
    if (!match) continue;
    if (match.hitRate < minHitRate) continue;
    matches.push(match);
  }

  matches.sort((a, b) => {
    // Banko patterns first, then by hit rate
    if (a.isBanko !== b.isBanko) return a.isBanko ? -1 : 1;
    return b.hitRate - a.hitRate;
  });

  return matches;
}

/**
 * Load empirical hit rates from calibration JSON into the built-in patterns.
 * Call this once at engine startup; mutates BUILTIN_PATTERNS in place.
 */
export function loadPatternCalibration(
  calibration: Record<string, { hitRate: number; sampleSize: number; isBanko: boolean }>
): void {
  for (const pattern of BUILTIN_PATTERNS) {
    const cal = calibration[pattern.id];
    if (!cal) continue;
    pattern.empiricalHitRate = cal.hitRate;
    pattern.empiricalSampleSize = cal.sampleSize;
    pattern.isBanko = cal.isBanko;
  }
}
