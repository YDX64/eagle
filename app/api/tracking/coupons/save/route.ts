import { NextRequest, NextResponse } from 'next/server';
import { trackingPrisma as prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface CouponLegInput {
  pick_id: number | string;
  sport: string;
  fixture_id: number;
  home_team?: string | null;
  away_team?: string | null;
  match_date?: string | null;
  league?: string | null;
  market: string;
  market_label?: string | null;
  pick_label?: string | null;
  probability?: number | null;
  market_odds?: number | null;
}

interface CouponSaveInput {
  stake?: number;
  note?: string;
  legs: CouponLegInput[];
}

function riskLevelFor(totalOdds: number, legs: number): string {
  if (legs <= 3 && totalOdds < 2) return 'low';
  if (legs <= 8 && totalOdds < 10) return 'medium';
  return 'high';
}

export async function POST(req: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ success: false, error: 'tracking DB not configured' }, { status: 503 });
  }
  let body: CouponSaveInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.legs) || body.legs.length === 0) {
    return NextResponse.json({ success: false, error: 'legs[] is required' }, { status: 400 });
  }

  const stake = body.stake ?? 100;
  let totalOdds = 1;
  let totalProb = 1;
  for (const leg of body.legs) {
    if (!leg.market || typeof leg.fixture_id !== 'number') {
      return NextResponse.json({ success: false, error: 'each leg needs market + fixture_id' }, { status: 400 });
    }
    const odd = typeof leg.market_odds === 'number' && leg.market_odds > 1 ? leg.market_odds : 1;
    const prob = typeof leg.probability === 'number' ? leg.probability : 0;
    totalOdds *= odd;
    if (prob > 0) totalProb *= prob;
  }
  const expectedReturn = stake * totalOdds;
  const expectedValue = stake * totalOdds * totalProb - stake;
  const riskLevel = riskLevelFor(totalOdds, body.legs.length);

  try {
    const coupon = await prisma.coupons.create({
      data: {
        stake,
        total_odds: Number(totalOdds.toFixed(4)),
        total_probability: Number(totalProb.toFixed(6)),
        expected_return: Number(expectedReturn.toFixed(2)),
        expected_value: Number(expectedValue.toFixed(2)),
        risk_level: riskLevel,
        status: 'pending',
        note: body.note ?? null,
        legs: {
          create: body.legs.map(leg => ({
            // Accept either a numeric id from the client or fall back to 0
            // when the upstream didn't carry one (e.g. synthetic picks).
            pick_id: BigInt(
              leg.pick_id != null && leg.pick_id !== ''
                ? Number(leg.pick_id)
                : 0,
            ),
            sport: leg.sport,
            fixture_id: leg.fixture_id,
            home_team: leg.home_team ?? null,
            away_team: leg.away_team ?? null,
            match_date: leg.match_date ? new Date(leg.match_date) : null,
            league: leg.league ?? null,
            market: leg.market,
            market_label: leg.market_label ?? null,
            pick_label: leg.pick_label ?? null,
            probability: leg.probability ?? null,
            market_odds: leg.market_odds ?? null,
          })),
        },
      },
      include: { legs: true },
    });
    return NextResponse.json({ success: true, data: coupon });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
