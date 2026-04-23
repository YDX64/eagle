import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron job that settles every pending prediction whose match has finished.
 * Delegates to /api/tracking/settle?sport=all. Keeps the cron surface thin.
 */
export async function GET(req: NextRequest) {
  return forward(req);
}
export async function POST(req: NextRequest) {
  return forward(req);
}

async function forward(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('authorization') ?? '';
    if (header.replace(/^Bearer\s+/i, '').trim() !== secret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    // Call the settlement handler directly, bypassing HTTP overhead.
    const { POST: handler } = await import('../../tracking/settle/route');
    const innerReq = new Request(req.url, {
      method: 'POST',
      body: JSON.stringify({ sport: 'all' }),
      headers: { 'content-type': 'application/json' },
    });
    // @ts-expect-error NextRequest constructor compat — passes through
    return handler(innerReq);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
