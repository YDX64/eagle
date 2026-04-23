import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await prisma.market_taxonomy.findMany({
      orderBy: [{ sport: 'asc' }, { family: 'asc' }, { market_code: 'asc' }],
    });
    return NextResponse.json({ success: true, data, count: data.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
