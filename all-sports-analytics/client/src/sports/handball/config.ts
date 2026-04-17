import type { SportConfig } from '../_core/types';

/**
 * Handball Sport Configuration
 * v1.handball.api-sports.io
 *
 * Karakteristik:
 * - Yüksek skorlu (~55 gol/maç toplam: ev ~28, deplasman ~27)
 * - İki yarı (2 x 30 dakika = 60 dakika toplam)
 * - Regülasyon sürede beraberlik mümkün (~%8 oranında)
 * - Normal distribution iyi uyum sağlar (yüksek lambda Poisson yerine)
 * - Standart sapma: ~5 gol per team (toplam stdTotal ≈ 7.07)
 * - Ev avantajı hokey ile benzer (~%8)
 */

export const handballConfig: SportConfig = {
  id: 'handball',
  displayName: 'Handball',
  displayNameTR: 'Hentbol',
  apiBase: 'https://v1.handball.api-sports.io',
  apiKey: 'b9ccb3be380b9f990745280ac95b4763',
  avgScoreHome: 28,
  avgScoreAway: 27,
  homeAdvantage: 1.08,
  scoreMethod: 'normal',
  scoreStdDev: 5,
  allowsDraw: true,
  iddaaCategory: 'HB',
  availableMarkets: [
    '3-Way Result',
    'Match Winner',
    'Home/Away',
    'Double Chance',
    'Over/Under',
    'Handicap',
    'Asian Handicap',
    '1st Half Winner',
    '1st Half Over/Under',
  ],
  marketNameMapping: {
    '3-Way Result': 'Maç Sonucu',
    'Match Winner': 'Maç Sonucu',
    'Home/Away': 'Beraberlik Yok',
    'Over/Under': 'Toplam Gol Alt/Üst',
    'Asian Handicap': 'Handikaplı Maç',
    'Handicap': 'Handikap',
    'Double Chance': 'Çifte Şans',
    '1st Half Winner': '1. Yarı Sonucu',
    '1st Half Over/Under': '1. Yarı Alt/Üst',
  },
};
