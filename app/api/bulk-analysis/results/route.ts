import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withApiProtection, createApiResponse, handleApiError } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

async function bulkAnalysisResultsHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');

    if (!dateParam) {
      return createApiResponse({
        success: false,
        error: 'Date parameter is required',
      });
    }

    const tier = searchParams.get('tier') || '';
    const riskLevel = searchParams.get('riskLevel') || '';
    const league = searchParams.get('league') || '';
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '1000', 10));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    const startDate = new Date(`${dateParam}T00:00:00.000Z`);
    const endDate = new Date(`${dateParam}T23:59:59.999Z`);

    const where: any = {
      date: {
        gte: startDate,
        lt: endDate,
      },
    };

    if (tier) {
      where.confidence_tier = tier;
    }

    if (riskLevel) {
      where.risk_level = riskLevel;
    }

    if (league) {
      where.league_name = {
        contains: league,
        mode: 'insensitive',
      };
    }

    const allResults = await prisma.bulkAnalysisResult.findMany({
      where,
      orderBy: [
        { date: 'asc' },
        { match_id: 'asc' },
      ],
    });

    const total = allResults.length;
    const startIndex = (page - 1) * limit;
    const pagedResults = allResults.slice(startIndex, startIndex + limit);

    const byTier: Record<string, number> = {};
    allResults.forEach((result) => {
      const key = result.confidence_tier ?? 'unknown';
      byTier[key] = (byTier[key] ?? 0) + 1;
    });

    return createApiResponse({
      success: true,
      data: {
        results: pagedResults,
        stats: {
          total,
          byTier,
        },
        page,
        limit,
      },
    });
  } catch (error) {
    console.error('Error fetching bulk analysis results:', error);
    return handleApiError(error);
  }
}

export const GET = withApiProtection(bulkAnalysisResultsHandler, {
  rateLimit: true,
  validateApiKey: false,
});
