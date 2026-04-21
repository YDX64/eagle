import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withApiProtection, createApiResponse, handleApiError } from '@/lib/api-utils';

export const dynamic = "force-dynamic";

async function bulkAnalysisResultsHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const league = searchParams.get('league');
    const confidenceTier = searchParams.get('confidence_tier');
    const riskLevel = searchParams.get('risk_level');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');

    // Build where clause
    const where: any = {};
    
    if (date) {
      where.date = {
        gte: new Date(date + 'T00:00:00.000Z'),
        lt: new Date(date + 'T23:59:59.999Z')
      };
    }

    if (league) {
      where.league_name = {
        contains: league,
        mode: 'insensitive'
      };
    }

    if (confidenceTier) {
      where.confidence_tier = confidenceTier;
    }

    if (riskLevel) {
      where.risk_level = riskLevel;
    }

    // Get total count
    const totalCount = await prisma.bulkAnalysisResult.count({ where });

    // Get results with pagination
    const results = await prisma.bulkAnalysisResult.findMany({
      where,
      orderBy: [
        { overall_confidence: 'desc' },
        { date: 'desc' }
      ],
      skip: (page - 1) * limit,
      take: limit
    });

    // Get summary statistics
    const stats = await prisma.bulkAnalysisResult.groupBy({
      by: ['confidence_tier'],
      where,
      _count: {
        confidence_tier: true
      }
    });

    return createApiResponse({
      results,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1
      },
      stats: {
        total: totalCount,
        byTier: stats.reduce((acc: Record<string, number>, stat: any) => {
          acc[stat.confidence_tier || 'unknown'] = stat._count.confidence_tier;
          return acc;
        }, {} as Record<string, number>)
      }
    });

  } catch (error) {
    console.error('Error fetching bulk analysis results:', error);
    return handleApiError(error);
  }
}

export const GET = withApiProtection(bulkAnalysisResultsHandler, {
  rateLimit: true,
  validateApiKey: false
});