/**
 * StatsVault Provider
 *
 * Harici istatistik ve tahmin sağlayıcısının ensemble'a 3. kaynak olarak
 * beslenmesi için alias'lı wrapper. İsim "StatsVault" olarak sabitlenmiştir;
 * kod tabanında sağlayıcının gerçek adı asla geçmez.
 *
 * Provider endpoint'leri (futbol için predictions, diğer sporlar için
 * odds + team statistics) aynı SportApiClient üzerinden çağrılır.
 *
 * Önemli: Bu modül YALNIZCA yüksek güvenilirlikli tahminleri ensemble'a
 * taşır (confidence >= minConfidence, default 0.70). Altındakiler
 * doğrudan filtrelenir.
 */

import { SportApiClient } from './apiClient';
import type { SportId, NormalizedOdds } from './types';

// ===== PROVIDER TAHMIN TIPI =====
export interface StatsVaultPrediction {
  provider: 'statsvault';
  sport: SportId;
  gameId: number;
  fetchedAt: number;

  // Kazanan & Beraberlik
  winner: { id: number | null; name: string | null; } | null;
  winOrDraw: boolean | null;

  // Alt/Üst
  underOver: string | null;       // örn "-2.5", "+3.5"
  goals: { home: string | null; away: string | null };

  // Olasılık yüzdeleri (0-1 arası normalize)
  percent: {
    home: number | null;
    draw: number | null;
    away: number | null;
  };

  // Serbest metin tavsiye
  advice: string | null;

  // Türetilmiş: Max yüzde
  confidence: number;             // 0-1, percent içindeki maksimum
  highConfidence: boolean;        // confidence >= minConfidence

  // Karşılaştırma puanları (varsa)
  comparison?: {
    form?: { home: number; away: number };
    att?: { home: number; away: number };
    def?: { home: number; away: number };
    h2h?: { home: number; away: number };
    goals?: { home: number; away: number };
    total?: { home: number; away: number };
  };
}

// ===== KONFIGURASYON =====
export interface StatsVaultConfig {
  minConfidence: number;          // Default 0.70
  cacheTtlMs: number;             // Default 5 min
}

export const DEFAULT_STATSVAULT_CONFIG: StatsVaultConfig = {
  minConfidence: 0.70,
  cacheTtlMs: 5 * 60 * 1000,
};

// ===== YARDIMCILAR =====
function parsePercent(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace('%', '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(1, n / 100));
}

function maxPercent(p: StatsVaultPrediction['percent']): number {
  const vals = [p.home, p.draw, p.away].filter((v): v is number => v !== null);
  if (vals.length === 0) return 0;
  return Math.max(...vals);
}

// ===== ANA FETCH FONKSIYONU =====
/**
 * Provider'ın predictions endpoint'ini çağırır (sadece desteklenen sporlarda).
 * Return null: endpoint yok, veri yok ya da confidence eşiğin altında.
 *
 * Desteklenen sporlar (provider tarafında predictions endpoint'i olan):
 *  - football
 *  - basketball (bazı ligler)
 *  - rugby (kısıtlı)
 *
 * Diğer sporlar için null döner; ensemble 2-kaynaklı devam eder.
 */
export async function fetchStatsVaultPrediction(params: {
  client: SportApiClient;
  sport: SportId;
  gameId: number;
  config?: Partial<StatsVaultConfig>;
}): Promise<StatsVaultPrediction | null> {
  const cfg: StatsVaultConfig = { ...DEFAULT_STATSVAULT_CONFIG, ...params.config };

  // Provider yalnız şu sporlar için predictions endpoint'i yayınlıyor
  const SUPPORTED = new Set<SportId>(['football', 'basketball', 'rugby']);
  if (!SUPPORTED.has(params.sport)) return null;

  try {
    const resp = await params.client.fetch<any[]>(
      'predictions',
      { fixture: params.gameId },
      cfg.cacheTtlMs
    );

    const first = Array.isArray(resp.response) ? resp.response[0] : null;
    if (!first || !first.predictions) return null;

    const pred = first.predictions;
    const percent = {
      home: parsePercent(pred.percent?.home),
      draw: parsePercent(pred.percent?.draw),
      away: parsePercent(pred.percent?.away),
    };

    const confidence = maxPercent(percent);
    const highConfidence = confidence >= cfg.minConfidence;

    const result: StatsVaultPrediction = {
      provider: 'statsvault',
      sport: params.sport,
      gameId: params.gameId,
      fetchedAt: Date.now(),
      winner: pred.winner
        ? { id: pred.winner.id ?? null, name: pred.winner.name ?? null }
        : null,
      winOrDraw: typeof pred.win_or_draw === 'boolean' ? pred.win_or_draw : null,
      underOver: pred.under_over ?? null,
      goals: {
        home: pred.goals?.home ?? null,
        away: pred.goals?.away ?? null,
      },
      percent,
      advice: pred.advice ?? null,
      confidence,
      highConfidence,
      comparison: first.comparison ?? undefined,
    };

    return result;
  } catch (err) {
    console.warn('[statsvault] prediction fetch failed:', err);
    return null;
  }
}

/**
 * Provider'ın odds endpoint'ini NormalizedOdds formatında döner.
 * Ensemble'ın market-anchored kaynağı için kullanılır.
 */
export async function fetchStatsVaultOdds(params: {
  client: SportApiClient;
  sport: SportId;
  gameId: number;
  cacheTtlMs?: number;
}): Promise<NormalizedOdds | null> {
  try {
    const endpoint = params.sport === 'football' ? 'odds' : 'odds';
    const paramKey = params.sport === 'football' ? 'fixture' : 'game';
    const resp = await params.client.fetch<any[]>(
      endpoint,
      { [paramKey]: params.gameId } as Record<string, string | number>,
      params.cacheTtlMs ?? DEFAULT_STATSVAULT_CONFIG.cacheTtlMs
    );
    const first = Array.isArray(resp.response) ? resp.response[0] : null;
    if (!first) return null;

    return {
      gameId: params.gameId,
      bookmakers: (first.bookmakers || []).map((bm: any) => ({
        id: bm.id,
        name: bm.name,
        bets: (bm.bets || []).map((bet: any) => ({
          id: bet.id,
          name: bet.name,
          values: (bet.values || []).map((v: any) => ({
            value: String(v.value),
            odd: parseFloat(v.odd),
          })),
        })),
      })),
    };
  } catch (err) {
    console.warn('[statsvault] odds fetch failed:', err);
    return null;
  }
}

/**
 * Takım istatistikleri (gol ortalaması, form dizesi vs).
 * Bu spor-özel bir yapıdadır; ham şekilde döndürülür, adapter kendi
 * normalize'ını yapar.
 */
export async function fetchStatsVaultTeamStatistics(params: {
  client: SportApiClient;
  teamId: number;
  leagueId: number;
  season: number;
  cacheTtlMs?: number;
}): Promise<any | null> {
  try {
    const resp = await params.client.fetch<any>(
      'teams/statistics',
      { team: params.teamId, league: params.leagueId, season: params.season },
      params.cacheTtlMs ?? 60 * 60 * 1000 // 1h default for stats
    );
    return resp.response ?? null;
  } catch (err) {
    console.warn('[statsvault] team stats fetch failed:', err);
    return null;
  }
}

/**
 * StatsVault tahminini ensemble için ProbabilitySet formatına çevirir.
 * {home, draw, away} 1X2 için.
 */
export function statsVaultToProbabilitySet(p: StatsVaultPrediction | null): {
  home: number;
  draw: number;
  away: number;
} | null {
  if (!p) return null;
  const { home, draw, away } = p.percent;
  if (home === null || away === null) return null;
  const d = draw ?? 0;

  // Normalize: toplam 1 olmalı
  const sum = home + d + away;
  if (sum <= 0) return null;

  return {
    home: home / sum,
    draw: d / sum,
    away: away / sum,
  };
}
