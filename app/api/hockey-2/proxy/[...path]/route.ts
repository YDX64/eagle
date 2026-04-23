/**
 * /api/hockey-2/proxy/[...path]
 *
 * Server-side proxy to v1.hockey.api-sports.io — keeps the api-sports key
 * out of the browser (original hockey-analytics client hard-coded it, which
 * leaks the key to every visitor). All /leagues, /teams, /games, /standings,
 * /odds calls from the ported pages hit this endpoint instead.
 *
 * Maintains a short in-memory cache to avoid hammering api-sports on every
 * navigation (5 min default TTL).
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOCKEY_API_BASE = 'https://v1.hockey.api-sports.io';
const API_KEY = process.env.API_FOOTBALL_KEY || '';

const cache = new Map<string, { data: any; expiresAt: number }>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const LIVE_TTL_MS = 30 * 1000;
const STATIC_TTL_MS = 60 * 60 * 1000;

function ttlFor(path: string): number {
  if (path.includes('status') || path.includes('timezone') || path.includes('seasons') || path.includes('countries')) {
    return STATIC_TTL_MS;
  }
  return DEFAULT_TTL_MS;
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path || path.length === 0) {
    return NextResponse.json({ success: false, error: 'missing path' }, { status: 400 });
  }

  const endpoint = path.join('/');
  const searchParams = req.nextUrl.searchParams;
  const cacheKey =
    endpoint +
    '?' +
    Array.from(searchParams.entries())
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.data, {
      headers: { 'X-Cache': 'HIT' },
    });
  }

  const url = new URL(`${HOCKEY_API_BASE}/${endpoint}`);
  searchParams.forEach((v, k) => url.searchParams.set(k, v));

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        'x-apisports-key': API_KEY,
      },
      cache: 'no-store',
    });
    const json = await upstream.json();

    // Treat rate-limit / errors as 502
    if (
      json &&
      json.errors &&
      !Array.isArray(json.errors) &&
      Object.keys(json.errors).length > 0
    ) {
      return NextResponse.json(json, {
        status: 502,
        headers: { 'X-Cache': 'MISS' },
      });
    }

    cache.set(cacheKey, {
      data: json,
      expiresAt: Date.now() + ttlFor(endpoint),
    });
    return NextResponse.json(json, { headers: { 'X-Cache': 'MISS' } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handle(req, context);
}
