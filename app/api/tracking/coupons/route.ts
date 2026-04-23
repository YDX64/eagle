import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!prisma) return NextResponse.json({ success: true, data: [], count: 0 });
  const p = req.nextUrl.searchParams;
  const status = p.get('status');
  const limit = Math.min(Number(p.get('limit') ?? 50), 200);
  try {
    const rows = await prisma.coupons.findMany({
      where: status ? { status } : undefined,
      include: { legs: { orderBy: { id: 'asc' } } },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
