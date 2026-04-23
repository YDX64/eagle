import type { SportConfig } from '../_core/types';

/**
 * NBA Sport Configuration
 * Endpoint: v2.nba.api-sports.io (NBA uses a dedicated v2 endpoint)
 *
 * Karakteristik:
 * - Yüksek skorlu (~227 toplam sayı)
 * - Normal dağılım modellemesi
 * - Beraberlik yok (uzatmaya gidilir)
 * - Ev avantajı hafif (1.04)
 * - Standard sapma takım başına ~13 sayı
 */
export const nbaConfig: SportConfig = {
  id: 'nba',
  displayName: 'NBA',
  displayNameTR: 'NBA',
  apiBase: 'https://v2.nba.api-sports.io',
  apiKey: '',
  avgScoreHome: 115,
  avgScoreAway: 112,
  homeAdvantage: 1.04,
  scoreMethod: 'normal',
  scoreStdDev: 13,
  allowsDraw: false,
  iddaaCategory: 'NBA',
  availableMarkets: [
    'Home/Away',
    'Moneyline',
    'Asian Handicap',
    'Spread',
    'Over/Under',
    'Odd/Even',
  ],
  marketNameMapping: {
    'Home/Away': 'Maç Sonucu',
    'Moneyline': 'Maç Sonucu (ML)',
    'Over/Under': 'Toplam Sayı Alt/Üst',
    'Asian Handicap': 'Handikaplı Maç',
    'Spread': 'Handikap',
    'Odd/Even': 'Tek/Çift',
  },
};
