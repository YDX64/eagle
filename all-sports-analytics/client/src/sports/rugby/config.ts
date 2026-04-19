import type { SportConfig } from '../_core/types';

/**
 * Rugby Sport Configuration
 * v1.rugby.api-sports.io
 *
 * Karakteristik:
 * - Yüksek skorlu (~47 sayı toplam, ev ~25, deplasman ~22)
 * - Try (5), Conversion (2), Penalty (3), Drop Goal (3) -> karışık puan birimleri
 * - Normal (Gaussian) dağılım uygundur (skor >> 10)
 * - Her takım için stdDev ~11 sayı (Amerikan Futbolu ile karşılaştırılabilir)
 * - İki yarı (2 x 40 dakika = 80 dakika toplam)
 * - Regülasyon sonunda beraberlik mümkün (~%5 oranında, özellikle uluslararası maçlarda)
 *   -> drawBuffer 3 (rugby skoru 1 sayı kaymaz, en küçük adım 2-3 sayı)
 * - Ev avantajı önemli (~%8, seyahat ve iklim koşulları etkili)
 * - Handikap (Asian/Standard) pazarı çok popüler; büyük handikap çizgileri (-14.5 ile -1.5)
 * - Toplam (Over/Under) çizgileri 35.5 – 60.5 arasında tipik
 * - İddaa kategori kodu: RB
 */

export const rugbyConfig: SportConfig = {
  id: 'rugby',
  displayName: 'Rugby',
  displayNameTR: 'Ragbi',
  apiBase: 'https://v1.rugby.api-sports.io',
  apiKey: '',
  avgScoreHome: 25,
  avgScoreAway: 22,
  homeAdvantage: 1.08,
  scoreMethod: 'normal',
  scoreStdDev: 11,
  allowsDraw: true,
  iddaaCategory: 'RB',
  availableMarkets: [
    'Match Winner',
    'Home/Away',
    'Handicap',
    'Asian Handicap',
    'Over/Under',
    'Odd/Even',
  ],
  marketNameMapping: {
    'Match Winner': 'Maç Sonucu',
    'Home/Away': 'Beraberlik Yok',
    'Over/Under': 'Toplam Sayı Alt/Üst',
    'Asian Handicap': 'Handikaplı Maç',
    'Handicap': 'Handikap',
    'Odd/Even': 'Tek/Çift',
  },
};
