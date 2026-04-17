/**
 * IDDAA.COM MARKET WHITELIST
 *
 * Api-sports.io'da olan FAKAT iddaa.com'da OLMAYAN marketler bu sistemde
 * göstermemeli. Kullanıcı gerçek iddaa'da oynayacağı için.
 *
 * Referans: iddaa.com'daki resmi bahis türleri her spor için ayrı listelenmiştir.
 */

import type { SportId } from '../sports/_core/types';

/**
 * Her spor için iddaa'da MEVCUT olan api-sports bet name listesi.
 * Case-insensitive prefix match ile karşılaştırılır.
 */
export const IDDAA_MARKETS: Record<SportId, string[]> = {
  football: [
    'Match Winner',                    // Maç Sonucu (MS)
    'Home/Away',                       // Beraberlik Yok
    'Double Chance',                   // Çifte Şans
    'First Half Winner',               // 1. Yarı Sonucu
    'Second Half Winner',              // 2. Yarı Sonucu
    'Both Teams Score',                // Karşılıklı Gol (KG)
    'Both Teams To Score',             // KG (alt alias)
    'Goals Over/Under',                // Alt/Üst
    'Goals Over/Under First Half',     // 1. Yarı Alt/Üst
    'Exact Score',                     // Skor Tahmini
    'HT/FT Double',                    // İY/MS
    'Total - Home',                    // Ev Sahibi Toplam Gol
    'Total - Away',                    // Deplasman Toplam Gol
    'Odd/Even',                        // Tek/Çift
    'Home Odd/Even',                   // Ev Sahibi Tek/Çift
    'Exact Goals Number',              // Toplam Gol Sayısı
    'Results/Total Goals',             // MS + Alt/Üst 2.5 kombine
    'Winning Margin',                  // Kazanma Farkı
    'Handicap Result',                 // Handikaplı Maç Sonucu (NOT Asian - iddaa normal handikap)
    'Team To Score First',             // İlk Golü Atan Takım
    'Team To Score Last',              // Son Golü Atan Takım
  ],

  hockey: [
    '3Way Result',                     // Maç Sonucu (Normal Süre)
    'Home/Away (Reg Time)',            // Beraberlik Yok (Normal Süre)
    'Home/Away',                       // Beraberlik Yok
    'Over/Under',                      // Alt/Üst
    'Over/Under (Reg Time)',           // Normal Süre Alt/Üst
    'Both Teams To Score',             // KG
    'Double Chance',                   // Çifte Şans
    'Odd/Even',                        // Tek/Çift
    'Over/Under - Period 1',           // 1. Periyot Alt/Üst
    'Over/Under - Period 2',           // 2. Periyot Alt/Üst
    'Over/Under - Period 3',           // 3. Periyot Alt/Üst
    '3Way Result - Period 1',          // 1. Periyot Sonucu
    // NOT: 'Asian Handicap' - İddaa'da hokey için yok
    // NOT: 'Handicap' (split format) - İddaa standart handicap almaz
  ],

  basketball: [
    'Home/Away',                       // Maç Sonucu (uzatma dahil)
    'Asian Handicap',                  // Handikap - basketbol için iddaa'da var
    'Handicap',                        // Handikap
    'Over/Under',                      // Alt/Üst (toplam sayı)
    'Odd/Even',                        // Tek/Çift
    '1st Quarter Winner',              // 1. Çeyrek Sonucu
    // 'Quarter Handicap' NOT in iddaa
    // 'Highest Scoring Quarter' NOT in iddaa
    // 'Both Teams Total Points' NOT in iddaa typically
  ],

  nba: [
    'Home/Away',                       // Maç Sonucu
    'Moneyline',                       // Maç Sonucu (alias)
    'Asian Handicap',                  // Handikaplı Maç (NBA'de iddaa var)
    'Spread',                          // Handikap
    'Handicap',                        // Handikap
    'Over/Under',                      // Toplam Sayı Alt/Üst
    'Odd/Even',                        // Tek/Çift
  ],

  handball: [
    '3-Way Result',                    // Maç Sonucu
    'Match Winner',                    // Maç Sonucu (alias)
    'Home/Away',                       // Beraberlik Yok
    'Double Chance',                   // Çifte Şans
    'Over/Under',                      // Toplam Gol Alt/Üst
    'Handicap',                        // Handikaplı Maç
    'Asian Handicap',                  // Handikap
    '1st Half Winner',                 // 1. Yarı Sonucu
    // 1st Half Over/Under genelde iddaa'da yok hentbol için
  ],

  americanFootball: [
    'Home/Away',                       // Maç Sonucu
    'Moneyline',                       // Maç Sonucu (alias)
    'Spread',                          // Handikap
    'Handicap',                        // Handikap
    'Over/Under',                      // Toplam Sayı Alt/Üst
    'Odd/Even',                        // Tek/Çift
    // 'Team Total' NOT typically in iddaa
    // '1st Quarter Winner' var bazı zamanlar, conservative bırakıyoruz
  ],

  baseball: [
    'Home/Away',                       // Maç Sonucu
    'Moneyline',                       // Maç Sonucu (alias)
    'Run Line',                        // Run Çizgisi (iddaa'da var)
    'Over/Under',                      // Toplam Run Alt/Üst
    'Odd/Even',                        // Tek/Çift
    // 'First 5 Innings' - iddaa'da yok genelde
    // 'Asian Handicap' - yok
  ],

  volleyball: [
    'Home/Away',                       // Maç Sonucu
    'Match Winner',                    // Maç Sonucu (alias)
    'Asian Handicap',                  // Set Handikap (iddaa voleybol için var)
    'Total Sets',                      // Toplam Set Alt/Üst (3.5)
    'Correct Set Score',               // Set Skoru
    // '1st Set Winner' - iddaa'da var ama detay
    'First Set Winner',
  ],

  rugby: [
    'Match Winner',                    // Maç Sonucu
    '3-Way',                           // alias
    'Home/Away',                       // Beraberlik Yok
    'Handicap',                        // Handikap
    'Asian Handicap',                  // Handikap
    'Over/Under',                      // Alt/Üst
    'Odd/Even',                        // Tek/Çift
  ],

  mma: [
    'Fighter Winner',                  // Galip Dövüşçü
    'Match Winner',                    // alias
    'Moneyline',                       // alias
    'Method of Victory',               // Kazanma Yöntemi
    'Total Rounds Over/Under',         // Toplam Round Alt/Üst
    'Total Rounds',                    // alias
    'Fight to Go Distance',            // Dövüş Süreyi Tamamlar mı
    // Round betting varsa da ince detay - conservative
  ],

  afl: [
    'Home/Away',                       // Maç Sonucu
    'Match Winner',                    // alias
    'Handicap',                        // Handikap
    'Asian Handicap',                  // Handikap
    'Over/Under',                      // Alt/Üst
  ],

  formula1: [
    'Race Winner',                     // Yarış Kazananı
    'Podium Finish',                   // Podium
    // F1 iddaa sınırlı
  ],
};

/**
 * Bahis adı iddaa'da var mı kontrol et
 * Case-insensitive, prefix match
 */
export function isIddaaMarket(sportId: SportId, betName: string): boolean {
  const whitelist = IDDAA_MARKETS[sportId] || [];
  const normalized = betName.toLowerCase().trim();
  return whitelist.some(allowed => {
    const allowedLower = allowed.toLowerCase();
    // Exact match OR prefix match (for e.g. "Over/Under" matches "Over/Under (Reg Time)")
    return normalized === allowedLower || normalized.startsWith(allowedLower);
  });
}

/**
 * İddaa'daki Türkçe adı döndür
 */
export function getIddaaName(sportId: SportId, betName: string): string {
  const map: Record<string, string> = {
    // Football
    'Match Winner': 'Maç Sonucu',
    'Home/Away': 'Beraberlik Yok',
    'Double Chance': 'Çifte Şans',
    'First Half Winner': '1. Yarı Sonucu',
    'Both Teams Score': 'Karşılıklı Gol',
    'Both Teams To Score': 'Karşılıklı Gol',
    'Goals Over/Under': 'Alt/Üst',
    'Exact Score': 'Skor Tahmini',
    'HT/FT Double': 'İY/MS',
    'Odd/Even': 'Tek/Çift',
    'Handicap Result': 'Handikaplı Maç Sonucu',
    // Hockey
    '3Way Result': 'Maç Sonucu (Normal Süre)',
    'Over/Under': 'Alt/Üst',
    'Over/Under (Reg Time)': 'Alt/Üst (Normal Süre)',
    'Home/Away (Reg Time)': 'Beraberlik Yok (Normal Süre)',
    // Basketball/NBA
    'Moneyline': 'Maç Sonucu',
    'Asian Handicap': 'Handikaplı Maç',
    'Handicap': 'Handikap',
    'Spread': 'Handikap',
    '1st Quarter Winner': '1. Çeyrek Sonucu',
    // Handball
    '3-Way Result': 'Maç Sonucu',
    '1st Half Winner': '1. Yarı Sonucu',
    // Baseball
    'Run Line': 'Run Çizgisi',
    // Volleyball
    'Total Sets': 'Toplam Set',
    'Correct Set Score': 'Set Skoru',
    'First Set Winner': '1. Set Sonucu',
    // MMA
    'Fighter Winner': 'Galip Dövüşçü',
    'Method of Victory': 'Kazanma Yöntemi',
    'Total Rounds Over/Under': 'Toplam Round Alt/Üst',
    'Fight to Go Distance': 'Süre Tamamlanır mı',
    // F1
    'Race Winner': 'Yarış Kazananı',
    'Podium Finish': 'Podium Finish',
  };
  return map[betName] || betName;
}

/**
 * Sanity check: bahisin istatistiksel olarak makul olup olmadığını kontrol et.
 * Yüksek probabability × yüksek odds = bug işareti.
 *
 * Reel bahis piyasasında:
 * - Gerçek %95 olasılıklı bir bet: odds ~1.04-1.08 (implied %93-96)
 * - Gerçek %85 olasılıklı bir bet: odds ~1.15-1.20
 * - Gerçek %70 olasılıklı bir bet: odds ~1.40-1.43
 *
 * Eğer trueProb > %95 AND odds > 2.0 → ya algoritma hatalı ya da piyasa trap.
 * İkisinden biri olmadan hiç edge olmamalı.
 */
export function isSanityChecked(trueProb: number, odds: number): {
  ok: boolean;
  reason?: string;
} {
  if (trueProb <= 0 || trueProb > 1) {
    return { ok: false, reason: `Probability out of range: ${trueProb}` };
  }
  if (odds < 1.01) {
    return { ok: false, reason: `Odds too low: ${odds}` };
  }

  const implied = 1 / odds;

  // Rule 1: Trueprob bir oran olarak implied'in 1.8 katından fazla olmamalı
  // (piyasa yanlış olabilir ama 80% edge'ten fazla = kesinlikle algoritma hatası)
  // Cap at 90% to prevent degenerate overconfidence.
  const maxReasonableProb = Math.min(implied * 1.80, 0.90);

  if (trueProb > maxReasonableProb) {
    return {
      ok: false,
      reason: `Unrealistic: trueProb ${(trueProb * 100).toFixed(1)}% vs max ${(maxReasonableProb * 100).toFixed(1)}% (odds ${odds})`,
    };
  }

  // Rule 2: Edge > %80 = kesin bug
  const edge = (trueProb - implied) / implied;
  if (edge > 0.80) {
    return {
      ok: false,
      reason: `Edge too high: ${(edge * 100).toFixed(1)}% - likely algorithm bug`,
    };
  }

  // Rule 3: Yüksek oranlarda (3+) çok yüksek probability = overconfidence
  // 3.00+ odds'a sahip market genelde underdog veya unusual - 70%+ prob mantıksız
  if (trueProb > 0.70 && odds > 3.00) {
    return {
      ok: false,
      reason: `Overconfident at high odds: ${(trueProb * 100).toFixed(1)}% @ ${odds}`,
    };
  }

  // Rule 4: Çok düşük oranlarda (<1.15) bazı güvenlik önlemi
  // 1.10 odds = implied 91%, prob < 70% şüpheli (çok negatif edge)
  if (trueProb < 0.50 && odds < 1.50) {
    return {
      ok: false,
      reason: `Too negative expectation: ${(trueProb * 100).toFixed(1)}% @ ${odds}`,
    };
  }

  return { ok: true };
}
