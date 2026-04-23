import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  generateHighOddsPicks,
  buildSystemCoupons,
} from '@/lib/services/system-coupon-engine';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const budget = parseFloat(searchParams.get('budget') || '100');

    // Get upcoming predictions for the selected date
    const startDate = new Date(`${date}T00:00:00.000Z`);
    const endDate = new Date(`${date}T23:59:59.999Z`);

    // Fetch predictions for upcoming matches with their match data
    const predictions = await prisma.prediction.findMany({
      where: {
        match: {
          date: { gte: startDate, lte: endDate },
          status_short: 'NS', // Only upcoming matches
        },
      },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true,
            league: true,
          },
        },
      },
      orderBy: { confidence_score: 'desc' },
    });

    // Also try bulk analysis results for market odds data
    const bulkResults = await prisma.bulkAnalysisResult.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
      select: {
        match_id: true,
        market_odds_home: true,
        market_odds_away: true,
        market_odds_draw: true,
      },
    });

    const oddsMap = new Map<number, { home: number | null; away: number | null; draw: number | null }>();
    for (const br of bulkResults) {
      oddsMap.set(br.match_id, {
        home: br.market_odds_home,
        away: br.market_odds_away,
        draw: br.market_odds_draw,
      });
    }

    // Transform predictions for the coupon engine
    const predictionData = predictions.map(p => {
      const odds = oddsMap.get(p.match_id);
      return {
        matchId: p.match_id,
        homeTeam: p.match.homeTeam.name,
        awayTeam: p.match.awayTeam.name,
        league: p.match.league.name,
        matchDate: p.match.date.toISOString(),
        predictionType: p.prediction_type,
        predictedValue: p.predicted_value,
        confidenceScore: p.confidence_score,
        marketOddsHome: odds?.home,
        marketOddsDraw: odds?.draw,
        marketOddsAway: odds?.away,
      };
    });

    // Generate high-odds picks
    const highOddsPicks = generateHighOddsPicks(predictionData);

    // Build system coupons
    const coupons = buildSystemCoupons(highOddsPicks, budget);

    // Calculate historical performance for similar picks
    const historicalStats = await getHistoricalPerformance();

    return NextResponse.json({
      success: true,
      data: {
        coupons,
        availablePicks: highOddsPicks.length,
        totalPredictions: predictions.length,
        date,
        budget,
        historicalPerformance: historicalStats,
      },
    });
  } catch (error) {
    console.error('[SYSTEM COUPONS] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: 'Failed to generate system coupons', detail: message },
      { status: 500 }
    );
  }
}

async function getHistoricalPerformance() {
  try {
    // Get statistics on how different prediction types perform
    const stats = await prisma.prediction.groupBy({
      by: ['prediction_type'],
      where: {
        is_correct: { not: null },
      },
      _count: { id: true },
      _avg: { confidence_score: true },
    });

    const correctStats = await prisma.prediction.groupBy({
      by: ['prediction_type'],
      where: {
        is_correct: true,
      },
      _count: { id: true },
    });

    return stats.map(s => {
      const correct = correctStats.find(c => c.prediction_type === s.prediction_type);
      return {
        type: s.prediction_type,
        total: s._count.id,
        correct: correct?._count.id || 0,
        rate: s._count.id > 0 ? Math.round(((correct?._count.id || 0) / s._count.id) * 1000) / 10 : 0,
        avgConfidence: Math.round((s._avg.confidence_score || 0) * 1000) / 10,
      };
    });
  } catch {
    return [];
  }
}
