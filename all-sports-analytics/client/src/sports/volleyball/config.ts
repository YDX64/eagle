import type { SportConfig } from '../_core/types';

/**
 * Volleyball Sport Configuration
 * v1.volleyball.api-sports.io
 *
 * Karakteristik:
 * - Set tabanlı (5 sette 3 kazanana gider) — best-of-5
 * - Olası set skorları: 3-0, 3-1, 3-2, 0-3, 1-3, 2-3 (6 skor)
 * - Beraberlik YOK — her maç kazananla biter
 * - Orta düzey ev avantajı (~%55 tek-set kazanma olasılığı)
 * - Matematiksel temel: tek-set olasılığı p'den binom/Markov set modeli
 *
 * "avgScoreHome" / "avgScoreAway" burada beklenen KAZANILAN SET sayısıdır
 * (gol/puan değil). Set-bazlı matematik için sadece referans; gerçek
 * tahminler p'den türetilir.
 */

export const volleyballConfig: SportConfig = {
  id: 'volleyball',
  displayName: 'Volleyball',
  displayNameTR: 'Voleybol',
  apiBase: 'https://v1.volleyball.api-sports.io',
  apiKey: 'b9ccb3be380b9f990745280ac95b4763',
  // Baseline expected sets won per team (best-of-5 @ p=0.55 → home~2.26, away~1.74)
  avgScoreHome: 2.26,
  avgScoreAway: 1.74,
  // Home advantage as multiplier on set-win probability factor (used indirectly)
  homeAdvantage: 1.10,
  scoreMethod: 'markov-set',
  // Volleyball has no draws — match always resolves 3-x
  allowsDraw: false,
  // Default single-set home-win probability used when no stats available
  setWinThreshold: 0.55,
  iddaaCategory: 'VB',
  availableMarkets: [
    'Home/Away',
    'Asian Handicap',
    'Total Sets',
    'Correct Set Score',
    'First Set Winner',
  ],
  marketNameMapping: {
    'Home/Away': 'Maç Sonucu',
    'Asian Handicap': 'Set Handikap',
    'Total Sets': 'Toplam Set Alt/Üst',
    'Correct Set Score': 'Set Skoru',
    'First Set Winner': '1. Set Sonucu',
  },
};
