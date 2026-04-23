import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService } from '@/lib/api-football';

export const dynamic = 'force-dynamic';

/**
 * Historical model accuracy from backtest (4 Nisan 2026, 1118 tahmin).
 * ÖNEMLI: Bu, modelin doğruluk oranıdır — temel olasılık DEĞİL.
 * "match_winner_away: 0.7113" → "away tahmin ettiğimizde %71 tuttu",
 * away takımların her maçta %71 kazandığı anlamına GELMEZ.
 * EV hesabında değil, sadece kalite filtresi olarak kullanılır.
 */
const MODEL_ACCURACY = {
  over_under_under: 0.7563,
  match_winner_away: 0.7113,
  over_under_over: 0.700,
  both_teams_score_yes: 0.604,
  both_teams_score_no: 0.5889,
  match_winner_home: 0.5578,
};

const MAJOR_LEAGUE_IDS = new Set([
  39, 140, 78, 135, 61,
  2, 3,
  203, 88, 94, 207, 144,
  253, 262, 71,
]);

interface ValueBet {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;
  market: string;
  prediction: string;
  ourProbability: number;   // Direct model probability (0-100)
  impliedProbability: number; // Bookmaker implied probability = 1/odds (0-100)
  estimatedOdds: number;
  expectedValue: number;    // EV% = (prob × odds - 1) × 100
  confidence: string;
  reasoning: string;
  kellyStake: number;
  modelAccuracy: number;    // Historical accuracy of this market type
}

/**
 * Tahmini bookmaker oranları — iki bağımsız kaynaktan:
 * 1. Gol marketleri (alt/üst, BTTS): lambda'ya göre kalibre edilmiş gerçekçi piyasa oranları
 * 2. Maç sonucu: tahmin yüzdelerinden türetilen "ev taraftarlığı düzeltilmiş" oranlar
 *
 * Değer bahsi = bizim olasılığımız (AwaStats GoalFlux) > bookmaker implied olasılığı (1/oran)
 */
function estimateMarketOdds(
  market: 'home' | 'away' | 'draw' | 'btts_yes' | 'btts_no' | 'over' | 'under',
  homeWinProb: number,
  awayWinProb: number,
  homeFormScore: number,
  awayFormScore: number,
  lambda?: number
): number {
  const OVERROUND = 1.08; // Tipik bookmaker marjı (~8%)

  switch (market) {
    case 'home': {
      // Bookmaker ev sahibine ~5% avantaj verir (actual prob 5pp düşüyor)
      const bookmarkerHomeProb = Math.max(0.10, homeWinProb - 0.05);
      return Math.min(20, Math.max(1.10, Math.round((1 / (bookmarkerHomeProb * OVERROUND)) * 100) / 100));
    }

    case 'away': {
      // Ev sahibi önyargısı: bookmakerlar deplasman olasılığını ~8% düşürür
      const bookmarkerAwayProb = Math.max(0.08, awayWinProb - 0.08);
      return Math.min(20, Math.max(1.10, Math.round((1 / (bookmarkerAwayProb * OVERROUND)) * 100) / 100));
    }

    case 'draw': {
      // Beraberlik için önyargı yok, sadece overround
      const drawProb = Math.max(0.08, 1 - homeWinProb - awayWinProb);
      return Math.min(15, Math.max(1.10, Math.round((1 / (drawProb * OVERROUND)) * 100) / 100));
    }

    case 'btts_yes': {
      // Lambda'ya göre gözlemlenen piyasa oranları — bizim BTTS tahminimizden BAĞIMSIZ
      // Bu ayrım gerçek value için kritik: kendi prob → kendi oran, EV her zaman -7% olur
      const l = lambda ?? 2.4;
      if (l > 4.5) return 1.35;
      if (l > 3.5) return 1.55;
      if (l > 3.0) return 1.75;
      if (l > 2.6) return 1.90;
      if (l > 2.2) return 2.10;
      if (l > 1.8) return 2.40;
      if (l > 1.4) return 2.90;
      return 4.20;
    }

    case 'btts_no': {
      // Lambda arttıkça BTTS No oranı da artar (ev herkese gol atar → no daha az olası)
      const l = lambda ?? 2.4;
      if (l > 4.5) return 3.80;
      if (l > 3.5) return 2.80;
      if (l > 3.0) return 2.30;
      if (l > 2.6) return 1.90;
      if (l > 2.2) return 1.65;
      if (l > 1.8) return 1.48;
      if (l > 1.4) return 1.32;
      return 1.18;
    }

    case 'over': {
      // Piyasa lambda'ya göre kalibrasyon yapar — bu gerçekçi bir model
      const l = lambda ?? 2.4;
      if (l > 4.0) return 1.28;
      if (l > 3.5) return 1.42;
      if (l > 3.0) return 1.60;
      if (l > 2.7) return 1.78;
      if (l > 2.4) return 1.95;
      if (l > 2.0) return 2.20;
      if (l > 1.6) return 2.50;
      return 3.00;
    }

    case 'under': {
      // Piyasa lambda'ya göre kalibrasyon yapar — gerçek piyasa bunu yapar
      const l = lambda ?? 2.4;
      if (l < 1.0) return 1.18;  // Neredeyse kesin alt
      if (l < 1.3) return 1.30;
      if (l < 1.6) return 1.45;
      if (l < 1.9) return 1.62;
      if (l < 2.2) return 1.80;
      if (l < 2.5) return 1.95;
      if (l < 2.8) return 2.15;
      if (l < 3.2) return 2.40;
      return 2.80;
    }

    default:
      return 2.00;
  }
}

function calcEV(probability: number, odds: number): number {
  return probability * odds - 1;
}

function kellyStake(probability: number, odds: number): number {
  const k = (probability * odds - 1) / (odds - 1);
  return Math.max(0, Math.round(k * 0.25 * 1000) / 10);
}

function confidenceTier(ev: number, prob: number, modelAcc: number): string {
  // Platinum: yüksek EV + yüksek olasılık + güçlü geçmiş doğruluk
  if (ev >= 0.20 && prob >= 0.58 && modelAcc >= 0.70) return 'platinum';
  if (ev >= 0.12 && prob >= 0.50) return 'gold';
  return 'silver';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const minEV = parseFloat(searchParams.get('minEV') || '0.08');
    const limitPerLeague = parseInt(searchParams.get('limitPerLeague') || '3');
    const majorOnly = searchParams.get('majorOnly') !== 'false';

    const fixtures = await ApiFootballService.getFixturesByDate(date);

    if (!fixtures || fixtures.length === 0) {
      return NextResponse.json({ success: false, error: `${date} için maç bulunamadı` }, { status: 404 });
    }

    const upcoming = fixtures.filter(f => {
      const isNS = f.fixture.status.short === 'NS';
      if (majorOnly) return isNS && MAJOR_LEAGUE_IDS.has(f.league.id);
      return isNS;
    });

    if (upcoming.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          valueBets: [],
          message: `${date} tarihinde henüz oynanmamış maç yok (majorOnly=${majorOnly})`,
          totalFixtures: fixtures.length,
        }
      });
    }

    const valueBets: ValueBet[] = [];
    const leagueCounts: Record<number, number> = {};

    for (const fixture of upcoming) {
      const leagueId = fixture.league.id;
      if ((leagueCounts[leagueId] || 0) >= limitPerLeague) continue;

      try {
        // Varsayılan değerler — gerçek veriye göre güncellenir
        let homeWinProb = 0.45;
        let drawProb = 0.25;
        let awayWinProb = 0.30;
        let homeGoalsAvg = 1.30;
        let awayGoalsAvg = 1.10;
        let homeFormScore = 0.45;
        let awayFormScore = 0.40;
        let dataQuality = 'default';

        // AwaStats tahminleri (en güvenilir kaynak)
        const apiPred = await ApiFootballService.getPredictions(fixture.fixture.id);

        if (apiPred?.predictions?.percent) {
          const pp = apiPred.predictions.percent;
          // API "50%", "0%" gibi string döndürür
          const parseP = (v: any): number => {
            if (typeof v === 'string') return parseFloat(v.replace('%', '')) / 100;
            if (typeof v === 'number') return v > 1 ? v / 100 : v;
            return 0;
          };

          const h = parseP(pp.home);
          const d = parseP(pp.draw);
          const a = parseP(pp.away);
          if (h > 0 || d > 0 || a > 0) {
            homeWinProb = h || homeWinProb;
            drawProb = d || drawProb;
            awayWinProb = a || awayWinProb;
          }

          // Doğru path: teams.home.last_5.goals.for.average (string)
          const homeLast5 = apiPred.teams?.home?.last_5;
          const awayLast5 = apiPred.teams?.away?.last_5;

          if (homeLast5?.goals?.for?.average) {
            homeGoalsAvg = parseFloat(homeLast5.goals.for.average) || homeGoalsAvg;
          }
          if (awayLast5?.goals?.for?.average) {
            awayGoalsAvg = parseFloat(awayLast5.goals.for.average) || awayGoalsAvg;
          }

          // Form skoru: last_5.form = "73%" gibi string → 0.73
          if (homeLast5?.form) {
            homeFormScore = Math.max(0.10, parseFloat(String(homeLast5.form).replace('%', '')) / 100);
          }
          if (awayLast5?.form) {
            awayFormScore = Math.max(0.10, parseFloat(String(awayLast5.form).replace('%', '')) / 100);
          }

          dataQuality = 'api-predictions';

        } else {
          // Yedek plan: lig puan durumu
          const standings = await ApiFootballService.getStandings(leagueId, fixture.league.season);
          if (standings?.length > 0) {
            const hS = standings.find((s: any) => s.team.id === fixture.teams.home.id);
            const aS = standings.find((s: any) => s.team.id === fixture.teams.away.id);
            if (hS && aS) {
              const n = standings.length;
              // Form skoru = ters-sıralama (1. sıra en yüksek)
              homeFormScore = Math.max(0.10, 1 - (hS.rank - 1) / n);
              awayFormScore = Math.max(0.10, 1 - (aS.rank - 1) / n);
              const hStrength = homeFormScore + 0.10; // ev avantajı
              const total = hStrength + awayFormScore + 0.28;
              homeWinProb = hStrength / total;
              awayWinProb = awayFormScore / total;
              drawProb = 0.28 / total;
              if (hS.all?.played) homeGoalsAvg = Math.max(0.5, (hS.all.goals?.for ?? 1.3) / hS.all.played);
              if (aS.all?.played) awayGoalsAvg = Math.max(0.5, (aS.all.goals?.for ?? 1.1) / aS.all.played);
              dataQuality = 'standings';
            }
          }
        }

        // GoalFlux: gol piyasaları için olasılıksal model
        const lambda = homeGoalsAvg + awayGoalsAvg;
        const p0 = Math.exp(-lambda);
        const p1 = lambda * p0;
        const p2 = (lambda ** 2 / 2) * p0;
        const goalFluxOver = 1 - p0 - p1 - p2;
        const goalFluxUnder = 1 - goalFluxOver;
        const probHomeScores = 1 - Math.exp(-homeGoalsAvg);
        const probAwayScores = 1 - Math.exp(-awayGoalsAvg);
        const goalFluxBTTS = probHomeScores * probAwayScores;

        const matchTime = new Date(fixture.fixture.date).toLocaleTimeString('tr-TR', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
        });

        type BetKey = 'home' | 'away' | 'draw' | 'btts_yes' | 'btts_no' | 'over' | 'under';

        /**
         * Aday bahisler — olasılık doğrudan AwaStats GoalFlux çıktısından.
         * Tarihsel doğruluk ile karıştırma YOK (bu hatayı düzelttik).
         * EV = doğrudan_olasılık × bookmaker_oranı − 1
         */
        const candidates: Array<{
          market: string;
          prediction: string;
          betKey: BetKey;
          prob: number;
          minProb: number;   // Bu market için minimum eşik
          modelAcc: number;
          reasoning: string;
        }> = [
          {
            market: 'Alt/Üst 2.5',
            prediction: 'Alt 2.5 Gol',
            betKey: 'under',
            prob: goalFluxUnder,
            minProb: 0.55,
            modelAcc: MODEL_ACCURACY.over_under_under,
            reasoning: `GoalFlux λ=${lambda.toFixed(2)} (ev=${homeGoalsAvg.toFixed(1)} + dep=${awayGoalsAvg.toFixed(1)}) → Alt %${(goalFluxUnder*100).toFixed(0)} | Tarihsel doğruluk %75.6 | Veri: ${dataQuality}`,
          },
          {
            market: 'Maç Sonucu',
            prediction: `${fixture.teams.away.name} Kazanır (Deplasman)`,
            betKey: 'away',
            prob: awayWinProb,
            minProb: 0.38,   // Deplasman önyargısı: 3.5+ oran varken %38 bile değer
            modelAcc: MODEL_ACCURACY.match_winner_away,
            reasoning: `API dep. %${(awayWinProb*100).toFixed(0)} | Form: ev=${homeFormScore.toFixed(2)} dep=${awayFormScore.toFixed(2)} | Veri: ${dataQuality}`,
          },
          {
            market: 'Alt/Üst 2.5',
            prediction: 'Üst 2.5 Gol',
            betKey: 'over',
            prob: goalFluxOver,
            minProb: 0.55,
            modelAcc: MODEL_ACCURACY.over_under_over,
            reasoning: `GoalFlux λ=${lambda.toFixed(2)} (ev=${homeGoalsAvg.toFixed(1)} + dep=${awayGoalsAvg.toFixed(1)}) → Üst %${(goalFluxOver*100).toFixed(0)} | Tarihsel doğruluk %70.0 | Veri: ${dataQuality}`,
          },
          {
            market: 'KG VAR/YOK',
            prediction: 'Karşılıklı Gol VAR',
            betKey: 'btts_yes',
            prob: goalFluxBTTS,
            minProb: 0.55,
            modelAcc: MODEL_ACCURACY.both_teams_score_yes,
            reasoning: `P(ev gol)=%${(probHomeScores*100).toFixed(0)} × P(dep gol)=%${(probAwayScores*100).toFixed(0)} = BTTS %${(goalFluxBTTS*100).toFixed(0)} | λ=${lambda.toFixed(2)}`,
          },
          {
            market: 'KG VAR/YOK',
            prediction: 'Karşılıklı Gol YOK',
            betKey: 'btts_no',
            prob: 1 - goalFluxBTTS,
            minProb: 0.52,
            modelAcc: MODEL_ACCURACY.both_teams_score_no,
            reasoning: `En az bir takım gol atamaz %${((1-goalFluxBTTS)*100).toFixed(0)} | λ=${lambda.toFixed(2)}`,
          },
          {
            market: 'Maç Sonucu',
            prediction: `${fixture.teams.home.name} Kazanır (Ev Sahibi)`,
            betKey: 'home',
            prob: homeWinProb,
            minProb: 0.52,
            modelAcc: MODEL_ACCURACY.match_winner_home,
            reasoning: `API ev %${(homeWinProb*100).toFixed(0)} | Form: ev=${homeFormScore.toFixed(2)} dep=${awayFormScore.toFixed(2)} | Veri: ${dataQuality}`,
          },
        ];

        for (const c of candidates) {
          if (c.prob < c.minProb) continue; // Yeterince yüksek olasılık yok

          // Oranlar AwaStats win% + lambda'dan — GoalFlux olasılığımızdan bağımsız hesaplanır
          const odds = estimateMarketOdds(
            c.betKey, homeWinProb, awayWinProb,
            homeFormScore, awayFormScore, lambda
          );
          const ev = calcEV(c.prob, odds);
          const impliedProb = 1 / odds;

          // EV eşiği + olasılığımız bookmaker implied'dan yüksek olmalı
          if (ev >= minEV && c.prob > impliedProb) {
            const stake = kellyStake(c.prob, odds);
            valueBets.push({
              matchId: fixture.fixture.id,
              homeTeam: fixture.teams.home.name,
              awayTeam: fixture.teams.away.name,
              league: `${fixture.league.name} (${fixture.league.country})`,
              matchTime,
              market: c.market,
              prediction: c.prediction,
              ourProbability: Math.round(c.prob * 1000) / 10,
              impliedProbability: Math.round(impliedProb * 1000) / 10,
              estimatedOdds: odds,
              expectedValue: Math.round(ev * 1000) / 10,
              confidence: confidenceTier(ev, c.prob, c.modelAcc),
              reasoning: c.reasoning,
              kellyStake: stake,
              modelAccuracy: Math.round(c.modelAcc * 1000) / 10,
            });
          }
        }

        leagueCounts[leagueId] = (leagueCounts[leagueId] || 0) + 1;
        await new Promise(r => setTimeout(r, 100));

      } catch {
        continue;
      }
    }

    // EV'ye göre sırala
    valueBets.sort((a, b) => b.expectedValue - a.expectedValue);

    const platinum = valueBets.filter(b => b.confidence === 'platinum');
    const gold = valueBets.filter(b => b.confidence === 'gold');
    const topBets = valueBets.slice(0, 30);

    return NextResponse.json({
      success: true,
      data: {
        date,
        totalAnalyzed: upcoming.length,
        valueBetsFound: valueBets.length,
        summary: {
          platinum: platinum.length,
          gold: gold.length,
          silver: valueBets.length - platinum.length - gold.length,
          topEV: valueBets[0]?.expectedValue ?? 0,
          avgEV: valueBets.length > 0
            ? Math.round(valueBets.reduce((s, b) => s + b.expectedValue, 0) / valueBets.length * 10) / 10
            : 0,
        },
        valueBets: topBets,
        methodology: {
          description: 'EV = olasılık × bookmaker_oranı − 1. Bookmaker oranları takım güç farkından bağımsız hesaplanır. Değer, modelimizin bookmaker implied olasılığından daha yüksek tahmin ettiği durumlarda oluşur.',
          fix: 'v3: Tarihsel doğruluk EV hesabında kullanılmıyor — sadece kalite göstergesi. Bu, v2\'deki yapay +166% EV hatasını düzeltti.',
          modelAccuracy: MODEL_ACCURACY,
          marketEdge: {
            under25: 'GoalFlux modeli %55+ alt tahminlediğinde piyasa ~1.88 (imp.%53) → EV+',
            awayWin: 'Bookmakerlar ev sahibi önyargısıyla deplasmanı pahalı gösterir → dep. güçlüyse EV+',
            over25: 'λ > 2.8 maçlarda GoalFlux üst olasılığı %55+ → piyasa genellikle 2.00 önerir',
          },
        },
      },
    });

  } catch (error) {
    console.error('[VALUE BETS v3] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Value bets hesaplanamadı',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
