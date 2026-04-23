import { NextRequest, NextResponse } from 'next/server';
import { getOddsHistory } from '@/lib/tracking/odds-snapshotter';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const sport = p.get('sport') as SportCode | null;
  const api_game_id = Number(p.get('api_game_id'));
  if (!sport || !api_game_id) {
    return NextResponse.json(
      { success: false, error: 'sport ve api_game_id zorunlu' },
      { status: 400 },
    );
  }
  try {
    const data = await getOddsHistory({
      sport,
      api_game_id,
      market: p.get('market') ?? undefined,
      bookmaker: p.get('bookmaker') ?? undefined,
      limit: Number(p.get('limit') ?? 500),
    });
    return NextResponse.json({ success: true, data, count: data.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
