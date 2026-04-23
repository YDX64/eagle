import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const pred = await prisma.predictions.findUnique({
      where: { id },
      include: {
        picks: { orderBy: [{ is_best: 'desc' }, { expected_value: 'desc' }] },
        system_bets: true,
        pattern_matches: true,
        player_prop_picks: { orderBy: [{ is_best: 'desc' }, { probability: 'desc' }] },
      },
    });
    if (!pred) {
      return NextResponse.json({ success: false, error: 'Tahmin bulunamadı' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: pred });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
