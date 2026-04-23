/**
 * Shared helpers for the NHL + MLB player-stats importers.
 *
 * - `jitteredFetch`: serialised fetch with a 200 ms gap between requests and
 *   exponential back-off on 429/5xx. Uses a module-level Promise chain so two
 *   call-sites can't accidentally hammer the same upstream at the same time.
 * - `resolveTeamAlias`: looks up an api-sports team id in `sport_team_aliases`
 *   and, if missing, fuzzy-matches by name against a caller-supplied list of
 *   canonical teams then writes the row so subsequent lookups are free.
 *
 * Everything writes through `trackingPrisma` (PostgreSQL) — the SQLite legacy
 * store is never touched.
 */

import { trackingPrisma } from '@/lib/db';

// ---------------------------------------------------------------------------
// jittered fetch
// ---------------------------------------------------------------------------

const THROTTLE_MS = 200;
const MAX_RETRIES = 4;
// Start of back-off in ms (doubles each retry).
const BASE_BACKOFF_MS = 500;

let _lastRequestAt = 0;
let _serialise: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` strictly after the previous jitteredFetch has released its slot
 * and at least THROTTLE_MS have elapsed since the most recent request.
 */
async function runSerialised<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _serialise;
  let resolveNext: () => void = () => {};
  _serialise = new Promise<void>(res => {
    resolveNext = res;
  });
  try {
    await prev.catch(() => undefined);
    const elapsed = Date.now() - _lastRequestAt;
    if (elapsed < THROTTLE_MS) {
      await sleep(THROTTLE_MS - elapsed);
    }
    const result = await fn();
    _lastRequestAt = Date.now();
    return result;
  } finally {
    resolveNext();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, Math.max(0, ms)));
}

export interface JitteredFetchOptions extends RequestInit {
  /**
   * Override the max retries for this particular call.
   */
  maxRetries?: number;
  /**
   * Swallow non-OK responses (other than the handled 429/5xx) and return
   * `null`. Useful when you expect 404s to be normal (e.g. missing boxscore).
   */
  allow404?: boolean;
}

/**
 * Fetch JSON from a URL with:
 *   - 200 ms minimum gap between requests (cross-call-site)
 *   - exponential back-off on 429 / 5xx (with `Retry-After` if given)
 *   - configurable retry limit (default 4)
 *   - optional 404-tolerance (returns null)
 *
 * Throws on any permanent failure (non-429/5xx 4xx) or after retries are
 * exhausted.
 */
export async function jitteredFetch<T = unknown>(
  url: string,
  options: JitteredFetchOptions = {},
): Promise<T | null> {
  const { maxRetries = MAX_RETRIES, allow404 = false, ...init } = options;
  return runSerialised(async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: {
            accept: 'application/json',
            'user-agent':
              'probet-importer/1.0 (+https://pro.awastats.com)',
            ...(init.headers ?? {}),
          },
          redirect: init.redirect ?? 'follow',
        });
      } catch (err) {
        // Network error — treat like a 5xx and retry.
        if (attempt >= maxRetries) {
          throw new Error(
            `jitteredFetch network failure (${url}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await backoff(attempt);
        attempt += 1;
        continue;
      }

      if (response.ok) {
        // 204 No Content — nothing to parse.
        if (response.status === 204) return null;
        try {
          return (await response.json()) as T;
        } catch (err) {
          throw new Error(
            `jitteredFetch JSON parse failure (${url}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (response.status === 404 && allow404) {
        return null;
      }

      const retryable =
        response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!retryable || attempt >= maxRetries) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `jitteredFetch failed ${response.status} ${response.statusText} for ${url}: ${body.slice(0, 200)}`,
        );
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await sleep(retryAfter * 1000);
      } else {
        await backoff(attempt);
      }
      attempt += 1;
    }
  });
}

async function backoff(attempt: number): Promise<void> {
  const ms = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
  await sleep(ms);
}

// ---------------------------------------------------------------------------
// Team alias resolver
// ---------------------------------------------------------------------------

/**
 * A canonical team we know about (NHL or MLB). The alias resolver needs this
 * catalogue to compare names when deciding which canonical team an api-sports
 * row refers to.
 */
export interface CanonicalTeam {
  team_id: number;
  name: string;
  abbr?: string | null;
  /** Extra names we should treat as synonyms (city, market, etc.). */
  aliases?: string[];
}

export interface ResolvedTeamAlias {
  sport: 'hockey' | 'baseball';
  apisports_team_id: number;
  canonical_source: string;
  canonical_team_id: number;
  canonical_name: string | null;
  canonical_abbr: string | null;
  confidence: number;
  created_at: Date;
}

/**
 * Resolve an api-sports team to its canonical league counterpart.
 *
 * Behaviour:
 *   1. If `sport_team_aliases` already has a row, return it.
 *   2. Otherwise fuzzy-match the api-sports name against the supplied
 *      `candidates` list using token-overlap scoring. Highest scorer above
 *      the threshold wins and is persisted as a new alias row (idempotent —
 *      duplicate inserts collapse via the unique index).
 *   3. If no candidate clears the threshold, `null` is returned and no row
 *      is written. The caller can still run business logic on the api-sports
 *      team id; downstream lookups just won't find player rows.
 */
export async function resolveTeamAlias(
  sport: 'hockey' | 'baseball',
  apisports_team_id: number,
  apisports_name: string | null,
  canonical_source: string,
  candidates: CanonicalTeam[],
): Promise<ResolvedTeamAlias | null> {
  if (!trackingPrisma) return null;

  // 1) Cache lookup.
  const existing = await trackingPrisma.sport_team_aliases
    .findUnique({
      where: {
        sport_apisports_team_id: {
          sport,
          apisports_team_id,
        },
      },
    })
    .catch(() => null);
  if (existing) {
    return {
      sport: existing.sport as 'hockey' | 'baseball',
      apisports_team_id: existing.apisports_team_id,
      canonical_source: existing.canonical_source,
      canonical_team_id: existing.canonical_team_id,
      canonical_name: existing.canonical_name,
      canonical_abbr: existing.canonical_abbr,
      confidence: existing.confidence,
      created_at: existing.created_at,
    };
  }

  if (!apisports_name || candidates.length === 0) return null;

  // 2) Fuzzy match.
  const match = fuzzyMatchTeam(apisports_name, candidates);
  if (!match) return null;

  // 3) Persist — swallow conflicts because two parallel resolves may collide.
  try {
    await trackingPrisma.sport_team_aliases.create({
      data: {
        sport,
        apisports_team_id,
        apisports_name,
        canonical_source,
        canonical_team_id: match.team.team_id,
        canonical_name: match.team.name,
        canonical_abbr: match.team.abbr ?? null,
        confidence: match.score,
      },
    });
  } catch {
    // Probably a race — ignore and re-read below.
  }

  const row = await trackingPrisma.sport_team_aliases
    .findUnique({
      where: {
        sport_apisports_team_id: {
          sport,
          apisports_team_id,
        },
      },
    })
    .catch(() => null);
  if (!row) return null;
  return {
    sport: row.sport as 'hockey' | 'baseball',
    apisports_team_id: row.apisports_team_id,
    canonical_source: row.canonical_source,
    canonical_team_id: row.canonical_team_id,
    canonical_name: row.canonical_name,
    canonical_abbr: row.canonical_abbr,
    confidence: row.confidence,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Normalise a team name for comparison: strip common affixes, punctuation,
 * diacritics, collapse whitespace.
 */
export function normaliseTeamName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(fc|sc|club|athletic|baseball|hockey|team|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface MatchResult {
  team: CanonicalTeam;
  score: number;
}

/**
 * Compare `apisportsName` against every canonical candidate and return the
 * best-scoring one (score ≥ 0.5). Score is token overlap / max(tokens).
 */
export function fuzzyMatchTeam(
  apisportsName: string,
  candidates: CanonicalTeam[],
): MatchResult | null {
  const a = tokenise(apisportsName);
  if (a.length === 0) return null;

  let best: MatchResult | null = null;
  for (const c of candidates) {
    const names = [c.name, ...(c.aliases ?? [])];
    for (const n of names) {
      const b = tokenise(n);
      if (b.length === 0) continue;
      const overlap = countOverlap(a, b);
      const score = overlap / Math.max(a.length, b.length);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { team: c, score: Math.min(1, score) };
      }
      if (score === 1) return { team: c, score: 1 }; // perfect hit short-circuit
    }
  }
  return best;
}

function tokenise(s: string): string[] {
  const norm = normaliseTeamName(s);
  return norm.length === 0 ? [] : norm.split(' ').filter(t => t.length > 1);
}

function countOverlap(a: string[], b: string[]): number {
  const set = new Set(b);
  let hits = 0;
  for (const t of a) if (set.has(t)) hits += 1;
  return hits;
}

// ---------------------------------------------------------------------------
// Re-exports / misc helpers
// ---------------------------------------------------------------------------

/** Clamp + default helper. */
export function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Null-safe numeric conversion returning `null` when the value is non-finite. */
export function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Round to 4 decimals to avoid ugly 1.2999999999 runoff in persisted rates. */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
