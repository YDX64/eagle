import { NextResponse } from 'next/server';
import { cache } from '@/lib/db/json-cache';

// Mock analysis functions - replace with actual API calls
async function analyzeMatch(matchId: number, detailed: boolean = false) {
  // This would normally call your football API
  // For now, return mock data
  return {
    advancedPrediction: {
      winner: {
        home: Math.random() * 100,
        draw: Math.random() * 100,
        away: Math.random() * 100
      },
      goals: {
        home: Math.random() * 3,
        away: Math.random() * 3
      },
      comparison: {
        form: {
          home: (Math.random() * 100).toFixed(0),
          away: (Math.random() * 100).toFixed(0)
        }
      }
    },
    statistics: {
      homeTeam: { winRate: Math.random() * 100 },
      awayTeam: { winRate: Math.random() * 100 }
    }
  };
}

async function getValueBets(matchId: number, minValue: number = 5) {
  // This would normally call your football API
  // For now, return mock data
  return {
    opportunities: [
      {
        outcome: 'Home Win',
        value: Math.random() * 20,
        odds: 2.1
      }
    ]
  };
}

export async function POST(request: Request) {
  try {
    const { matchIds, forceUpdate = false } = await request.json();

    if (!matchIds || !Array.isArray(matchIds)) {
      return NextResponse.json({ error: 'Match IDs array required' }, { status: 400 });
    }

    // Check cache first if not forcing update
    if (!forceUpdate) {
      const cachedPredictions = cache.getPredictionsByIds(matchIds);

      if (cachedPredictions.length === matchIds.length) {
        return NextResponse.json({
          success: true,
          source: 'cache',
          predictions: cachedPredictions
        });
      }
    }

    // Batch analyze matches
    const predictions = await Promise.all(
      matchIds.map(async (matchId) => {
        try {
          // Check cache for individual match
          if (!forceUpdate) {
            const cached = cache.getPrediction(matchId);
            if (cached) return cached;
          }

          // Get match analysis
          const analysis = await analyzeMatch(matchId, true);
          const valueBets = await getValueBets(matchId, 5.0);

          // Calculate confidence score
          const confidence = calculateConfidenceScore(analysis, valueBets);

          // Determine recommended bet
          const recommendedBet = determineRecommendedBet(analysis, valueBets, confidence);

          const prediction = {
            match_id: matchId,
            confidence_score: confidence,
            recommended_bet: recommendedBet,
            prediction_data: analysis,
            value_bets: valueBets,
            last_updated: new Date().toISOString(),
            expiry_time: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour expiry
          };

          // Store in cache
          cache.savePrediction(prediction);

          return prediction;
        } catch (error) {
          console.error(`Error analyzing match ${matchId}:`, error);
          return null;
        }
      })
    );

    const validPredictions = predictions.filter(p => p !== null);

    // Log the analysis
    cache.saveAnalysisLog({
      run_time: new Date().toISOString(),
      matches_analyzed: validPredictions.length,
      matches_failed: matchIds.length - validPredictions.length,
      total_matches: matchIds.length,
      status: 'completed'
    });

    return NextResponse.json({
      success: true,
      source: 'fresh',
      predictions: validPredictions,
      analyzed: validPredictions.length,
      failed: matchIds.length - validPredictions.length
    });

  } catch (error) {
    console.error('Batch analysis error:', error);

    // Log error
    cache.saveAnalysisLog({
      run_time: new Date().toISOString(),
      matches_analyzed: 0,
      matches_failed: 0,
      total_matches: 0,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

function calculateConfidenceScore(analysis: any, valueBets: any): number {
  let score = 0;
  let factors = 0;

  // Advanced prediction confidence
  if (analysis.advancedPrediction) {
    const pred = analysis.advancedPrediction;

    // Winner confidence
    if (pred.winner) {
      const winnerConfidence = Math.max(
        pred.winner.home || 0,
        pred.winner.draw || 0,
        pred.winner.away || 0
      );
      score += winnerConfidence;
      factors++;
    }

    // Goals confidence
    if (pred.goals?.home && pred.goals?.away) {
      const goalConfidence = (pred.goals.home + pred.goals.away) / 2;
      score += goalConfidence;
      factors++;
    }

    // Form analysis
    if (pred.comparison?.form) {
      const formDiff = Math.abs(
        parseInt(pred.comparison.form.home) - parseInt(pred.comparison.form.away)
      );
      score += Math.min(formDiff * 10, 100);
      factors++;
    }
  }

  // Value bet confidence
  if (valueBets?.opportunities?.length > 0) {
    const bestValue = Math.max(...valueBets.opportunities.map((o: any) => o.value || 0));
    score += Math.min(bestValue * 2, 100);
    factors++;
  }

  // Statistical confidence
  if (analysis.statistics) {
    const stats = analysis.statistics;
    const homeWinRate = stats.homeTeam?.winRate || 0;
    const awayWinRate = stats.awayTeam?.winRate || 0;

    if (Math.abs(homeWinRate - awayWinRate) > 30) {
      score += 80;
      factors++;
    }
  }

  return factors > 0 ? Math.min(score / factors, 100) : 0;
}

function determineRecommendedBet(analysis: any, valueBets: any, confidence: number): string {
  // High confidence threshold
  if (confidence < 75) {
    return 'Düşük Güven - Bahis Önerilmez';
  }

  // Check value bets first
  if (valueBets?.opportunities?.length > 0) {
    const bestValue = valueBets.opportunities[0];
    if (bestValue.value > 10) {
      return `Değer Bahsi: ${bestValue.outcome} (${bestValue.value.toFixed(1)}% değer)`;
    }
  }

  // Check prediction
  if (analysis.advancedPrediction?.winner) {
    const winner = analysis.advancedPrediction.winner;
    if (winner.home > 60) return `Ev Sahibi Kazanır (${winner.home}% güven)`;
    if (winner.away > 60) return `Deplasman Kazanır (${winner.away}% güven)`;
    if (winner.draw > 40) return `Beraberlik Riski Yüksek (${winner.draw}%)`;
  }

  // Goals prediction
  if (analysis.advancedPrediction?.goals) {
    const totalGoals = (analysis.advancedPrediction.goals.home || 0) + (analysis.advancedPrediction.goals.away || 0);
    if (totalGoals > 2.5) return `Üst 2.5 Gol (${totalGoals.toFixed(1)} gol beklentisi)`;
    if (totalGoals < 2.5) return `Alt 2.5 Gol (${totalGoals.toFixed(1)} gol beklentisi)`;
  }

  return 'Analiz Devam Ediyor';
}

// GET endpoint to fetch cached predictions
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const matchIds = searchParams.get('matchIds')?.split(',').map(Number);

    if (!matchIds || matchIds.length === 0) {
      return NextResponse.json({ error: 'Match IDs required' }, { status: 400 });
    }

    const predictions = cache.getPredictionsByIds(matchIds);

    return NextResponse.json({
      success: true,
      predictions: predictions.map(p => ({
        match_id: p.match_id,
        confidence_score: p.confidence_score,
        recommended_bet: p.recommended_bet,
        last_updated: p.last_updated
      }))
    });

  } catch (error) {
    console.error('Fetch predictions error:', error);
    return NextResponse.json({ error: 'Failed to fetch predictions' }, { status: 500 });
  }
}