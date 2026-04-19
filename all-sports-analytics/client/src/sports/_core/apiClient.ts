/**
 * Generic StatsVault API Client
 * Dual mode:
 * - Standalone: direct upstream call with provider key
 * - Integrated (ProBet): routes through /api/all-sports/proxy/{sport}/{endpoint}
 *   to keep the provider key server-side.
 *
 * Cache: In-memory + 5 dakika TTL default
 */

const STATSVAULT_KEY = (import.meta as any).env?.VITE_AWASTATS_API_KEY || '';

const DEFAULT_TTL = 5 * 60 * 1000;

interface ApiResponse<T> {
  get: string;
  parameters: Record<string, string>;
  errors: any;
  results: number;
  response: T;
}

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const memoryCache = new Map<string, CacheEntry>();

/**
 * Determines if we should use the proxy.
 * Set VITE_USE_PROXY=true or runs under /all-sports/* → use proxy.
 */
function shouldUseProxy(): boolean {
  if (typeof window === 'undefined') return false;
  // If path starts with /all-sports, assume we're running integrated in ProBet
  if (window.location.pathname.startsWith('/all-sports')) return true;
  // Environment variable override
  const env: any = typeof (import.meta as any).env !== 'undefined' ? (import.meta as any).env : {};
  if (env.VITE_USE_PROXY === 'true' || env.VITE_USE_PROXY === true) return true;
  return false;
}

/**
 * Map apiBase URL to sport key used in proxy path
 * e.g. https://v1.hockey.<statsvault-host> → 'hockey'
 * The regex pattern targets the upstream host's versioned subdomain format.
 */
function apiBaseToSportKey(apiBase: string): string {
  const hostRegex = /https?:\/\/v\d+\.?([^.]+)\.[\w-]+\.[\w]+/;
  const match = apiBase.match(hostRegex);
  if (!match) return 'unknown';
  const key = match[1].toLowerCase();
  // Normalize variations
  if (key === 'american-football') return 'american-football';
  if (key === 'formula-1') return 'formula-1';
  return key;
}

export class SportApiClient {
  constructor(
    private apiBase: string,
    private apiKey: string = STATSVAULT_KEY,
    private defaultTtl: number = DEFAULT_TTL
  ) {}

  private cacheKey(endpoint: string, params?: any): string {
    return `${this.apiBase}::${endpoint}::${JSON.stringify(params || {})}`;
  }

  async fetch<T>(
    endpoint: string,
    params?: Record<string, string | number>,
    ttl: number = this.defaultTtl
  ): Promise<ApiResponse<T>> {
    const key = this.cacheKey(endpoint, params);
    const cached = memoryCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }

    let url: URL;
    let headers: Record<string, string> = {};

    if (shouldUseProxy()) {
      const sportKey = apiBaseToSportKey(this.apiBase);
      // Route through ProBet proxy: /api/all-sports/proxy/{sport}/{endpoint}
      url = new URL(`${window.location.origin}/api/all-sports/proxy/${sportKey}/${endpoint}`);
    } else {
      url = new URL(`${this.apiBase}/${endpoint}`);
      headers = { 'x-apisports-key': this.apiKey };
    }

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.append(k, String(v));
        }
      });
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`API ${this.apiBase}/${endpoint} failed: ${response.status}`);
      }

      const data = await response.json();
      memoryCache.set(key, { data, timestamp: Date.now(), ttl });
      return data;
    } catch (err) {
      if (cached) {
        console.warn('API error, returning stale cache:', err);
        return cached.data;
      }
      throw err;
    }
  }

  clearCache() {
    const keys = Array.from(memoryCache.keys());
    for (const k of keys) {
      if (k.startsWith(this.apiBase)) memoryCache.delete(k);
    }
  }
}

export function clearAllCaches() {
  memoryCache.clear();
}

export function getCacheStats() {
  return {
    entries: memoryCache.size,
    approxMemoryKB: JSON.stringify(Array.from(memoryCache.entries())).length / 1024,
  };
}
