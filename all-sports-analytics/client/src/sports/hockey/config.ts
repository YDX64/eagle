import type { SportConfig } from '../_core/types';

/**
 * Hockey Sport Configuration
 * v1.hockey.api-sports.io
 *
 * Karakteristik:
 * - Orta-yüksek skorlu (~6 gol/maç, ev 3.0, deplasman 2.7)
 * - Üç periyot (20'şer dakika = 60 dakika toplam)
 * - Regülasyon sürede beraberlik mümkün (NHL dışında genelde)
 * - NHL/KHL gibi liglerde OT/Shootout karar verir (AOT, AP status)
 * - Ev avantajı futbolun biraz altında (~%8)
 */

export const hockeyConfig: SportConfig = {
  id: 'hockey',
  displayName: 'Hockey',
  displayNameTR: 'Buz Hokeyi',
  apiBase: 'https://v1.hockey.api-sports.io',
  apiKey: 'b9ccb3be380b9f990745280ac95b4763',
  avgScoreHome: 3.0,
  avgScoreAway: 2.7,
  homeAdvantage: 1.08,
  scoreMethod: 'poisson',
  allowsDraw: true,
  iddaaCategory: 'HK',
  availableMarkets: [
    '3Way Result',
    'Home/Away',
    'Over/Under',
    'Asian Handicap',
    'Both Teams To Score',
    'Double Chance',
    'Over/Under - Period 1',
    'Over/Under - Period 2',
    'Over/Under - Period 3',
    'Both Teams To Score - Period 1',
    'Both Teams To Score - Period 2',
    'Both Teams To Score - Period 3',
    'Odd/Even',
  ],
  marketNameMapping: {
    '3Way Result': 'Maç Sonucu (Uzatma Dahil Değil)',
    'Home/Away': 'Beraberlik Yok',
    'Over/Under': 'Alt/Üst',
    'Asian Handicap': 'Handikaplı Maç',
    'Both Teams To Score': 'Karşılıklı Gol',
    'Double Chance': 'Çifte Şans',
    'Odd/Even': 'Tek/Çift',
    'Over/Under - Period 1': '1. Periyot Alt/Üst',
    'Over/Under - Period 2': '2. Periyot Alt/Üst',
    'Over/Under - Period 3': '3. Periyot Alt/Üst',
    'Both Teams To Score - Period 1': '1. Periyot Karşılıklı Gol',
    'Both Teams To Score - Period 2': '2. Periyot Karşılıklı Gol',
    'Both Teams To Score - Period 3': '3. Periyot Karşılıklı Gol',
  },
};
