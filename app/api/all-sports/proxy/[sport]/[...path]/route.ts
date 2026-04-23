/**
 * /api/all-sports/proxy/[sport]/[...path]
 *
 * Universal API proxy for all 12 sports. Routes requests to the appropriate
 * api-sports.io endpoint based on sport key, keeping API key server-side.
 *
 * Sport key mappings:
 *   football, hockey, basketball, handball, american-football, baseball,
 *   volleyball, rugby, mma, afl, formula-1  (v1)
 *   nba (v2)
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEY = process.env.AWASTATS_API_KEY || process.env.API_FOOTBALL_KEY || '';

const SPORT_API_BASES: Record<string, string> = {
  'football': 'https://v3.football.api-sports.io',
  'hockey': 'https://v1.hockey.api-sports.io',
  'basketball': 'https://v1.basketball.api-sports.io',
  'nba': 'https://v2.nba.api-sports.io',
  'handball': 'https://v1.handball.api-sports.io',
  'american-football': 'https://v1.american-football.api-sports.io',
  'americanfootball': 'https://v1.american-football.api-sports.io',
  'baseball': 'https://v1.baseball.api-sports.io',
  'volleyball': 'https://v1.volleyball.api-sports.io',
  'rugby': 'https://v1.rugby.api-sports.io',
  'mma': 'https://v1.mma.api-sports.io',
  'afl': 'https://v1.afl.api-sports.io',
  'formula-1': 'https://v1.formula-1.api-sports.io',
  'formula1': 'https://v1.formula-1.api-sports.io',
};

const cache = new Map<string, { data: any; expiresAt: number }>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const STATIC_TTL_MS = 60 * 60 * 1000;
const LIVE_TTL_MS = 30 * 1000;

function ttlFor(endpoint: string, params: URLSearchParams): number {
  if (endpoint.includes('status') || endpoint.includes('timezone') ||
      endpoint.includes('seasons') || endpoint.includes('countries') ||
      endpoint.includes('leagues')) {
    return STATIC_TTL_MS;
  }
  if (params.get('live') === 'all') return LIVE_TTL_MS;
  return DEFAULT_TTL_MS;
}

async function handle(req: NextRequest, context: { params: Promise<{ sport: string; path: string[] }> }) {
  const { sport, path } = await context.params;
  if (!sport || !path || path.length === 0) {
    return NextResponse.json({ success: false, error: 'missing sport or path' }, { status: 400 });
  }

  const sportKey = sport.toLowerCase();
  const apiBase = SPORT_API_BASES[sportKey];
  if (!apiBase) {
    return NextResponse.json({ success: false, error: `unknown sport: ${sport}` }, { status: 400 });
  }

  const endpoint = path.join('/');
  const searchParams = req.nextUrl.searchParams;
  const cacheKey = `${sportKey}::${endpoint}::${Array.from(searchParams.entries()).sort().map(([k, v]) => `${k}=${v}`).join('&')}`;

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.data, { headers: { 'X-Cache': 'HIT' } });
  }

  const url = new URL(`${apiBase}/${endpoint}`);
  searchParams.forEach((v, k) => url.searchParams.set(k, v));

  // Retry with exponential backoff on transient 429/5xx: when 12 sports
  // fetch in parallel the upstream throttler can return a one-off 502
  // which we don't want to expose as a permanent sport outage.
  async function fetchWithRetry(attempt = 0): Promise<Response> {
    const resp = await fetch(url.toString(), {
      headers: { 'x-apisports-key': API_KEY },
      cache: 'no-store',
    });
    if ((resp.status === 429 || resp.status >= 500) && attempt < 3) {
      const delay = Math.min(2000, 200 * Math.pow(2, attempt));
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(attempt + 1);
    }
    return resp;
  }

  try {
    const upstream = await fetchWithRetry();
    const json = await upstream.json().catch(() => null);

    // Transparent relay: keep upstream status. API-Sports returns
    // `errors: []` on success and `errors: { plan: "..." }` for soft
    // notices alongside valid data, so we don't 502 just on that.
    if (!upstream.ok) {
      return NextResponse.json(
        json ?? { success: false, error: `upstream ${upstream.status}` },
        { status: upstream.status, headers: { 'X-Cache': 'MISS', 'X-Sport': sportKey } }
      );
    }

    // Only cache responses that actually carry data so we don't poison
    // the cache with one-second upstream blips.
    const hasResults =
      (typeof json?.results === 'number' && json.results > 0) ||
      (Array.isArray(json?.response) && json.response.length > 0);
    if (hasResults) {
      cache.set(cacheKey, { data: json, expiresAt: Date.now() + ttlFor(endpoint, searchParams) });
    }
    return NextResponse.json(json, { headers: { 'X-Cache': 'MISS', 'X-Sport': sportKey } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ sport: string; path: string[] }> }) {
  return handle(req, context);
}

export async function POST(req: NextRequest, context: { params: Promise<{ sport: string; path: string[] }> }) {
  return handle(req, context);
}
