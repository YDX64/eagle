import type { SportConfig } from '../_core/types';

/**
 * Baseball Sport Configuration
 * v1.baseball.api-sports.io
 *
 * Karakteristik:
 * - Düşük-orta skorlu (~8.5 toplam run, ev ~4.4, deplasman ~4.2)
 * - Poisson dağılımı uygundur (sayı düşük, sayaç yapısında)
 * - 9 inning (uzatmada ekstra inning ile karar verilir)
 * - Beraberlik YOKTUR — extra innings her maçı sonuca bağlar
 * - Ev avantajı çok küçük (~%4) — pitcher/park faktörü ağır basar
 * - İddaa kategori kodu: BB
 *
 * API status codes observed in real data:
 *   NS   — Not Started (maç başlamamış)
 *   IN1..IN9 — In Progress (inning sırası)
 *   POST — Postponed (ertelendi)
 *   CANC — Cancelled (iptal)
 *   FT   — Finished (9. inning sonunda bitti)
 *   AOT  — After Over Time (extra innings ile bitti)
 *
 * Gerçek money: Bu config sadece varsayılan parametreler.
 *   predict() team stats ile override eder.
 */

export const baseballConfig: SportConfig = {
  id: 'baseball',
  displayName: 'Baseball',
  displayNameTR: 'Beyzbol',
  apiBase: 'https://v1.baseball.api-sports.io',
  apiKey: '',
  avgScoreHome: 4.4,
  avgScoreAway: 4.2,
  homeAdvantage: 1.04,
  scoreMethod: 'poisson',
  allowsDraw: false,
  iddaaCategory: 'BB',
  availableMarkets: [
    'Home/Away',
    'Moneyline',
    'Run Line',
    'Over/Under',
    'Odd/Even',
    'First 5 Innings',
    'Team Total Runs',
    'Asian Handicap',
  ],
  marketNameMapping: {
    'Home/Away': 'Maç Sonucu',
    'Moneyline': 'Maç Sonucu (ML)',
    'Run Line': 'Run Çizgisi',
    'Asian Handicap': 'Handikaplı Maç',
    'Over/Under': 'Toplam Run Alt/Üst',
    'Odd/Even': 'Tek/Çift',
    'First 5 Innings': 'İlk 5 Inning',
    'Team Total Runs': 'Takım Toplam Run',
  },
};
