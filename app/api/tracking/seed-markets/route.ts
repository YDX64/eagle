import { NextResponse } from 'next/server';
import { seedMarketTaxonomy } from '@/lib/tracking/market-taxonomy';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const r = await seedMarketTaxonomy();
    return NextResponse.json({ success: true, data: r });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
