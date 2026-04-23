import type { SportConfig } from '../_core/types';

/**
 * MMA Sport Configuration
 * v1.mma.api-sports.io
 *
 * Karakteristik:
 * - Dövüş-tabanlı (takım yok) — Fighter A vs Fighter B
 * - "Home/Away" konsepti yok → fighter1 (=home) ve fighter2 (=away) sadece
 *   normalize etiketleri; gerçek ev avantajı uygulanmaz.
 * - Beraberlik NADIR ama MÜMKÜN (~%2) — draw (split draw, majority draw, no contest hariç)
 * - Skor yok (gol/sayı kavramı yok); scoreMethod: 'fight' — binary kazanan
 * - Tur sistemi: genellikle 3 round (5 dk), ana/başlık maçları 5 round
 * - Bitiş yöntemleri: KO/TKO, Submission, Decision (Unanimous/Split/Majority), Draw
 * - İddaa kategori kodu: MM
 *
 * API status codes observed in v1.mma.api-sports.io (defansif liste):
 *   NS    — Not Started (maç başlamamış)
 *   LIVE  — Live, aktif round
 *   R1..R5 — Belirli round (MMA için 1..5 round)
 *   BR    — Break (round arası)
 *   FT    — Finished (tam süre sonunda biten dövüş)
 *   KO    — Knockout (KO/TKO ile erken biten)
 *   SUB   — Submission ile erken biten
 *   DEC   — Decision
 *   DRAW  — Draw
 *   NC    — No Contest (geçersiz maç — void)
 *   CANC  — Cancelled
 *   POSTP — Postponed
 *   WO    — Walkover (tek taraflı galibiyet)
 *
 * Gerçek money: Dövüşçü istatistikleri (KO/Sub/Dec oranları) mevcutsa predict()
 *   override eder; aksi halde baz oranlar (literatürdeki MMA istatistikleri) kullanılır.
 */

export const mmaConfig: SportConfig = {
  id: 'mma',
  displayName: 'MMA',
  displayNameTR: 'MMA',
  apiBase: 'https://v1.mma.api-sports.io',
  apiKey: '',
  // Fight sport: skor yok. avgScoreHome/Away burada "dövüşçü başına beklenen
  // galibiyet oranı" olarak yorumlanır — çekişmeli eşleşmede 0.5'e yakın.
  avgScoreHome: 0.5,
  avgScoreAway: 0.5,
  // Dövüşte ev avantajı yok (nötr zemin / turnuva kafesi)
  homeAdvantage: 1.0,
  scoreMethod: 'fight',
  // MMA'da beraberlik mümkün (nadir: split/majority draw, ~%2)
  allowsDraw: true,
  iddaaCategory: 'MM',
  availableMarkets: [
    'Fighter Winner',
    'Moneyline',
    'Method of Victory',
    'Total Rounds Over/Under',
    'Fight to Go Distance',
    'Round Betting',
  ],
  marketNameMapping: {
    'Fighter Winner': 'Galip Dövüşçü',
    'Moneyline': 'Galip Dövüşçü (ML)',
    'Method of Victory': 'Kazanma Yöntemi',
    'Total Rounds Over/Under': 'Toplam Round Alt/Üst',
    'Fight to Go Distance': 'Dövüş Süreyi Tamamlar mı',
    'Round Betting': 'Round Bahsi',
  },
};
