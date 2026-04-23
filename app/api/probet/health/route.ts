/**
 * GET /api/probet/health
 *
 * Lightweight health check for Docker/Traefik. Returns 200 if the app is
 * serving requests. Optionally pings the tracking DB to verify end-to-end.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'probet',
      timestamp: new Date().toISOString(),
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
