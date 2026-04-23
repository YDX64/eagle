import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const limit = Math.min(Number(p.get('limit') ?? 50), 200);
  const status = p.get('status');
  try {
    const data = await prisma.prediction_runs.findMany({
      where: status ? { status } : undefined,
      orderBy: { started_at: 'desc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
