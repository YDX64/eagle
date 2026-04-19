import type { SportConfig } from '../_core/types';

/**
 * American Football (NFL / NCAA) Sport Configuration
 * v1.american-football.api-sports.io
 *
 * Karakteristik:
 * - Çok yüksek skorlu (~45 sayı toplam, ev ~24, deplasman ~21)
 * - Yüksek varyans (her takım için stdDev ~10 sayı)
 * - Normal (Gaussian) dağılım uygundur (skor >> 10, Poisson zayıf kalır)
 * - Dört çeyrek (15'er dakika = 60 dakika toplam)
 * - NFL'de regülasyon sonunda ara sıra beraberlik mümkün (nadir, OT sonrası)
 *   -> drawBuffer çok küçük tutulur (0.5), draw probability ≈ 0
 * - Ev avantajı görece orta (~%6)
 * - Handikap (Spread) pazarı çok popüler; büyük handikap çizgileri (-3.5 ile -14.5)
 * - Toplam (Over/Under) çizgileri 35.5 – 53.5 arasında tipik
 * - İddaa kategori kodu: AF
 */

export const americanFootballConfig: SportConfig = {
  id: 'americanFootball',
  displayName: 'American Football',
  displayNameTR: 'Amerikan Futbolu',
  apiBase: 'https://v1.american-football.api-sports.io',
  apiKey: '',
  avgScoreHome: 24,
  avgScoreAway: 21,
  homeAdvantage: 1.06,
  scoreMethod: 'normal',
  scoreStdDev: 10,
  allowsDraw: false,
  iddaaCategory: 'AF',
  availableMarkets: [
    'Home/Away',
    'Spread',
    'Over/Under',
    'Team Total',
    'Moneyline',
    '1st Quarter Winner',
    'Race to X Points',
  ],
  marketNameMapping: {
    'Home/Away': 'Maç Sonucu',
    'Moneyline': 'Maç Sonucu (ML)',
    'Spread': 'Handikap',
    'Over/Under': 'Toplam Sayı Alt/Üst',
    'Team Total': 'Takım Toplam Sayı',
    '1st Quarter Winner': '1. Çeyrek Sonucu',
    'Race to X Points': 'İlk X Sayıya Ulaşan',
  },
};
