import type { TrackingFilters } from './types';

/** Strip undefined values and build a URLSearchParams from an object. */
export function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) sp.set(k, v.join(','));
      continue;
    }
    if (typeof v === 'boolean') {
      if (v) sp.set(k, 'true');
      continue;
    }
    sp.set(k, String(v));
  }
  return sp.toString();
}

/**
 * Fetch a JSON endpoint and transparently unwrap `{ success, data }` envelopes
 * used by the `/api/tracking/*` routes. Also surfaces `error` from the body
 * when the HTTP request fails.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as unknown;
  // Unwrap { success, data, ... } envelope if present.
  if (
    body &&
    typeof body === 'object' &&
    'success' in body &&
    'data' in body
  ) {
    const env = body as { success: boolean; data: T; error?: string };
    if (!env.success) {
      throw new Error(env.error ?? 'Bilinmeyen hata');
    }
    return env.data;
  }
  return body as T;
}

/** Same as fetchJson but also returns the envelope metadata (pagination etc). */
export async function fetchJsonEnvelope<T, M = Record<string, unknown>>(
  url: string
): Promise<{ data: T; meta: M }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as Record<string, unknown>;
  if (body?.success === false) {
    throw new Error(String(body.error ?? 'Bilinmeyen hata'));
  }
  const { success: _success, data, ...meta } = body;
  return { data: data as T, meta: meta as M };
}

/** Common filter slice forwarded to most tracking endpoints. */
export function baseFilterParams(filters: Partial<TrackingFilters>) {
  return {
    sports: filters.sports,
    date_from: filters.date_from,
    date_to: filters.date_to,
    family: filters.family,
    market: filters.market,
    min_sample: filters.min_sample,
    min_probability: filters.min_probability,
    min_expected_value: filters.min_expected_value,
    only_high_confidence: filters.only_high_confidence,
  };
}
