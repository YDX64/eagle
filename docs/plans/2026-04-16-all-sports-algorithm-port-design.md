# All-Sports Analytics — Algoritma Konsolidasyon Planı

**Tarih:** 2026-04-16
**Kapsam:** Eagle futbol motoru + hockey-analytics oyuncu/takım analizi + StatsVault sağlayıcı tahminlerinin `all-sports-analytics/` içine C3 stratejisiyle birleştirilmesi.
**Strateji:** C3 — önce `_core/` altyapısı, sonra spor-spor zenginleştirme.

## Alias Karar: `StatsVault`

Dış tahmin/istatistik sağlayıcısının (eski adı "API-Football") kod tabanındaki adı **`StatsVault`**. Hiçbir dosyada "API-Football", "api-sports", "api-football", "apifootball" literal string'i yer almaz — provider domain'i HTTP istek url'inde kalır ama isim referansı yoktur.

**Yeniden adlandırma haritası:**
| Eski | Yeni |
|---|---|
| `API_FOOTBALL_KEY` env var | `STATSVAULT_KEY` |
| `ApiFootballPrediction` type | `StatsVaultPrediction` |
| `apiFootballProvider` | `statsVaultProvider` |
| `provider: 'api-football'` enum değeri | `provider: 'statsvault'` |
| "api-football.com" yorum | "StatsVault kaynağı" |
| DB kolonu `api_football_*` | `statsvault_*` |

**Denetim:** Faz 1 sonunda `grep -ri "api-football\|api-sports\|API_FOOTBALL\|apifootball" all-sports-analytics/` → 0 match (sadece `.env` ve runtime URL hariç).

## Hedef Olmayanlar (YAGNI)

- UI yeniden tasarımı (mevcut shadcn/ui korunur).
- `couponEngine.ts`, `couponStorage.ts` — mevcutlar yeterli.
- Bütün 12 sporu aynı anda derinleştirmek (faz 2/3/4'te spor-spor ilerlenir).
- Server-side Prisma DB (all-sports şu an tamamen client+in-memory, bu aşamada korunur).

## Mimari Genel Bakış

```
all-sports-analytics/client/src/sports/
├── _core/                        [Faz 1 — ortak altyapı]
│   ├── poisson.ts               [var]
│   ├── normal.ts                [var]
│   ├── kelly.ts                 [var]
│   ├── form.ts                  [var]
│   ├── h2h.ts                   [var]
│   ├── marketAnchored.ts        [var — 326 satır]
│   ├── apiClient.ts             [var — ama "SportApiClient" kalabilir, jenerik]
│   ├── types.ts                 [var — SportPlugin interface]
│   ├── ensemble.ts              [YENİ — multi-source birleştirici, ~350 satır]
│   ├── riskTier.ts              [YENİ — Platinum/Gold/Silver, ~120 satır]
│   ├── statsVaultProvider.ts    [YENİ — alias'lı provider wrapper, ~250 satır]
│   ├── playerProps.ts           [YENİ — oyuncu prop analizi, ~400 satır]
│   ├── smartCombo.ts            [YENİ — SmartBet/SmartCombo, ~250 satır]
│   ├── backtest.ts              [YENİ — ROI/win rate, ~200 satır]
│   └── index.ts                 [güncellenir — yeni export'lar]
├── football/                    [Faz 2]
│   ├── config.ts                [var]
│   ├── index.ts                 [462 → ~1200 satır: ensemble + risk tier + probet feed]
│   └── probetFeed.ts            [YENİ — iddaa market whitelist]
├── hockey/                      [Faz 2]
│   ├── config.ts                [var]
│   ├── index.ts                 [610 → ~1000 satır: goalie + PP/PK + backToBack]
│   └── hockeyPlayers.ts         [YENİ — playerAnalysis.ts portu, ~600 satır]
├── nba/                         [Faz 3]
│   ├── config.ts                [var]
│   ├── index.ts                 [521 → ~900 satır: pace/efficiency/rest days]
│   └── nbaPlayers.ts            [YENİ — PTS/AST/REB prop analizi]
├── basketball/                  [Faz 3]
│   ├── config.ts                [var]
│   ├── index.ts                 [811 → ~1000 satır: player stats entegrasyon]
│   └── basketballPlayers.ts     [YENİ]
└── (diğer 8 spor — Faz 4)       [baseball, volleyball, handball, americanFootball, rugby, mma, afl, formula1]
```

## Faz 1: _core Altyapısı (öncelik: bu plan)

### 1.1 `_core/statsVaultProvider.ts`
**Amaç:** Eski provider'ın `/predictions`, `/odds`, `/fixtures`, `/teams/statistics` endpoint'lerini alias altında sarar.

**Fonksiyonlar:**
- `fetchStatsVaultPrediction(gameId, sport)` → `StatsVaultPrediction | null`
- `fetchStatsVaultOdds(gameId, sport)` → `NormalizedOdds | null`
- `fetchStatsVaultStatistics(teamId, leagueId, season, sport)` → `TeamStats | null`
- Cache: in-memory, 5 dakika TTL
- `STATSVAULT_KEY` env var'dan okunur
- Yüksek güvenilirlik filtresi: `prediction.comment.confidence >= 0.70` → sadece bunlar ensemble'a girer

**Type:**
```ts
export interface StatsVaultPrediction {
  provider: 'statsvault';
  winner: { id: number; name: string } | null;
  winOrDraw: boolean;
  underOver: string | null;      // "-2.5" | "+2.5" vs
  goals: { home: string; away: string };
  advice: string;
  percent: { home: string; draw: string; away: string };
  confidence: number;            // 0-1 (parse from percent max)
  highConfidence: boolean;       // confidence >= 0.70
}
```

### 1.2 `_core/ensemble.ts`
**Amaç:** Eagle `prediction-ensemble.ts` (1746 satır) sadeleştirilerek port.

**3 kaynak:** `modelPrediction` (mevcut adapter predict sonucu) + `marketAnchoredPrediction` (marketAnchored.ts consensus) + `statsVaultPrediction` (opsiyonel, varsa).

**Ağırlıklar:**
```ts
const DEFAULT_WEIGHTS = {
  model: 0.45,        // Adapter predict
  market: 0.35,       // Bookmaker consensus
  statsVault: 0.20,   // Harici sağlayıcı (yüksek confidence ise)
};
```

**Fonksiyonlar:**
- `combinePredictions(sources, weights?)` → `EnsemblePrediction`
- `resolveWeights(sources)` — bir kaynak yoksa ağırlığı diğerlerine yeniden dağıt
- Agreement bonusu: kaynaklar ±0.05 içindeyse confidence +10%
- Disagreement cezası: ±0.15+ ayrılık varsa confidence -20%
- Banko seçimi (`selectBanko`): ≥0.65 true prob + ≥2 kaynak onayı + ≥0.15 spread olmamalı

### 1.3 `_core/riskTier.ts`
**Amaç:** Eagle `advanced-prediction-engine.ts` risk sınıflandırması.

```ts
export type RiskTier = 'platinum' | 'gold' | 'silver' | 'bronze' | 'reject';

export function classifyRiskTier(params: {
  trueProbability: number;
  edge: number;
  marketConsensus?: MarketConsensus;
  statsVaultConfidence?: number;
  bookmakerCount: number;
}): { tier: RiskTier; reason: string };
```

Eşikler:
- **Platinum:** trueProb ≥ 0.85, edge ≥ 0.08, bookmakerCount ≥ 5, market spread < 0.03
- **Gold:** trueProb ≥ 0.75, edge ≥ 0.05, bookmakerCount ≥ 3
- **Silver:** trueProb ≥ 0.65, edge ≥ 0.03
- **Bronze:** trueProb ≥ 0.55
- **Reject:** aksi halde

### 1.4 `_core/playerProps.ts`
**Amaç:** Hockey-analytics `playerAnalysis.ts` (895 satır) → **generic** port. Sport-agnostic player prop analizi.

**Fonksiyonlar:**
- `analyzePlayerProps(oddsData, matchPrediction, game, events, sport)` → `PlayerPropPrediction[]`
- Her spor için prop kategorileri:
  - Football: `anytime_goalscorer`, `shots_on_target`, `assists`, `cards`
  - Hockey: `goal`, `assist`, `point`, `shot_on_goal`
  - NBA/Basketball: `points`, `rebounds`, `assists`, `threes_made`
  - Baseball: `hits`, `home_run`, `strikeouts_pitcher`
  - American Football: `passing_yards`, `rushing_yards`, `touchdowns`
- Geçmiş event'lerden `playerPerformanceScore(name, events)` hesaplar.
- Odds implied prob vs algoritma trueProb karşılaştırır, edge ≥ 5% olanları döndürür.

### 1.5 `_core/smartCombo.ts`
**Amaç:** Hockey-analytics `SmartBet` + `SmartCombo` tipleri + generator'ı → generic.

**Stratejiler:**
- `buildSafeCombo(bets)` — riskScore < 30, totalOdds 2.5-6.0
- `buildValueCombo(bets)` — edge ≥ 8%, totalOdds 3-10
- `buildHighOddsCombo(bets)` — totalOdds ≥ 8, ama prob ≥ 0.55 her leg
- `buildBalancedCombo(bets)` — her tier'dan seçim

### 1.6 `_core/backtest.ts`
**Amaç:** Eagle `backtest-engine.ts` sadeleştirme.

```ts
export interface BacktestResult {
  sport: SportId;
  period: { from: string; to: string };
  totalBets: number;
  won: number;
  lost: number;
  winRate: number;
  roi: number;  // ((return - stake) / stake) * 100
  profitByTier: Record<RiskTier, number>;
  profitByMarket: Record<string, number>;
}
```

- `runBacktest(coupons, settledGames, sportPlugin)` → `BacktestResult`
- Progressive (günlük iterative) mode destekli.

## Faz 2: Football + Hockey Zenginleştirme

**Football** (`sports/football/index.ts`):
- Predict sonucu ensemble'a yollar: model + market-anchored + statsVault
- Her market için `riskTier` hesaplar
- "ProBet feed" (`probetFeed.ts`) iddaa market whitelist uygular: sadece iddaa'da var olan marketler değerlendirilir
- Output: `Prediction & { ensembleSources, riskTier, bankoPicks }`

**Hockey** (`sports/hockey/index.ts`):
- `hockeyPlayers.ts` → `playerAnalysis.ts` portu (goalie save%, power play, penalty kill, faceoff, back-to-back cezası)
- `homeAttack += powerPlayBonus + goalieFormAdjust`
- Period-level predictions (mevcut) korunur.
- Player props `playerProps.ts` generic'i kullanır.

## Faz 3: NBA + Basketball Zenginleştirme

**NBA** (`sports/nba/index.ts`):
- Pace faktörü (possessions/48 min)
- Offensive/Defensive Rating
- Rest days (back-to-back cezası)
- Injury report (API'den varsa)
- `nbaPlayers.ts` — PTS/AST/REB/3PM prop analizi

**Basketball** (`sports/basketball/index.ts`):
- Benzer NBA yaklaşımı, EuroLeague-spesifik ayarlamalar
- `basketballPlayers.ts`

## Faz 4: Diğer 8 Spor

Baseball (pitcher matchup), American Football (QB pass/rush yards), Volleyball (set-level Markov refinement), MMA (fighter stance, reach advantage), Rugby/AFL/Handball (basic enhancement), Formula 1 (grid position + fastest lap model).

## Test Stratejisi

Her yeni `_core/*.ts` için `__tests__/` altında vitest unit test:
- `ensemble.test.ts` — 3 kaynak birleştirme, agreement bonusu, banko seçimi
- `riskTier.test.ts` — tier sınır değerleri
- `statsVaultProvider.test.ts` — mock fetch, cache, env var
- `playerProps.test.ts` — prop edge hesabı
- `smartCombo.test.ts` — combo stratejileri
- `backtest.test.ts` — ROI hesabı

Hedef: `npx vitest run` → 100% yeni dosyalar geçsin, mevcut 30 test kırılmasın.

## Sızdırma Denetimi (Faz 1 sonu)

```bash
cd all-sports-analytics
grep -r -i "api-football\|api-sports\|API_FOOTBALL\|apifootball" \
  --include="*.ts" --include="*.tsx" --include="*.md" \
  client/ server/ shared/ | grep -v node_modules
```

**Beklenen:** 0 match. Eğer bulunursa rename'den kaçmış demektir.

**İstisna:** `.env.local` dosyasında runtime URL kalabilir:
`STATSVAULT_BASE_URL=https://v3.football.api-sports.io` (URL env'den, kodda hardcode yok).

## Build & Doğrulama Checkpoint'leri

1. **Faz 1 bitince:** `npm run check` (tsc) + `npx vitest run` → geçmeli.
2. **Her Faz 2/3 sporu bitince:** Aynı komutlar + UI'da o sporun Dashboard sayfası render edilmeli.
3. **Son kontrol:** `npm run build` → production bundle oluşmalı, runtime hata yok.

## Risk & Trade-off

- **Bundle size:** Ensemble + playerProps + smartCombo ~50 KB ekler. Kabul edilebilir.
- **API rate limit:** StatsVault 3 ek endpoint çağırır — cache TTL 5 dk yeterli.
- **Eagle/hockey-analytics arşivleme:** Bu plandan sonra iki eski sistem legacy'ye taşınabilir (ayrı PR).

## İlerleme Sırası

1. ✅ Plan dokümanı (bu dosya)
2. `_core/statsVaultProvider.ts`
3. `_core/ensemble.ts`
4. `_core/riskTier.ts`
5. `_core/playerProps.ts`
6. `_core/smartCombo.ts`
7. `_core/backtest.ts`
8. `_core/index.ts` export güncellemesi
9. Faz 1 testleri
10. Sızdırma denetimi grep
11. Checkpoint: `npm run check` + `vitest run`
12. Faz 2 başlangıcı (football)
