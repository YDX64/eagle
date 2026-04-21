import { NextRequest, NextResponse } from 'next/server';
import { EnhancedPredictionOrchestrator } from '@/lib/enhanced-prediction-engine';
import { CacheService } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId: matchIdStr } = await params;

  try {
    const matchId = parseInt(matchIdStr);

    if (isNaN(matchId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid match ID' },
        { status: 400 }
      );
    }

    const cacheKey = CacheService.generateApiKey('enhanced-prediction', { matchId });

    const result = await CacheService.cacheApiResponse(
      cacheKey,
      () => EnhancedPredictionOrchestrator.generatePrediction(matchId),
      CacheService.TTL.PREDICTIONS
    );

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[ENHANCED_PREDICTION] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate enhanced prediction',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
