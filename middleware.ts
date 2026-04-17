import { NextRequest, NextResponse } from 'next/server';

// --- In-memory sliding-window rate limiter (per IP) ------------------------
// Edge/Node middleware may not persist across restarts, but survives
// within a single instance's lifetime which is enough to stop bursts
// that would otherwise burn through upstream API quota.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120; // 120 requests / minute / IP
const buckets = new Map<string, number[]>();

function recordAndCheck(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const fresh = (buckets.get(ip) ?? []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  fresh.push(now);
  buckets.set(ip, fresh);
  return {
    allowed: fresh.length <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - fresh.length),
  };
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '0.0.0.0';
}

// Mock auth endpoints must never be reachable in production — they return
// a hard-coded user and would bypass any real gating.
const MOCK_AUTH_PATHS = new Set<string>([
  '/api/auth/signin',
  '/api/auth/signup',
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (process.env.NODE_ENV === 'production' && MOCK_AUTH_PATHS.has(pathname)) {
    return NextResponse.json(
      { success: false, error: 'Authentication endpoint disabled in production' },
      { status: 503 }
    );
  }

  // Only rate-limit API routes — UI navigation should not be throttled.
  if (pathname.startsWith('/api/')) {
    const ip = clientIp(req);
    const { allowed, remaining } = recordAndCheck(ip);
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': '30',
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }
    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
    res.headers.set('X-RateLimit-Remaining', String(remaining));
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};
