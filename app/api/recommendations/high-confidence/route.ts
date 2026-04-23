import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncPredictionsForDate, PredictionSyncSummary } from '@/lib/services/prediction-sync';

export const dynamic = 'force-dynamic';

const TITLE_FILTERS = {
  over25: 'Üst 2.5',
  btts: 'Her İki Takım Gol - EVET',
};

type RecommendationType = keyof typeof TITLE_FILTERS | 'all';

function parseDateRange(dateParam: string) {
  const safeDate = dateParam || new Date().toISOString().slice(0, 10);
  const start = new Date(`${safeDate}T00:00:00Z`);
  const end = new Date(`${safeDate}T23:59:59.999Z`);
  return { start, end, safeDate };
}

function matchesType(title: string, type: RecommendationType) {
  if (type === 'all') {
    return (
      title.includes(TITLE_FILTERS.over25) ||
      title.includes(TITLE_FILTERS.btts)
    );
  }
  const needle = TITLE_FILTERS[type];
  return title.includes(needle);
}

async function ensureData({
  date,
  autoSync,
  forceSync,
  minConfidence,
  limit,
  skipIfFreshMinutes,
}: {
  date: string;
  autoSync: boolean;
  forceSync: boolean;
  minConfidence: number;
  limit?: number;
  skipIfFreshMinutes?: number;
}): Promise<PredictionSyncSummary | null> {
  const { start, end } = parseDateRange(date);

  const existingCount = await prisma.highConfidenceRecommendation.count({
    where: {
      match: {
        date: {
          gte: start,
          lte: end,
        },
      },
      confidence_score: {
        gte: minConfidence,
      },
    },
  });

  if (!forceSync && (!autoSync || existingCount > 0)) {
    return null;
  }

  return await syncPredictionsForDate({
    date,
    limit,
    force: forceSync,
    skipIfFreshMinutes: skipIfFreshMinutes ?? (forceSync ? 0 : 60),
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const dateParam = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const minConfidenceParam = Number(searchParams.get('minConfidence') ?? '0');
    const typeParam = (searchParams.get('type') as RecommendationType) || 'all';
    const autoSync = searchParams.get('autoSync') !== 'false';
    const forceSync = searchParams.get('force') === 'true';
    const limitParam = Number(searchParams.get('limit') ?? '0');
    const skipFreshParam = Number(searchParams.get('skipIfFreshMinutes') ?? '0');

    const { start, end, safeDate } = parseDateRange(dateParam);
    const minConfidence = Number.isFinite(minConfidenceParam)
      ? Math.max(0, Math.min(minConfidenceParam, 100)) / 100
      : 0;
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
    const skipIfFreshMinutes = Number.isFinite(skipFreshParam) && skipFreshParam > 0
      ? skipFreshParam
      : undefined;

    const syncSummary = await ensureData({
      date: safeDate,
      autoSync,
      forceSync,
      minConfidence,
      limit,
      skipIfFreshMinutes,
    });

    const matches = await prisma.match.findMany({
      where: {
        date: {
          gte: start,
          lte: end,
        },
        highConfidenceRecommendations: {
          some: {
            confidence_score: {
              gte: minConfidence,
            },
          },
        },
      },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true,
        highConfidenceRecommendations: {
          where: {
            confidence_score: {
              gte: minConfidence,
            },
          },
          orderBy: {
            confidence_score: 'desc',
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const rows = matches
      .flatMap((match) => {
        return match.highConfidenceRecommendations
          .map((rec) => {
            const [rawTitle, rawDetail] = rec.recommendation.split(':');
            const title = (rawTitle || '').trim();
            const detail = (rawDetail || '').trim();

            if (!matchesType(title, typeParam)) {
              return null;
            }

            return {
              id: rec.id,
              matchId: match.id,
              kickoffUtc: match.date.toISOString(),
              league: {
                id: match.league_id,
                name: match.league?.name ?? 'Unknown League',
                country: match.league?.country ?? undefined,
              },
              homeTeam: {
                id: match.home_team_id,
                name: match.homeTeam?.name ?? 'Home',
              },
              awayTeam: {
                id: match.away_team_id,
                name: match.awayTeam?.name ?? 'Away',
              },
              title,
              detail,
              tier: rec.confidence_tier,
              confidencePercent: Math.round((rec.confidence_score ?? 0) * 10000) / 100,
              reasoning: rec.reasoning ?? '',
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
      })
      .filter((row) => {
        if (typeParam === 'all') {
          return (
            row.title.includes(TITLE_FILTERS.over25) ||
            row.title.includes(TITLE_FILTERS.btts)
          );
        }
        return true;
      });

    return NextResponse.json({
      success: true,
      data: {
        date: safeDate,
        type: typeParam,
        minConfidence: minConfidence * 100,
        rows,
        syncSummary,
      },
    });
  } catch (error) {
    console.error('[high-confidence][GET]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load high confidence recommendations',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, limit, force, skipIfFreshMinutes } = body ?? {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, error: 'Valid date (YYYY-MM-DD) is required' },
        { status: 400 }
      );
    }

    const summary = await syncPredictionsForDate({
      date,
      limit: typeof limit === 'number' ? limit : undefined,
      force: Boolean(force),
      skipIfFreshMinutes: typeof skipIfFreshMinutes === 'number' ? skipIfFreshMinutes : (force ? 0 : 60),
    });

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('[high-confidence][POST]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync high confidence recommendations',
      },
      { status: 500 }
    );
  }
}
