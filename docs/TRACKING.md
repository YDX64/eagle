# Cross-Sport Prediction Tracking System

Bu doküman eagle-1 projesine eklenen çoklu-sport tahmin takip sistemini
anlatır. Mevcut sistemlerin hiçbiri silinmedi — her şey **additive**.

## Mimari

İki ayrı veritabanı, iki ayrı Prisma client.

```
┌──────────────────────────────────────────────┐
│  Legacy engines (lib/probet, lib/algorithms, │
│  sport engines, AUTO-EVALUATE cron jobs)     │
│       │                                      │
│       ▼                                      │
│  Prisma default client                       │
│       │                                      │
│       ▼                                      │
│  SQLite (/app/data/probet.db)                │
│  kullanıcının kalibrasyon + tahmin geçmişi   │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  /tracking dashboard + /api/tracking/*       │
│  PredictionResultBadge + ActivityFeed        │
│       │                                      │
│       ▼                                      │
│  Prisma tracking client                      │
│  (node_modules/.prisma/tracking-client)      │
│       │                                      │
│       ▼                                      │
│  PostgreSQL probet (awa-postgres)            │
│  cross-sport tracking + analytics            │
└──────────────────────────────────────────────┘
```

## Veritabanları

### SQLite (legacy, prod: `/app/data/probet.db`)

Kullanıcının orijinal sistemi. ~20 tablo:
`leagues`, `teams`, `matches`, `predictions` (Int id), `bulk_analysis_results`,
`backtest_results`, vb. Kalibrasyon JSON'ları `lib/probet/` altında, SQLite
ile birlikte çalışıyor.

### PostgreSQL (tracking, AWAXX `awa-postgres` → DB `probet`)

Cross-sport tracking için 11 model:

| Tablo | Kullanım |
|-------|----------|
| `predictions` (text id `{sport}:{fixture_id}`) | Her sport için her tahmin |
| `picks` | Her tahminin her market/pick'i |
| `system_bets` | Kupon önerileri (Kelly stake + risk) |
| `pattern_matches` | Odds pattern tespitleri |
| `player_prop_picks` | NBA POINTS, NHL SHOTS vb. oyuncu marketleri |
| `sport_games` | Raw fixture cache (cross-sport) |
| `odds_snapshots_v2` | Bookmaker oran geçmişi (opening/closing line) |
| `market_taxonomy` | 212 market'in unified Türkçe + settlement rule'u |
| `prediction_runs` | Cron orchestration audit |
| `bb_*` | NBA player AI (kullanıcının mevcut sistemi, sadece okunur) |

## Env Vars

```bash
DATABASE_URL="file:/app/data/probet.db"                              # legacy SQLite
TRACKING_DATABASE_URL="postgresql://awauser:${PW_URL}@awa-postgres:5432/probet"
PROBET_PG_PASSWORD_URL="KHJGCv9LD%2F..."                             # URL-encoded /
```

`PROBET_PG_PASSWORD_URL` **URL-encoded** olmalı — plain password'de `/` varsa
Prisma connection string'i parse edemez (502 hatası). `feedback_db_url_encoding.md`
bu konuda kalıcı not içerir.

## API Endpoints

| Endpoint | Açıklama |
|----------|----------|
| `GET /api/tracking/kpis` | Toplam/bekleyen/sonuçlanan tahmin + kar |
| `GET /api/tracking/performance` | Market × sport performans tablosu |
| `GET /api/tracking/leaderboard` | En kazandıran marketler (min_sample filtreli) |
| `GET /api/tracking/sport-roi` | Sport bazında ROI özet |
| `GET /api/tracking/family-performance` | Market-family bazında ROI (1x2, totals, btts, handicap...) |
| `GET /api/tracking/value-bets` | Pozitif EV'li bekleyen tahminler |
| `GET /api/tracking/predictions` | Paginated tahmin listesi (sport/status/date filter) |
| `GET /api/tracking/predictions/[id]` | Tek tahmin detay + tüm picks |
| `GET /api/tracking/fixture-result?sport=X&ids=1,2,3` | Bulk fixture → W/L summary (badge tarafından) |
| `GET /api/tracking/recent-activity` | Son 24h çözülen + yaklaşan tahminler |
| `GET /api/tracking/odds-movement` | Oran hareket geçmişi |
| `GET /api/tracking/markets` | Market taxonomy (212 market) |
| `GET /api/tracking/runs` | Prediction run history (cron audit) |
| `POST /api/tracking/generate-daily` | Günlük çoklu-sport tahmin üretimi (manuel tetik) |
| `POST /api/tracking/settle` | Manuel settlement tetiği |
| `POST /api/tracking/seed-markets` | Market taxonomy reseed (idempotent) |
| `GET /api/cron/daily-all-sports` | Cron tetikleri — bearer token CRON_SECRET |
| `GET /api/cron/settle-finished` | Cron |

## UI

| Sayfa | İçerik |
|-------|--------|
| `/tracking` | Özet: ActivityFeed + 4 KPI + ROI bar + daily volume |
| `/tracking/fixtures` | Tüm tahminler, sport/status/search filtresi, expand ile her market W/L |
| `/tracking/performance` | Market performansı + sport×family heatmap |
| `/tracking/leaderboard` | En kazandıran (sport, market) kombinasyonları |
| `/tracking/value-bets` | Edge/probability filtreli bekleyen tahminler |
| `/tracking/player-props` | Oyuncu marketleri performansı |
| `/tracking/odds-movement` | Bookmaker oran hareket grafiği |

## Per-sport Badge Entegrasyonu

`PredictionResultBadge` componenti + `PredictionResultBadgeProvider` (batch fetch):

- **Futbol**: `components/match-card.tsx` (her maç kartının altında)
- **Basketball / NBA / Hockey / Handball / Volleyball**:
  `components/sports/shared/games-dashboard.tsx` (tek entegrasyon tüm spor dashboard'ları kapsar)
- **Hockey-2**: Ayrı component, henüz eklenmedi

Badge durumları:
- **Yeşil "Kazandı %X"** → `best_pick_hit=true`, X = won/settled oranı
- **Kırmızı "Kaybetti %X"** → `best_pick_hit=false`
- **Mavi "Tahmin kaydedildi"** → `status='pending'`
- **Gizli** → tahmin yok (graceful)

## GitOps Deploy

```bash
# Local → prod
git add -A && git commit -m "..." && git push origin main
ssh AWAXX "cd /opt/probet && bash scripts/deploy.sh"

# Prod'da elle düzeltme yapıldıysa local'e çek
bash scripts/git-sync.sh
```

`scripts/deploy.sh`: fetch → abort on divergence → fast-forward → rebuild if changed
→ wait healthy → smoke test (`/`, `/tracking`, `/tracking/fixtures`, `/api/tracking/kpis`).

**Yasaklar**: worktree, force-push, direct rsync overwrite.

## Yerine Konulmayanlar (bilerek)

- **Dual-write hook** lib/probet/*'e eklenmedi (legacy engine'e dokunmamak için).
  Tracking DB şu an dış bir cron veya başka bir job tarafından dolduruluyor
  (1187 prediction mevcut).
- **NHL / MLB player importer** eklenmedi — hockey/baseball player-props
  graceful empty dönüyor, basketball NBA çalışıyor.

## Sorun Giderme

**Prediction badge görünmüyor** → `/api/tracking/fixture-result?sport=football&ids=X`'i
doğrudan test et. 200 ve `has_prediction: true` dönüyorsa badge render edilir.
Boş dönerse tracking DB'de o fixture için prediction yok.

**502 Bad Gateway** → genelde Prisma connection string parse hatası. Container
logs'unda `P1013 invalid port number` arayın. Password'ün URL-encoded olduğundan
emin olun (`PROBET_PG_PASSWORD_URL`).

**Build failed `Cannot find module '/app/server.js'`** → Next.js standalone
output'u boş çıkmış. `next.config.js`'te `outputFileTracingRoot` Docker workdir'a
(`__dirname`) ayarlı olmalı, `'../'` DEĞİL.

**`NEXTAUTH_SECRET is not configured` build time'da** → `lib/auth.ts`'teki
`requiredSecret()` production check'i build-time page-data-collection'da
tetikleniyor. Şimdi `console.warn` + placeholder return, runtime'da NextAuth
kendisi fail eder eğer gerçekten set edilmemişse.
