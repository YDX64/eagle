# All Sports Analytics - Çok Sporlu Bahis Analiz Platformu

12 spor branşı için iddaa tarzı bahis analiz ve sistem kupon oluşturma platformu.

## Özellikler

- ✅ **12 Spor Branşı**: Futbol, Hokey, Basketbol, NBA, Voleybol, Hentbol, Amerikan Futbolu, Beyzbol, Ragbi, MMA, AFL, Formula 1
- ✅ **Market-Aware Analiz**: Sadece api-sports.io'da MEVCUT OLAN (yani iddaa'da da var olan) marketler analiz edilir
- ✅ **Odds Filtresi**: Min 1.60 oran (değiştirilebilir), opsiyonel üst limit
- ✅ **Yüksek Olasılık Filtresi**: Min %70 true probability (değiştirilebilir)
- ✅ **Split Handicap (Kırık Handikap)**: İddaa'nın "0.5:1" gibi split handicap marketleri destekleniyor
- ✅ **Sistem Kupon**: 3/5, 4/5 otomatik üretim + N/K özel kombinasyonlar
- ✅ **Multi-Sport Kupon**: Tek kuponda birden fazla spor karıştırma
- ✅ **Kupon Takibi**: Otomatik sonuç değerlendirmesi, ROI, win rate istatistikleri
- ✅ **Turkish UI**: Tam Türkçe arayüz (iddaa terminolojisi)

## Matematiksel Temel

### Dağılımlar (Distributions)
- **Poisson**: Düşük skorlu sporlar (Futbol ~2.5, Hokey ~6, Beyzbol ~8)
- **Normal (Gaussian)**: Yüksek skorlu sporlar (Basketbol ~160, NBA ~227, Hentbol ~55, AmFut ~45, Ragbi ~47, AFL ~170)
- **Markov-Set**: Voleybol (best-of-5 set tabanlı binomial)
- **Fight-Model**: MMA (Bradley-Terry ratio + method base rates)
- **Position-Model**: F1 (scaffolded)

### Algoritmalar
- **Kelly Criterion**: %25 fractional (güvenli stake sizing)
- **Value Bet Detection**: Edge = (true_prob - implied) / implied
- **ELO Rating**: Takım güç sıralaması
- **Form Analysis**: Son 5 maç weighted average (son maçlar daha ağırlıklı)
- **H2H Analysis**: Karşılıklı geçmiş performans
- **Split Handicap**: Iddaa kırık handikap matematiği

## Mimari

```
client/src/
├── sports/
│   ├── _core/              # Ortak matematik + interface
│   │   ├── types.ts        # SportPlugin interface, tüm type'lar
│   │   ├── poisson.ts      # Poisson distribution
│   │   ├── normal.ts       # Normal distribution
│   │   ├── kelly.ts        # Kelly criterion, edge, rating
│   │   ├── form.ts         # Form analysis
│   │   ├── h2h.ts          # Head-to-head analysis
│   │   ├── apiClient.ts    # Generic api-sports.io client
│   │   ├── __tests__/      # 30 critical algorithm tests
│   │   └── index.ts
│   ├── football/           # Futbol adapter (v3.football.api-sports.io)
│   ├── hockey/             # Hokey adapter (v1.hockey.api-sports.io)
│   ├── basketball/         # Basketbol (v1.basketball)
│   ├── nba/                # NBA (v2.nba)
│   ├── handball/           # Hentbol (v1.handball)
│   ├── americanFootball/   # Amerikan Futbolu (v1.american-football)
│   ├── baseball/           # Beyzbol (v1.baseball)
│   ├── volleyball/         # Voleybol (v1.volleyball)
│   ├── rugby/              # Ragbi (v1.rugby)
│   ├── mma/                # MMA (v1.mma)
│   ├── afl/                # AFL (v1.afl)
│   ├── formula1/           # Formula 1 (v1.formula-1)
│   └── registry.ts         # Tüm sport plugin'lerin registry'si
├── lib/
│   ├── couponEngine.ts     # Multi-sport coupon generator + system coupon
│   └── couponStorage.ts    # Kupon kayıt, sonuç takibi, ROI
├── contexts/
│   └── SportContext.tsx    # Current sport state
└── pages/
    ├── Dashboard.tsx       # Ana sayfa: tüm sporlar grid
    ├── SportHome.tsx       # Tek spor maç listesi
    ├── MatchDetail.tsx     # Maç detay + mevcut marketler
    ├── Coupons.tsx         # Multi-sport kupon üretici
    ├── SystemCoupons.tsx   # N/K sistem kupon
    ├── CouponHistory.tsx   # Kupon geçmişi + istatistik
    └── Settings.tsx        # Filtre ayarları
```

## Geliştirme

```bash
# Kur
npm install --legacy-peer-deps

# Development server (port 3030)
npm run dev

# Production build
npm run build

# Tests (30 algoritma testi)
npx vitest run
```

## Test Coverage

30 kritik algoritma testi:
- Poisson dağılım doğruluğu (toplam = 1)
- Normal CDF symmetry, bounds
- Split handicap math
- Kelly criterion extreme cases
- System coupon probability (DP-based)
- Form score weighting
- Basketball/other sport outcome derivations

## API Kaynakları

- api-sports.io API Key: `b9ccb3be380b9f990745280ac95b4763`
- Her spor için ayrı endpoint, unified interface
- Cache layer: In-memory + 5 dakika TTL default

## İddaa Market Eşlemeleri

Her spor için api-sports bet name → iddaa Türkçe adı mapping tanımlı.
Örnek (futbol):
- "Match Winner" → "Maç Sonucu"
- "Goals Over/Under" → "Alt/Üst"
- "Both Teams Score" → "Karşılıklı Gol"
- "Asian Handicap" → "Handikaplı Maç Sonucu"
- "Double Chance" → "Çifte Şans"
- "Exact Score" → "Skor Tahmini"

## Kupon Stratejileri

1. **Güvenli Kupon**: Olasılık ≥%75, 1.60-2.20 oran
2. **Değer Kuponu**: Edge ≥8%, 1.60-3.50 oran
3. **Yüksek Oran**: Oran ≥2.20, olasılık ≥%50
4. **Sistem 3/5**: 5 bahisten 3'ü tutması yeterli (10 kombinasyon)
5. **Sistem 4/5**: 5 bahisten 4'ü tutması yeterli (5 kombinasyon)
6. **Multi-Sport**: 3+ farklı spor karışık

## Güvenlik Uyarısı

Bu sistem gerçek para bahsi için tasarlanmıştır. Matematik doğrulanmış (30 test geçti) fakat:
- Her zaman kendi değerlendirmenizi yapın
- Kelly stake miktarları %25 fractional - yine de conservative olun
- Value bet ≠ kesin kazanç, sadece +EV anlamına gelir
- Bankroll'unuzun %1-5'inden fazlasını tek kupona yatırmayın
