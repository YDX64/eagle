/**
 * Token-bucket rate limiter for API-Football.
 *
 * API-Football Mega plan: 900 requests/minute (15 r/s).
 * We use a leaky-bucket / token-bucket hybrid that:
 *   - Refills tokens continuously (smooth rate, not bursty)
 *   - Allows short bursts up to the bucket size
 *   - Queues callers when the bucket is empty (no errors thrown)
 *
 * This lets us run 25-league × 2-season parallel fetches (50 calls) in
 * a few seconds without hitting the rate limit, while a 1000-match
 * backtest with 4 extras per match (4000 calls) finishes in ~5 minutes.
 */

interface RateLimiterConfig {
  /** Maximum requests per minute. Mega plan = 900 */
  requestsPerMinute: number;
  /** Maximum bucket size. Defaults to 1/6 of per-minute quota (~10s burst) */
  burstSize?: number;
}

class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRatePerMs: number; // tokens per millisecond
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];

  constructor(config: RateLimiterConfig) {
    this.capacity = config.burstSize ?? Math.max(20, Math.floor(config.requestsPerMinute / 6));
    this.refillRatePerMs = config.requestsPerMinute / 60_000;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
      this.lastRefill = now;
    }
  }

  /**
   * Wait for one token. Returns once it's safe to make a request.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Compute how long until next token is available
    const tokensNeeded = 1 - this.tokens;
    const waitMs = Math.ceil(tokensNeeded / this.refillRatePerMs);

    return new Promise((resolve) => {
      setTimeout(() => {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve();
        } else {
          // Recursive retry (very rare)
          this.acquire().then(resolve);
        }
      }, waitMs);
    });
  }

  /** Get current snapshot for monitoring */
  getStats(): { available: number; capacity: number } {
    this.refill();
    return { available: Math.floor(this.tokens), capacity: this.capacity };
  }

  /** Update rate (e.g., when plan changes) */
  setRate(requestsPerMinute: number): void {
    (this as any).refillRatePerMs = requestsPerMinute / 60_000;
  }
}

/**
 * Global rate limiter for API-Football. Mega plan = 900 r/m.
 * Set via env var for flexibility:
 *   API_FOOTBALL_RATE_LIMIT = "900"
 */
const RATE_LIMIT = parseInt(process.env.API_FOOTBALL_RATE_LIMIT || '900', 10);

export const apiFootballLimiter = new TokenBucket({
  requestsPerMinute: RATE_LIMIT,
  burstSize: Math.max(30, Math.floor(RATE_LIMIT / 6)),
});

/**
 * Wrap any async function with rate limiting.
 * Each call acquires a token before executing.
 */
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  await apiFootballLimiter.acquire();
  return fn();
}
