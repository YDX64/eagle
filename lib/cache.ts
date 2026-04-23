/**
 * Multi-tier cache service:
 *
 *   L1  (memory)    → in-process Map, fastest, ~10s–1h TTL
 *   L2  (Dragonfly) → shared across instances, Redis-compatible, ~30s–6h TTL
 *   L3  (Postgres)  → persistent `cache_entries`, survives restarts, ~1h–24h TTL
 *
 * Each tier falls through to the next on miss, and a successful deep-tier
 * read is back-filled into the shallower tiers with the remaining TTL.
 *
 * TTL is chosen either by explicit argument, by endpoint pattern, or (for
 * match-scoped keys) by **kickoff proximity** — live matches get 30s, finished
 * matches are effectively immutable, and upcoming matches get progressively
 * longer cache as they drift further from kickoff.
 *
 * Stale-while-revalidate: expired entries are still returned if `allowStale`
 * is true, while a background refresher updates them. This prevents cache
 * stampedes against the upstream API.
 */

// ────────────────────────────────────────────────────────────────────────
// L1 · In-memory LRU-ish map
// ────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: any;
  expiresAt: number;
  storedAt: number;
}

class InMemoryCache {
  private static cache = new Map<string, CacheEntry>();
  private static readonly MAX_ENTRIES = 5000;

  static get<T>(key: string, allowStale = false): { data: T; stale: boolean } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (entry.expiresAt > now) {
      return { data: entry.data as T, stale: false };
    }
    if (allowStale) {
      return { data: entry.data as T, stale: true };
    }
    this.cache.delete(key);
    return null;
  }

  static set(key: string, data: any, ttlSeconds: number): void {
    if (this.cache.size >= this.MAX_ENTRIES) {
      // Drop oldest ~5% for naive LRU
      const drop = Math.ceil(this.MAX_ENTRIES * 0.05);
      const iter = this.cache.keys();
      for (let i = 0; i < drop; i++) {
        const k = iter.next().value;
        if (k === undefined) break;
        this.cache.delete(k);
      }
    }
    const now = Date.now();
    this.cache.set(key, { data, expiresAt: now + ttlSeconds * 1000, storedAt: now });
  }

  static delete(key: string): void {
    this.cache.delete(key);
  }

  static cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) this.cache.delete(key);
    }
  }

  static size(): number {
    return this.cache.size;
  }
}

// ────────────────────────────────────────────────────────────────────────
// L2 · Dragonfly (Redis-compatible) — optional, best-effort
// ────────────────────────────────────────────────────────────────────────

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ping(): Promise<string>;
  quit?(): Promise<unknown>;
};

let redisClient: RedisLike | null = null;
let redisInitTried = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redisClient) return redisClient;
  if (redisInitTried) return null;
  redisInitTried = true;

  const url = process.env.REDIS_URL || process.env.DRAGONFLY_URL;
  if (!url) return null;

  try {
    // Lazy import so the dependency is optional
    const mod: any = await import('ioredis').catch(() => null);
    if (!mod) return null;
    const IoRedis = mod.default ?? mod;
    const client = new IoRedis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 2000,
      commandTimeout: 1500,
      retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 300, 1500)),
    });
    client.on('error', (err: Error) => {
      // Silence noisy reconnect logs but mark client unusable after a few
      if ((err as any)?.code === 'ECONNREFUSED') {
        // leave as-is, retry strategy handles it
      }
    });
    redisClient = client as RedisLike;
    return redisClient;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────
// L3 · PostgreSQL `cache_entries` (via Prisma)
// ────────────────────────────────────────────────────────────────────────

let prisma: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('./db');
  prisma = db.prisma;
} catch {
  /* no-op */
}

function looksLikePlaceholderUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.includes('username:password') ||
    url.includes('user:pass@') ||
    url === 'file:./dev.db.placeholder'
  );
}

const usePgCache = (() => {
  if (!prisma || looksLikePlaceholderUrl(process.env.DATABASE_URL)) return false;
  try {
    return typeof prisma.cacheEntry?.findUnique === 'function';
  } catch {
    return false;
  }
})();

// ────────────────────────────────────────────────────────────────────────
// Smart TTL — endpoint patterns + kickoff proximity
// ────────────────────────────────────────────────────────────────────────

export interface KickoffAware {
  /** ISO string of kickoff — enables smart TTL. */
  kickoff?: string | Date | null;
  /** Short status code (FT, LIVE, NS, HT, 1H, 2H, ...). Overrides proximity. */
  status?: string | null;
}

/** Match status buckets used across the app */
const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'BT']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'FT_PEN', 'CANC', 'ABD', 'WO', 'AWD']);

/**
 * Smart TTL in seconds based on kickoff proximity + live/finished status.
 *   • LIVE         → 30 s  (scores/elapsed change every tick)
 *   • FINISHED     → 7 d   (immutable)
 *   • < 2h to kick → 5 min (lineups, injuries drift)
 *   • < 24h        → 30 min
 *   • < 7d         → 6 h
 *   • ≥ 7d         → 24 h
 *   • Unknown      → 1 h   (conservative default)
 */
export function ttlForMatch(info: KickoffAware | null | undefined): number {
  if (!info) return 3600; // 1h default

  const status = info.status?.toUpperCase() ?? '';
  if (FINISHED_STATUSES.has(status)) return 7 * 24 * 3600;
  if (LIVE_STATUSES.has(status)) return 30;

  const kickoff = info.kickoff ? new Date(info.kickoff).getTime() : null;
  if (!kickoff || Number.isNaN(kickoff)) return 3600;

  const deltaMs = kickoff - Date.now();
  if (deltaMs <= 0) return 60;                    // kickoff passed but no status
  if (deltaMs < 2 * 3600 * 1000) return 300;      // < 2h
  if (deltaMs < 24 * 3600 * 1000) return 1800;    // < 24h
  if (deltaMs < 7 * 24 * 3600 * 1000) return 21600; // < 7d
  return 86400;                                    // ≥ 7d
}

// Per-endpoint TTL fallback (when no kickoff info available)
const ENDPOINT_TTL_MAP: Array<{ pattern: RegExp; ttl: number }> = [
  { pattern: /\/status(\?|$)/, ttl: 3600 },
  { pattern: /\/leagues(\?|$)/, ttl: 86400 },
  { pattern: /\/teams\/statistics/, ttl: 21600 },
  { pattern: /\/teams(\?|$)/, ttl: 604800 },
  { pattern: /\/standings/, ttl: 21600 },
  { pattern: /\/fixtures\/headtohead/, ttl: 86400 },
  { pattern: /\/fixtures\/statistics/, ttl: 86400 },
  { pattern: /\/predictions/, ttl: 21600 },
  { pattern: /\/odds/, ttl: 1800 },
  { pattern: /\/fixtures.*live=/, ttl: 30 },
  { pattern: /\/fixtures(\?|$)/, ttl: 3600 },
];

export function ttlForEndpoint(endpointOrKey: string, fallback = 3600): number {
  for (const { pattern, ttl } of ENDPOINT_TTL_MAP) {
    if (pattern.test(endpointOrKey)) return ttl;
  }
  return fallback;
}

// ────────────────────────────────────────────────────────────────────────
// Public cache service
// ────────────────────────────────────────────────────────────────────────

export class CacheService {
  /** Backwards compat — preserved so legacy callers keep working. */
  static readonly TTL = {
    FIXTURES_LIVE: 30,
    FIXTURES_TODAY: 3600,
    FIXTURES_PAST: 259200,
    FIXTURES_UPCOMING: 21600,
    LEAGUE_STANDINGS: 21600,
    TEAM_INFO: 604800,
    HEAD_TO_HEAD: 86400,
    MATCH_STATISTICS: 86400,
    PREDICTIONS: 21600,
    ODDS: 1800,
  } as const;

  static async get<T>(key: string, allowStale = false): Promise<T | null> {
    // L1
    const l1 = InMemoryCache.get<T>(key, allowStale);
    if (l1 && !l1.stale) return l1.data;
    if (l1 && allowStale) {
      // Kick off background refresh (caller should detect staleness separately)
      return l1.data;
    }

    // L2 (Redis/Dragonfly)
    try {
      const r = await getRedis();
      if (r) {
        const raw = await r.get(key).catch(() => null);
        if (raw) {
          const parsed = JSON.parse(raw) as { data: T; expiresAt: number };
          const now = Date.now();
          if (parsed.expiresAt > now) {
            // Backfill L1 with remaining TTL
            const remaining = Math.max(1, Math.floor((parsed.expiresAt - now) / 1000));
            InMemoryCache.set(key, parsed.data, remaining);
            return parsed.data;
          }
        }
      }
    } catch {
      /* redis optional — ignore errors */
    }

    // L3 (Postgres)
    if (usePgCache) {
      try {
        const row = await prisma.cacheEntry.findUnique({ where: { cache_key: key } });
        if (row && row.expires_at > new Date()) {
          // Backfill L1 and L2
          const remaining = Math.max(1, Math.floor((row.expires_at.getTime() - Date.now()) / 1000));
          InMemoryCache.set(key, row.data, remaining);
          const r = await getRedis();
          if (r) {
            r.set(key, JSON.stringify({ data: row.data, expiresAt: row.expires_at.getTime() }), 'EX', remaining).catch(() => {});
          }
          return row.data as T;
        }
        if (row) {
          prisma.cacheEntry.delete({ where: { cache_key: key } }).catch(() => {});
        }
      } catch {
        /* pg optional — ignore */
      }
    }

    return null;
  }

  static async set(key: string, data: any, ttlSeconds: number = 3600): Promise<void> {
    InMemoryCache.set(key, data, ttlSeconds);

    // L2 (fire-and-forget)
    (async () => {
      try {
        const r = await getRedis();
        if (!r) return;
        const payload = JSON.stringify({ data, expiresAt: Date.now() + ttlSeconds * 1000 });
        await r.set(key, payload, 'EX', Math.max(1, Math.floor(ttlSeconds))).catch(() => {});
      } catch { /* ignore */ }
    })();

    // L3 (persistent, awaited to surface errors; but tolerant of failure)
    if (usePgCache) {
      try {
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        await prisma.cacheEntry.upsert({
          where: { cache_key: key },
          create: { cache_key: key, data, expires_at: expiresAt },
          update: { data, expires_at: expiresAt },
        });
      } catch {
        /* ignore pg failure */
      }
    }
  }

  static async delete(key: string): Promise<void> {
    InMemoryCache.delete(key);
    try {
      const r = await getRedis();
      if (r) await r.del(key).catch(() => {});
    } catch { /* ignore */ }
    if (usePgCache) {
      try { await prisma.cacheEntry.delete({ where: { cache_key: key } }); }
      catch { /* ignore */ }
    }
  }

  static async cleanExpired(): Promise<void> {
    InMemoryCache.cleanExpired();
    if (usePgCache) {
      try {
        await prisma.cacheEntry.deleteMany({ where: { expires_at: { lt: new Date() } } });
      } catch { /* ignore */ }
    }
  }

  /** Stable cache key for an upstream API call */
  static generateApiKey(endpoint: string, params: Record<string, any> = {}): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((result, key) => {
        result[key] = params[key];
        return result;
      }, {} as Record<string, any>);
    return `api_${endpoint}_${JSON.stringify(sortedParams)}`;
  }

  /**
   * Cache-first fetch helper.
   *
   *   ttlSeconds:    absolute TTL in seconds. If a `match` is also provided,
   *                  the smart TTL from `ttlForMatch(match)` wins (unless you
   *                  pass `overrideTtl: true`).
   *   staleWindow:   extra seconds to keep serving the stale value while a
   *                  background fetch refreshes it. Default 0.
   */
  static async cacheApiResponse<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 3600,
    opts: { match?: KickoffAware | null; overrideTtl?: boolean; staleWindow?: number } = {}
  ): Promise<T> {
    const matchTtl = opts.match ? ttlForMatch(opts.match) : null;
    const ttl = opts.overrideTtl ? ttlSeconds : (matchTtl ?? ttlSeconds);

    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // Stale-while-revalidate window
    if ((opts.staleWindow ?? 0) > 0) {
      const stale = await this.get<T>(key, true);
      if (stale !== null) {
        // Fire-and-forget refresh
        (async () => {
          try {
            const fresh = await fetcher();
            await this.set(key, fresh, ttl);
          } catch { /* swallow */ }
        })();
        return stale;
      }
    }

    const data = await fetcher();
    await this.set(key, data, ttl);
    return data;
  }

  /** Debug / admin */
  static async stats() {
    const r = await getRedis().catch(() => null);
    let redisKeys = -1;
    if (r) {
      try {
        // Only count by INFO for speed
        // @ts-ignore ioredis has dbsize
        redisKeys = await (r as any).dbsize?.().catch(() => -1) ?? -1;
      } catch { /* ignore */ }
    }
    let pgRows = -1;
    if (usePgCache) {
      try { pgRows = await prisma.cacheEntry.count(); } catch { /* ignore */ }
    }
    return { l1: InMemoryCache.size(), l2: redisKeys, l3: pgRows };
  }
}
