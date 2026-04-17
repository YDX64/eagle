import type { SportConfig } from '../_core/types';

/**
 * Formula 1 Sport Configuration
 * v1.formula-1.api-sports.io
 *
 * Karakteristik:
 * - 20 pilotun yarıştığı pozisyon-tabanlı spor (skor değil, sıralama)
 * - "Home vs Away" kavramı yok — tüm pilotlar aynı pistte yarışır
 * - Kullanıcı arayüzünde bir yarış (race) için pilot bazlı olasılıklar gerekir
 * - Bu plugin MINIMAL scaffold olarak tasarlanmıştır; "home = Field (sahnede kim kazanır)"
 *   generik placeholder'ı kullanır (upcoming yarışlar için)
 * - Bitmiş yarışlarda scores.home/away null kalır (sıralama ayrı yapılandırmada)
 *
 * Popüler pazarlar:
 * - Race Winner (Yarış Kazananı) — 20 seçenek
 * - Podium Finish (Podyum) — top 3
 * - Points Finish — top 10
 * - Fastest Lap (En Hızlı Tur)
 * - Head-to-Head (iki pilot arası)
 *
 * İddaa kategori kodu: F1
 */

export const formula1Config: SportConfig = {
  id: 'formula1',
  displayName: 'Formula 1',
  displayNameTR: 'Formula 1',
  apiBase: 'https://v1.formula-1.api-sports.io',
  apiKey: 'b9ccb3be380b9f990745280ac95b4763',
  // Pozisyon-tabanlı olduğundan avg score alanları placeholder 0'dır.
  avgScoreHome: 0,
  avgScoreAway: 0,
  homeAdvantage: 1.0, // F1'de ev avantajı yok
  scoreMethod: 'position',
  allowsDraw: false, // F1'de beraberlik yok (zamanlar milisaniye bazında)
  iddaaCategory: 'F1',
  availableMarkets: [
    'Race Winner',
    'Podium Finish',
    'Points Finish',
    'Fastest Lap',
    'Head-to-Head',
  ],
  marketNameMapping: {
    'Race Winner': 'Yarış Kazananı',
    'Podium Finish': 'Podyum (İlk 3)',
    'Points Finish': 'Puanlı Bitiş (İlk 10)',
    'Fastest Lap': 'En Hızlı Tur',
    'Head-to-Head': 'Pilot Karşılaştırma',
  },
};
