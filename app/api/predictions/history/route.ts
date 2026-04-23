import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Auto-evaluate pending predictions for finished matches.
 * Runs as a side effect — does not block the response.
 */
async function autoEvaluatePendingPredictions() {
  try {
    // Find predictions that haven't been evaluated yet but whose match has results
    // We check for FT status OR matches with goals that are in the past
    const now = new Date();
    const pendingPredictions = await prisma.prediction.findMany({
      where: {
        is_correct: null,
        match: {
          OR: [
            { status_short: 'FT' },
            {
              // Match has goals recorded and is in the past (likely finished)
              home_goals: { not: null },
              away_goals: { not: null },
              date: { lt: now },
            },
          ],
        },
      },
      include: { match: true },
      take: 500, // Process in larger batches
    });

    if (pendingPredictions.length === 0) return;

    for (const prediction of pendingPredictions) {
      const match = prediction.match;
      const homeGoals = match.home_goals ?? 0;
      const awayGoals = match.away_goals ?? 0;
      const totalGoals = homeGoals + awayGoals;

      let matchActualResult = 'draw';
      if (homeGoals > awayGoals) matchActualResult = 'home';
      else if (awayGoals > homeGoals) matchActualResult = 'away';

      let isCorrect: boolean;
      let actualResult: string;

      switch (prediction.prediction_type) {
        case 'match_winner':
        case 'ensemble':
          actualResult = matchActualResult;
          isCorrect = prediction.predicted_value === matchActualResult;
          break;
        case 'both_teams_score':
          actualResult = (homeGoals > 0 && awayGoals > 0) ? 'yes' : 'no';
          isCorrect = prediction.predicted_value === actualResult;
          break;
        case 'over_under_goals':
          actualResult = totalGoals > 2.5 ? 'over' : 'under';
          isCorrect = prediction.predicted_value === actualResult;
          break;
        default:
          actualResult = matchActualResult;
          isCorrect = prediction.predicted_value === matchActualResult;
      }

      await prisma.prediction.update({
        where: { id: prediction.id },
        data: { is_correct: isCorrect, actual_result: actualResult },
      });
    }

    console.log(`[AUTO-EVALUATE] Updated ${pendingPredictions.length} predictions`);
  } catch (error) {
    console.error('[AUTO-EVALUATE] Error:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    // Fire-and-forget: evaluate pending predictions in background
    autoEvaluatePendingPredictions();
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const predictionType = searchParams.get('type'); // match_winner, both_teams_score, over_under_goals, ensemble
    const outcome = searchParams.get('outcome'); // won, lost, pending
    const tier = searchParams.get('tier'); // platinum, gold, silver
    const leagueId = searchParams.get('leagueId');
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const matchIds = searchParams.get('matchIds'); // comma-separated match IDs for batch lookup

    // Build where clause
    const where: any = {};

    // Match ID batch lookup (for match card badges)
    if (matchIds) {
      const ids = matchIds.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      if (ids.length > 0) {
        where.match_id = { in: ids };
      }
    }

    // Date filtering
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    // Type filtering
    if (predictionType) {
      where.prediction_type = predictionType;
    }

    // Outcome filtering
    if (outcome === 'won') {
      where.is_correct = true;
    } else if (outcome === 'lost') {
      where.is_correct = false;
    } else if (outcome === 'pending') {
      where.is_correct = null;
    }

    // Tier filtering
    if (tier) {
      where.confidence_tier = tier;
    }

    // League filtering via match relation
    if (leagueId) {
      where.match = { league_id: parseInt(leagueId, 10) };
    }

    // Count total
    const total = await prisma.prediction.count({ where });

    // Fetch predictions with match data
    const predictions = await prisma.prediction.findMany({
      where,
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true,
            league: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Calculate summary stats
    const allPredictions = await prisma.prediction.findMany({
      where,
      select: {
        is_correct: true,
        prediction_type: true,
        predicted_value: true,
        confidence_score: true,
        confidence_tier: true,
      },
    });

    const totalPredictions = allPredictions.length;
    const won = allPredictions.filter(p => p.is_correct === true).length;
    const lost = allPredictions.filter(p => p.is_correct === false).length;
    const pending = allPredictions.filter(p => p.is_correct === null).length;

    // Per-type stats
    const typeStats: Record<string, { total: number; won: number; lost: number; pending: number; rate: number }> = {};
    for (const p of allPredictions) {
      const type = p.prediction_type;
      if (!typeStats[type]) {
        typeStats[type] = { total: 0, won: 0, lost: 0, pending: 0, rate: 0 };
      }
      typeStats[type].total++;
      if (p.is_correct === true) typeStats[type].won++;
      else if (p.is_correct === false) typeStats[type].lost++;
      else typeStats[type].pending++;
    }
    // Calculate rates
    for (const key of Object.keys(typeStats)) {
      const s = typeStats[key];
      const evaluated = s.won + s.lost;
      s.rate = evaluated > 0 ? (s.won / evaluated) * 100 : 0;
    }

    // Per-tier stats
    const tierStats: Record<string, { total: number; won: number; lost: number; rate: number }> = {};
    for (const p of allPredictions) {
      const t = p.confidence_tier || 'unknown';
      if (!tierStats[t]) {
        tierStats[t] = { total: 0, won: 0, lost: 0, rate: 0 };
      }
      tierStats[t].total++;
      if (p.is_correct === true) tierStats[t].won++;
      else if (p.is_correct === false) tierStats[t].lost++;
    }
    for (const key of Object.keys(tierStats)) {
      const s = tierStats[key];
      const evaluated = s.won + s.lost;
      s.rate = evaluated > 0 ? (s.won / evaluated) * 100 : 0;
    }

    // Format predictions for response
    const formattedPredictions = predictions.map(p => ({
      id: p.id,
      matchId: p.match_id,
      predictionType: p.prediction_type,
      predictedValue: p.predicted_value,
      confidenceScore: p.confidence_score,
      confidenceTier: p.confidence_tier,
      isCorrect: p.is_correct,
      actualResult: p.actual_result,
      isHighConfidence: p.is_high_confidence,
      expectedValue: p.expected_value,
      kellyPercentage: p.kelly_percentage,
      algorithmVersion: p.algorithm_version,
      createdAt: p.createdAt,
      match: {
        id: p.match.id,
        date: p.match.date,
        status: p.match.status_short,
        homeTeam: {
          id: p.match.homeTeam.id,
          name: p.match.homeTeam.name,
          logo: p.match.homeTeam.logo,
        },
        awayTeam: {
          id: p.match.awayTeam.id,
          name: p.match.awayTeam.name,
          logo: p.match.awayTeam.logo,
        },
        homeGoals: p.match.home_goals,
        awayGoals: p.match.away_goals,
        league: {
          id: p.match.league.id,
          name: p.match.league.name,
          logo: p.match.league.logo,
          country: p.match.league.country,
        },
      },
    }));

    const evaluated = won + lost;
    const overallRate = evaluated > 0 ? (won / evaluated) * 100 : 0;

    return NextResponse.json({
      success: true,
      data: {
        predictions: formattedPredictions,
        summary: {
          total: totalPredictions,
          won,
          lost,
          pending,
          overallRate: Math.round(overallRate * 10) / 10,
          typeStats,
          tierStats,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('[PREDICTION HISTORY] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: 'Failed to fetch prediction history', detail: message },
      { status: 500 }
    );
  }
}
