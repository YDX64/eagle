
// In-memory cache fallback
interface CacheEntry {
  data: any;
  expires_at: Date;
}

class InMemoryCache {
  private static cache = new Map<string, CacheEntry>();

  static get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (entry.expires_at < new Date()) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  static set(key: string, data: any, expiresAt: Date): void {
    this.cache.set(key, { data, expires_at: expiresAt });
  }

  static delete(key: string): void {
    this.cache.delete(key);
  }

  static cleanExpired(): void {
    const now = new Date();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires_at < now) {
        this.cache.delete(key);
      }
    }
  }
}

// Try to import prisma, but don't fail if database is not configured
let prisma: any = null;
try {
  const dbUrl = process.env.DATABASE_URL || '';
  // Only use database if it's a valid PostgreSQL URL
  if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
    const db = require('./db');
    prisma = db.prisma;
  }
} catch (error) {
  // Silently fall back to in-memory cache
}

export class CacheService {
  private static useDatabase = !!prisma;

  /**
   * Get cached data
   */
  static async get<T>(key: string): Promise<T | null> {
    if (!this.useDatabase) {
      return InMemoryCache.get<T>(key);
    }

    try {
      const cached = await prisma.cacheEntry.findUnique({
        where: { cache_key: key }
      });

      if (!cached || cached.expires_at < new Date()) {
        // Remove expired cache entry
        if (cached) {
          await prisma.cacheEntry.delete({
            where: { cache_key: key }
          });
        }
        return null;
      }

      return cached.data as T;
    } catch (error) {
      // Fallback to in-memory cache on database error
      return InMemoryCache.get<T>(key);
    }
  }

  /**
   * Set cached data with TTL in seconds
   */
  static async set(key: string, data: any, ttlSeconds: number = 3600): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    if (!this.useDatabase) {
      InMemoryCache.set(key, data, expiresAt);
      return;
    }

    try {
      await prisma.cacheEntry.upsert({
        where: { cache_key: key },
        create: {
          cache_key: key,
          data: data,
          expires_at: expiresAt
        },
        update: {
          data: data,
          expires_at: expiresAt
        }
      });
    } catch (error) {
      // Fallback to in-memory cache on database error
      InMemoryCache.set(key, data, expiresAt);
    }
  }

  /**
   * Delete cached data
   */
  static async delete(key: string): Promise<void> {
    if (!this.useDatabase) {
      InMemoryCache.delete(key);
      return;
    }

    try {
      await prisma.cacheEntry.delete({
        where: { cache_key: key }
      }).catch(() => {
        // Ignore if key doesn't exist
      });
    } catch (error) {
      InMemoryCache.delete(key);
    }
  }

  /**
   * Clean expired cache entries
   */
  static async cleanExpired(): Promise<void> {
    if (!this.useDatabase) {
      InMemoryCache.cleanExpired();
      return;
    }

    try {
      await prisma.cacheEntry.deleteMany({
        where: {
          expires_at: {
            lt: new Date()
          }
        }
      });
    } catch (error) {
      InMemoryCache.cleanExpired();
    }
  }

  /**
   * Generate cache key for API requests
   */
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
   * Cache API responses with appropriate TTL
   */
  static async cacheApiResponse<T>(
    key: string, 
    fetcher: () => Promise<T>, 
    ttlSeconds: number = 3600
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) {
      return cached;
    }

    const data = await fetcher();
    await this.set(key, data, ttlSeconds);
    return data;
  }

  /**
   * Cache TTL constants for different data types
   */
  static readonly TTL = {
    FIXTURES_TODAY: 300, // 5 minutes - live data
    FIXTURES_PAST: 86400, // 24 hours - historical data
    LEAGUE_STANDINGS: 3600, // 1 hour
    TEAM_INFO: 86400, // 24 hours
    HEAD_TO_HEAD: 86400, // 24 hours
    MATCH_STATISTICS: 86400, // 24 hours
    PREDICTIONS: 1800, // 30 minutes
  } as const;
}
