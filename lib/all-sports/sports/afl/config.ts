import type { SportConfig } from '../_core/types';

/**
 * Australian Football League (AFL) Sport Configuration
 * v1.afl.api-sports.io
 *
 * Karakteristik:
 * - Çok yüksek skorlu (~170 toplam sayı, ev ~90, deplasman ~82)
 * - Yüksek varyans (her takım için stdDev ~18 sayı)
 * - Normal (Gaussian) dağılım uygundur (skor >> 10, Poisson zayıf kalır)
 * - 4 çeyrek, maç süresi ~80 dakika net oyun (çeyrek başı ~20 dakika)
 * - AFL'de beraberlik NADIR ama mümkündür ("drawn match")
 *   -> drawBuffer küçük tutulur (~0.5 puan)
 * - Ev avantajı görece yüksek (~%7), uzun mesafe seyahat etkisi
 * - Handikap (Line) pazarı çok popüler; tipik çizgiler -30.5 ile +30.5 arası
 * - Toplam (Over/Under) çizgileri 150.5 – 190.5 arasında tipik (markette "170.5" yaygın)
 * - Asian Handicap & Moneyline aktif
 * - İddaa kategori kodu: AFL
 */

export const aflConfig: SportConfig = {
  id: 'afl',
  displayName: 'Australian Football',
  displayNameTR: 'Avustralya Futbolu (AFL)',
  apiBase: 'https://v1.afl.api-sports.io',
  apiKey: '',
  avgScoreHome: 90,
  avgScoreAway: 82,
  homeAdvantage: 1.07,
  scoreMethod: 'normal',
  scoreStdDev: 18,
  allowsDraw: false, // Nadir; hesaplamada drawBuffer çok küçük
  iddaaCategory: 'AFL',
  availableMarkets: [
    'Match Winner',
    'Home/Away',
    'Handicap',
    'Asian Handicap',
    'Over/Under',
    'Team Total',
    'Odd/Even',
  ],
  marketNameMapping: {
    'Match Winner': 'Maç Sonucu',
    'Home/Away': 'Beraberlik Yok',
    'Handicap': 'Handikap',
    'Asian Handicap': 'Handikaplı Maç',
    'Over/Under': 'Toplam Sayı Alt/Üst',
    'Team Total': 'Takım Toplam Sayı',
    'Odd/Even': 'Tek/Çift',
  },
};
