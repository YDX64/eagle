import type { SportConfig } from '../_core/types';

/**
 * Basketball Sport Configuration
 * v1.basketball.api-sports.io
 *
 * Karakteristik:
 * - Yüksek skorlu (~160 toplam, ev ~80, deplasman ~78)
 * - Normal (Gaussian) dağılım kullanılır (Poisson değil — skor çok yüksek)
 * - Takım başı standart sapma ~12 sayı
 * - Dört çeyrek (10-12 dk her biri) + uzatma
 * - Regülasyon sürede beraberlik mümkün, ancak OT ile karara bağlanır
 *   -> prediction output'ta draw ≈ 0 kabul edilir
 * - Ev avantajı görece küçük (~%5)
 * - İddaa kategori kodu: BK
 */

export const basketballConfig: SportConfig = {
  id: 'basketball',
  displayName: 'Basketball',
  displayNameTR: 'Basketbol',
  apiBase: 'https://v1.basketball.api-sports.io',
  apiKey: 'b9ccb3be380b9f990745280ac95b4763',
  avgScoreHome: 80,
  avgScoreAway: 78,
  homeAdvantage: 1.05,
  scoreMethod: 'normal',
  scoreStdDev: 12,
  allowsDraw: false,
  iddaaCategory: 'BK',
  availableMarkets: [
    'Home/Away',
    'Asian Handicap',
    'Over/Under',
    'Both Teams Total Points',
    'Odd/Even',
    '1st Quarter Winner',
    'Highest Scoring Quarter',
    'Quarter Handicap',
  ],
  marketNameMapping: {
    'Home/Away': 'Maç Sonucu',
    'Over/Under': 'Toplam Sayı Alt/Üst',
    'Asian Handicap': 'Handikaplı Maç',
    'Odd/Even': 'Tek/Çift',
    '1st Quarter Winner': '1. Çeyrek Sonucu',
    'Quarter Handicap': 'Çeyrek Handikap',
    'Both Teams Total Points': 'Takım Toplam Sayı',
    'Highest Scoring Quarter': 'En Çok Sayı Atılan Çeyrek',
  },
};
