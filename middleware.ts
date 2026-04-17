import { NextRequest, NextResponse } from 'next/server';

// --- In-memory sliding-window rate limiter (per IP) ------------------------
// Edge/Node middleware may not persist across restarts, but survives
// within a single instance's lifetime which is enough to stop bursts
// that would otherwise burn through upstream API quota.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120; // 120 requests / minute / IP
const AUTH_RATE_LIMIT_MAX = 10; // tighter on auth endpoints to slow brute force
const buckets = new Map<string, number[]>();
const authBuckets = new Map<string, number[]>();

function recordAndCheck(bucketMap: Map<string, number[]>, ip: string, max: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const fresh = (bucketMap.get(ip) ?? []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  fresh.push(now);
  bucketMap.set(ip, fresh);
  return {
    allowed: fresh.length <= max,
    remaining: Math.max(0, max - fresh.length),
  };
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '0.0.0.0';
}

// Light CSRF: for state-changing API calls, reject cross-origin requests that
// don't include an Origin/Referer pointing at our own host. NextAuth handles
// its own CSRF via double-submit cookie, so its endpoints are exempted.
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin') || req.headers.get('referer');
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    const selfHost = req.nextUrl.host;
    if (originHost === selfHost) return true;
    // Trust X-Forwarded-Host when running behind Traefik / Coolify.
    const forwardedHost = req.headers.get('x-forwarded-host');
    return !!forwardedHost && originHost === forwardedHost;
  } catch {
    return false;
  }
}

function isTrustedBot(req: NextRequest): boolean {
  // Cron jobs and internal health checks can carry a shared secret instead
  // of a browser origin. This lets /api/cron/* fire without a browser.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return !!auth && auth === `Bearer ${secret}`;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const isAuthPath = pathname.startsWith('/api/auth/');
  const ip = clientIp(req);

  // Per-IP rate limit — tighter on auth endpoints.
  const { allowed, remaining } = recordAndCheck(
    isAuthPath ? authBuckets : buckets,
    ip,
    isAuthPath ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX
  );
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': '30',
          'X-RateLimit-Limit': String(isAuthPath ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  // CSRF-lite: reject state-changing requests with no matching origin
  // unless they carry a valid CRON_SECRET.
  if (
    STATE_CHANGING_METHODS.has(req.method) &&
    !isAuthPath && // NextAuth has its own CSRF token flow
    !sameOrigin(req) &&
    !isTrustedBot(req)
  ) {
    return NextResponse.json(
      { success: false, error: 'Cross-origin request refused' },
      { status: 403 }
    );
  }

  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Limit', String(isAuthPath ? AUTH_RATE_LIMIT_MAX : RATE_LIMIT_MAX));
  res.headers.set('X-RateLimit-Remaining', String(remaining));
  return res;
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};
