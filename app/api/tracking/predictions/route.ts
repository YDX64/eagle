import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const sport = p.get('sport');
  const status = p.get('status');
  const date_from = p.get('date_from');
  const date_to = p.get('date_to');
  const page = Number(p.get('page') ?? 1);
  const limit = Math.min(Number(p.get('limit') ?? 50), 200);

  try {
    const where: any = {};
    if (sport) where.sport = sport;
    if (status) where.status = status;
    if (date_from || date_to) {
      where.match_date = {};
      if (date_from) where.match_date.gte = new Date(date_from);
      if (date_to) where.match_date.lte = new Date(date_to);
    }

    const [total, items] = await Promise.all([
      prisma.predictions.count({ where }),
      prisma.predictions.findMany({
        where,
        include: {
          picks: { orderBy: [{ is_best: 'desc' }, { expected_value: 'desc' }] },
          system_bets: true,
          pattern_matches: true,
          player_prop_picks: {
            where: { is_high_confidence: true },
            orderBy: { probability: 'desc' },
            take: 10,
          },
        },
        orderBy: [{ match_date: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
