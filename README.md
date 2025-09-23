# 🦅 Eagle - Football Prediction System

An AI-powered football prediction system with advanced statistical modeling for real-money betting operations.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your API_FOOTBALL_KEY

# Set up database
npx prisma generate
npx prisma migrate dev

# Start development server
npm run dev
```

## 🎯 Features

- **Real-Time Match Data**: Live integration with API-Football.com
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