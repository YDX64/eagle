# 🦅 Eagle — AwaStats Prediction Platform

An AI-powered football prediction system built on the **AwaStats Nexus**
stack. Designed for real-money betting operations with rigorous
risk tiering and full historical validation.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your AWASTATS_API_KEY

# Set up database
npx prisma generate
npx prisma migrate dev

# Start development server
npm run dev
```

## 🎯 Features

- **Real-Time Match Data**: Live integration with the AwaStats data service.
- **Dual-Layer Prediction Stack**: GoalFlux Kernel (probabilistic goal model
  with Beklenen Gol Skoru integration) + NeuroStack Ensemble (multi-model
  boosted decision stack) + deterministic AwaCore fallback.
- **Per-League ChronoFold Validation**: Each league is trained on its own
  time-ordered history — no future-data leakage.
- **High-Confidence System**: Three-tier confidence scoring
  (Platinum / Gold / Silver) with market-specific thresholds.
- **Comprehensive Backtesting**: Historical accuracy + ROI, bias-free
  exact-score modelling, automated stake/Kelly analytics.
- **AwaPulse Momentum**: Recency-weighted form signal used by all engines.
- **Smart Caching**: Dual-layer cache (database + in-memory) with
  per-endpoint TTL and token-bucket rate-limit.
- **Turkish Language Support**: Localized betting recommendations
  (KG/Karşılıklı Gol, Üst 2.5, Alt 2.5, Handikap).

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React, TypeScript
- **UI**: Radix UI, Tailwind CSS
- **Database**: SQLite with Prisma ORM
- **State**: Zustand, Tanstack Query
- **Charts**: Chart.js, Recharts, Plotly.js
- **Auth**: NextAuth.js (Credentials + Prisma adapter + bcrypt)
- **Security**: CSP, HSTS, COOP/CORP, per-IP tiered rate limiting, CSRF-lite

## 📊 Prediction Engines

### AwaCore (base)
- Team form analysis (last 5–10 matches)
- Head-to-head historical data
- League-position impact
- Home-advantage factor
- Goal-expectancy modelling (GoalFlux)

### AwaCore Advanced
- GoalFlux probabilistic model for goal markets and exact scores
- AwaPulse momentum (recency-weighted)
- Beklenen Gol Skoru (BGS) calculations
- Asian Handicap derivation
- Risk-tier classification

### AwaStats Nexus (ensemble)
- GoalFlux Kernel + NeuroStack Ensemble blend
- ChronoFold Validation per league
- Consensus anchor from the AwaStats data service

## 📈 Confidence Tiers

- **🏆 Platinum** (85%+): Ultra-high confidence
- **🥇 Gold** (75–84%): High confidence
- **🥈 Silver** (65–74%): Good confidence

## 🔒 Security

- Environment variable protection + restricted file permissions
- NextAuth credentials with bcrypt hashing
- Tiered per-IP rate limiting (10 rpm on auth, 120 rpm general)
- CSRF-lite origin validation on write endpoints
- Content-Security-Policy + HSTS + COOP/CORP baseline
- Docker: non-root runtime, `cap_drop: ALL`, tmpfs /tmp+/run

## 📄 License

MIT License

## ⚠️ Disclaimer

This system is intended for educational and research purposes.
Gamble responsibly and follow local laws regarding sports betting.
Predictions reflect statistical modelling, not guarantees.
