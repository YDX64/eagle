/**
 * ProBet Türkçe Etiket Yardımcıları
 *
 * SystemCategory, RiskLevel ve Market ID'lerini kullanıcının anlayacağı
 * Türkçe açıklamalara çevirir. UI'da teknik terimler yerine bu etiketler
 * gösterilir.
 */

export type SystemCategoryKey = 'HTFT' | 'SCORE' | 'KG_SPLIT' | 'UPSET' | 'COMBO' | 'GOAL_VALUE';
export type RiskLevelKey = 'low' | 'medium' | 'high';

export interface CategoryInfo {
  label: string;        // Kısa Türkçe isim
  description: string;  // Ne olduğunu açıklayan 1 cümle
  emoji: string;
}

export const CATEGORY_TR: Record<SystemCategoryKey, CategoryInfo> = {
  HTFT: {
    label: 'İlk Yarı / Maç Sonu',
    description: 'İlk yarı sonucu × maç sonu birleşimi (örn: İY 1 / MS 2 — ev kazanır yarıda, deplasman kazanır sonda).',
    emoji: '⏱️',
  },
  SCORE: {
    label: 'Tam Skor',
    description: 'Maçın biteceği kesin skor (1-0, 2-1 gibi). Düşük isabet, yüksek oran.',
    emoji: '🎯',
  },
  KG_SPLIT: {
    label: 'Karşılıklı Gol (Yarı Bazlı)',
    description: 'Her iki takımın gol atma senaryosu yarı bazında bölünmüş.',
    emoji: '⚽',
  },
  UPSET: {
    label: 'Sürpriz Sonuç',
    description: 'Beklenmedik underdog (alt takım) kazanır. Oran yüksek, mantıklı olasılık varsa değerli.',
    emoji: '🎲',
  },
  COMBO: {
    label: 'Kombinasyon Bahsi',
    description: 'Çoklu bahisleri birleştiren kombo. Tüm ayaklar tutmalı.',
    emoji: '🎫',
  },
  GOAL_VALUE: {
    label: 'Gol Bahsi Değer',
    description: 'Alt/Üst (Over/Under) gol bahislerinde değerli tespit.',
    emoji: '📊',
  },
};

export interface RiskInfo {
  label: string;
  shortLabel: string;
  description: string;
  colorClass: string;
  bgClass: string;
  emoji: string;
}

export const RISK_TR: Record<RiskLevelKey, RiskInfo> = {
  low: {
    label: 'Güvenli Oyun',
    shortLabel: 'Güvenli',
    description: 'Olasılık ≥%50, oran ≤2.50 — düşük risk, ana bahis adayı.',
    colorClass: 'text-emerald-700 dark:text-emerald-300',
    bgClass: 'bg-emerald-500/15 border-emerald-500/40',
    emoji: '🟢',
  },
  medium: {
    label: 'Dengeli Oyun',
    shortLabel: 'Dengeli',
    description: 'Olasılık ≥%30, oran ≤5.00 — orta risk, sistem kupon aday.',
    colorClass: 'text-amber-700 dark:text-amber-300',
    bgClass: 'bg-amber-500/15 border-amber-500/40',
    emoji: '🟡',
  },
  high: {
    label: 'Riskli / Cesur',
    shortLabel: 'Riskli',
    description: 'Düşük olasılık × yüksek oran. Değer varsa küçük stake ile oyna.',
    colorClass: 'text-rose-700 dark:text-rose-300',
    bgClass: 'bg-rose-500/15 border-rose-500/40',
    emoji: '🔴',
  },
};

/**
 * Market ID → Türkçe açıklama. Backend'ten gelen marketLabel halihazırda
 * Türkçe ama bazıları takım adı eklediği için kısaltılmış bir varyant daha
 * veriyoruz ve pick kartlarında gösterilmeyen market ID'ler için fallback.
 */
export const MARKET_TR: Record<string, string> = {
  // Maç sonu
  HOME_WIN: 'Ev Sahibi Kazanır',
  AWAY_WIN: 'Deplasman Kazanır',
  DRAW: 'Beraberlik',
  // Çifte şans
  DC_1X: 'Çifte Şans 1X (Ev kazanır veya berabere)',
  DC_X2: 'Çifte Şans X2 (Berabere veya deplasman)',
  DC_12: 'Çifte Şans 12 (Berabere olmaz)',
  // Beraberlikte iade
  DNB_HOME: 'DNB — Ev (berabere kalırsa iade)',
  DNB_AWAY: 'DNB — Deplasman (berabere kalırsa iade)',
  // Toplam gol
  OVER_05: '0.5 Üst (en az 1 gol)',
  OVER_15: '1.5 Üst (en az 2 gol)',
  OVER_25: '2.5 Üst (en az 3 gol)',
  OVER_35: '3.5 Üst (en az 4 gol)',
  UNDER_15: '1.5 Alt (en fazla 1 gol)',
  UNDER_25: '2.5 Alt (en fazla 2 gol)',
  UNDER_35: '3.5 Alt (en fazla 3 gol)',
  UNDER_45: '4.5 Alt (en fazla 4 gol)',
  UNDER_55: '5.5 Alt (en fazla 5 gol)',
  // İlk yarı
  HT_OVER_05: 'İY 0.5 Üst',
  HT_OVER_15: 'İY 1.5 Üst',
  HT_UNDER_15: 'İY 1.5 Alt',
  // Takım bazlı gol
  HOME_OVER_05: 'Ev sahibi gol atar',
  HOME_OVER_15: 'Ev sahibi 2+ gol atar',
  HOME_OVER_25: 'Ev sahibi 3+ gol atar',
  HOME_UNDER_15: 'Ev sahibi ≤1 gol atar',
  HOME_UNDER_25: 'Ev sahibi ≤2 gol atar',
  AWAY_OVER_05: 'Deplasman gol atar',
  AWAY_OVER_15: 'Deplasman 2+ gol atar',
  AWAY_UNDER_15: 'Deplasman ≤1 gol atar',
  AWAY_UNDER_25: 'Deplasman ≤2 gol atar',
  // KG
  BTTS_YES: 'Karşılıklı Gol Var',
  BTTS_NO: 'Karşılıklı Gol Yok',
  BTTS_YES_OVER_25: 'KG Var + 2.5 Üst',
  BTTS_NO_UNDER_25: 'KG Yok + 2.5 Alt',
  // Clean sheet
  HOME_CLEAN_SHEET: 'Ev sahibi gol yemez',
  AWAY_CLEAN_SHEET: 'Deplasman gol yemez',
  HOME_WIN_TO_NIL: 'Ev sahibi gol yemeden kazanır',
  AWAY_WIN_TO_NIL: 'Deplasman gol yemeden kazanır',
  // Asian handicap
  AH_HOME_PLUS_1: 'Handikap: Ev +1 (kaybetmezse veya 1 farkla kaybederse)',
  AH_HOME_MINUS_1: 'Handikap: Ev -1 (2+ farkla kazanır)',
  AH_AWAY_PLUS_1: 'Handikap: Deplasman +1 (kaybetmezse veya 1 farkla kaybederse)',
  AH_AWAY_MINUS_1: 'Handikap: Deplasman -1 (2+ farkla kazanır)',
  // HTFT
  HTFT: 'İlk Yarı / Maç Sonu',
  CORRECT_SCORE: 'Tam Skor',
};

export function getCategoryInfo(cat?: string | null): CategoryInfo | null {
  if (!cat) return null;
  return CATEGORY_TR[cat as SystemCategoryKey] || null;
}

export function getRiskInfo(risk?: string | null): RiskInfo | null {
  if (!risk) return null;
  return RISK_TR[risk as RiskLevelKey] || null;
}

export function getMarketLabel(marketId?: string | null): string | null {
  if (!marketId) return null;
  return MARKET_TR[marketId] || null;
}

/**
 * ROI değerine göre renk sınıfı döndürür.
 * >+20%: strong green (ideal oyun)
 * +5..+20%: green (kârlı)
 * -5..+5%: gray (başa baş)
 * <-5%: red (zararlı — kaçın)
 */
export function roiColorClass(roiPct: number | null | undefined): string {
  if (roiPct === null || roiPct === undefined) return 'text-muted-foreground';
  if (roiPct >= 20) return 'text-emerald-700 dark:text-emerald-300 font-bold';
  if (roiPct >= 5) return 'text-emerald-600 dark:text-emerald-400';
  if (roiPct >= -5) return 'text-muted-foreground';
  return 'text-rose-600 dark:text-rose-400';
}

export function roiEmoji(roiPct: number | null | undefined): string {
  if (roiPct === null || roiPct === undefined) return '—';
  if (roiPct >= 20) return '💎';
  if (roiPct >= 5) return '✅';
  if (roiPct >= -5) return '⚖️';
  return '❌';
}

/**
 * Winrate değerine göre renk/emoji.
 * ≥80%: mavi (elit)
 * 65..80%: yeşil (güvenilir)
 * 50..65%: sarı (orta)
 * <50%: kırmızı (zayıf)
 */
export function winrateColorClass(wr: number): string {
  if (wr >= 0.80) return 'text-sky-700 dark:text-sky-300';
  if (wr >= 0.65) return 'text-emerald-700 dark:text-emerald-300';
  if (wr >= 0.50) return 'text-amber-700 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-300';
}

export function winrateBgClass(wr: number): string {
  if (wr >= 0.80) return 'bg-sky-500/15 border-sky-500/40';
  if (wr >= 0.65) return 'bg-emerald-500/15 border-emerald-500/40';
  if (wr >= 0.50) return 'bg-amber-500/15 border-amber-500/40';
  return 'bg-rose-500/15 border-rose-500/40';
}
