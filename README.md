# 🦅 Eagle - Football Prediction System

An AI-powered football prediction system with advanced statistical modeling for real-money betting operations.

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

- **Real-Time Match Data**: Live integration with AwaStats data service
- **Advanced Prediction Algorithms**: Dual-engine system with Poisson distribution
- **High-Confidence System**: Three-tier confidence scoring (Platinum/Gold/Silver)
- **Comprehensive Backtesting**: Historical performance validation with ROI
- **Smart Caching**: Dual-layer caching for optimal performance
- **Turkish Language Support**: Localized betting recommendations

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React, TypeScript
- **UI**: Radix UI, Tailwind CSS
- **Database**: SQLite with Prisma ORM
- **State**: Zustand, Tanstack Query
- **Charts**: Chart.js, Recharts, Plotly.js

## 📊 Prediction Algorithms

### Basic Engine
- Team form analysis (last 5-10 matches)
- Head-to-head historical data
- League position impact
- Home advantage factor
- Goal expectancy modeling

### Advanced Engine
- Poisson distribution for goal probability
- Momentum analysis with decay factor
- Expected Goals (xG) calculations
- Asian Handicap analysis
- Risk tier classification


## 🧠 Algorithm Reference

| Module | Location | Purpose | Key Inputs | Key Outputs & Tuneables |
| --- | --- | --- | --- | --- |
| `calculateTeamForm` | `lib/prediction-engine.ts` | Converts recent results into a 0-1 strength score | Last 5-10 fixtures, goals for/against | `form_score` (tune: sample window)
| `calculateHomeAdvantage` | `lib/prediction-engine.ts` | Quantifies H2H-driven home bias | Head-to-head totals, wins | Advantage boost (`0.07`), min matches (`3`)
| `calculateGoalsAnalysis` | `lib/prediction-engine.ts` | Poisson-based xG approximation | Avg goals for/against (home/away) | `home_expected_goals`, total xG (tune: averaging weights)
| `calculateFirstHalfGoals` | `lib/prediction-engine.ts` | First-half goal odds & BTTS confidence | Expected goals, form consistency | `firstHalfFactor=0.6`, probability thresholds
| `generateAdvancedPrediction` | `lib/advanced-prediction-engine.ts` | Master engine blending form, standings, xG, risk tabs | Team IDs, league season, API stats | Weight map (`form 0.25`, `home 0.2`, etc.), risk confidence cut-offs
| Risk Builders (`high/medium/high_risk_bets`) | `lib/advanced-prediction-engine.ts` | Produces KG/Üst güvenli öneriler | Confidence scores, BTTS/OU probabilities | Thresholds (`>0.65` high), bet titles/descriptions
| `syncPredictionsForDate` | `lib/services/prediction-sync.ts` | Automates advanced prediction + risk persistence | Tarih, limit, force flag | Match/prediction/high-confidence rows (tune: `skipIfFreshMinutes`)
| `bulk-analysis` deterministic scorer | `app/api/bulk-analysis/route.ts` | Fallback analiz (standings + H2H) | Standings, H2H, defaults | Winner/BTTS/O-U scores (tune: risk tiers, EV formülleri)

### Veri Akışı (Mermaid)

```mermaid
flowchart TD
    subgraph DataSources
        A[AwaStats Fixtures/Stats]
        B[Prisma DB]
    end

    subgraph Engines
        C[PredictionEngine
Temel form & H2H]
        D[AdvancedPredictionEngine
Gelişmiş + Risk]
        E[Bulk Analysis Fallback
Deterministic]
        F[Backtest Modülleri]
    end

    subgraph Orchestration
        G[prediction-sync
(Günlük senk.)]
        H[Cron Daily Analysis
(Bulk + Goal Sync)]
    end

    subgraph Persistence
        I[(matches
predictions)]
        J[(high_confidence_recommendations)]
        K[(match_confidence_summaries)]
        L[(bulk_analysis_results)]
    end

    subgraph UI
        M[Matches Dashboard
KG & Üst 2.5 Sekmesi]
        N[Bulk Analysis
Otomatik KG Paneli]
        O[Raporsal Çıktılar
CSV & API]
    end

    A --> C
    A --> D
    A --> E
    B --> C
    B --> D
    B --> E

    C --> G
    D --> G
    E --> L
    F --> O

    G --> I
    G --> J
    G --> K

    H --> G
    H --> L

    I --> M
    J --> M
    J --> N
    L --> N
    O --> Users
```

## 📈 Confidence Tiers

- **🏆 Platinum** (85%+): Ultra-high confidence
- **🥇 Gold** (75-84%): High confidence
- **🥈 Silver** (65-74%): Good confidence

## 🔒 Security

- Environment variable protection
- API key validation
- Rate limiting
- Input sanitization with Zod
- CORS configuration

## 📄 License

MIT License

## ⚠️ Disclaimer

This system is for educational purposes. Please gamble responsibly and be aware of local laws regarding sports betting. Predictions are based on statistical analysis and do not guarantee winning outcomes.