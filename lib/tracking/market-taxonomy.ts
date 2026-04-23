/**
 * Market taxonomy — unified naming, localization and settlement rules.
 *
 * One row per (sport, market_code). Seeded into `market_taxonomy` on demand.
 * Settlement rules use a minimal DSL evaluated by `market-settler.ts`.
 *
 * DSL primitives (evaluated against the settlement context):
 *   HOME, AWAY, HOME_HT, AWAY_HT, HOME_ET, AWAY_ET, HOME_PEN, AWAY_PEN
 *   HOME_Q1..Q4, AWAY_Q1..Q4  (basketball)
 *   HOME_P1..P3, AWAY_P1..P3  (hockey)
 *   HOME_S1..S5, AWAY_S1..S5  (volleyball)
 *   HOME_H1, HOME_H2, AWAY_H1, AWAY_H2  (handball halves)
 *   LINE  — numeric parameter parsed from market suffix (e.g. UNDER_25 → 2.5)
 *   VOID  — sentinel for push/void outcomes (e.g. stake = line exactly)
 *
 * Rules return true (hit), false (miss), or 'void'.
 */

import { trackingPrisma as prisma } from '@/lib/db';
import type { MarketCategory, MarketFamily, SportCode } from './types';

export interface MarketDef {
  market_code: string;
  sport: SportCode | 'all';
  family: MarketFamily;
  category: MarketCategory;
  display_name_tr: string;
  display_name_en: string;
  description?: string;
  /** Lazy-evaluated settlement function; returns true / false / 'void'. */
  settle: (ctx: SettleContext) => boolean | 'void';
  requires_line?: boolean;
}

export interface SettleContext {
  home: number;
  away: number;
  home_ht?: number | null;
  away_ht?: number | null;
  home_et?: number | null;
  away_et?: number | null;
  home_pen?: number | null;
  away_pen?: number | null;
  // Period/quarter/set breakdowns (nullable for sports that don't have them)
  periods?: Array<{ home: number | null; away: number | null }>;
  sets?: Array<{ home: number | null; away: number | null }>;
  // Numeric line parsed from the market suffix (e.g. UNDER_25 -> 2.5)
  line?: number;
  // Misc event counts (cards, corners) for football specials
  corners_home?: number | null;
  corners_away?: number | null;
  cards_home?: number | null;
  cards_away?: number | null;
}

function parseLineFromCode(code: string): number | undefined {
  // Examples: UNDER_25 -> 2.5 ; OVER_105 -> 10.5 ; AH_HOME_PLUS_1 -> 1
  const numericParts = code.split('_').filter(p => /^[+-]?\d+$/.test(p));
  if (numericParts.length === 0) return undefined;
  const last = numericParts[numericParts.length - 1];
  const raw = parseInt(last, 10);
  // Heuristic: 2-digit numbers are a whole+half (e.g. 25 -> 2.5, 105 -> 10.5)
  // UNLESS they're clearly integer handicaps (PLUS_1, MINUS_3).
  if (code.includes('PLUS_') || code.includes('MINUS_') || code.endsWith('_0')) {
    return raw;
  }
  if (Math.abs(raw) >= 10) return raw / 10;
  return raw / 10;
}

// ============================================================================
// FOOTBALL markets (matches the legacy probet codes seen in production DB)
// ============================================================================

const FOOTBALL_MARKETS: MarketDef[] = [
  // Match winner
  {
    market_code: 'HOME_WIN',
    sport: 'football',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Ev Sahibi Kazanır',
    display_name_en: 'Home Win',
    settle: c => c.home > c.away,
  },
  {
    market_code: 'AWAY_WIN',
    sport: 'football',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Deplasman Kazanır',
    display_name_en: 'Away Win',
    settle: c => c.away > c.home,
  },
  {
    market_code: 'DRAW',
    sport: 'football',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Beraberlik',
    display_name_en: 'Draw',
    settle: c => c.home === c.away,
  },
  // Double chance
  {
    market_code: 'DC_1X',
    sport: 'football',
    family: 'double_chance',
    category: 'main',
    display_name_tr: 'Ev Sahibi veya Beraberlik',
    display_name_en: 'Home or Draw',
    settle: c => c.home >= c.away,
  },
  {
    market_code: 'DC_X2',
    sport: 'football',
    family: 'double_chance',
    category: 'main',
    display_name_tr: 'Beraberlik veya Deplasman',
    display_name_en: 'Draw or Away',
    settle: c => c.away >= c.home,
  },
  {
    market_code: 'DC_12',
    sport: 'football',
    family: 'double_chance',
    category: 'main',
    display_name_tr: 'Ev Sahibi veya Deplasman',
    display_name_en: 'Home or Away',
    settle: c => c.home !== c.away,
  },
  // Draw no bet
  {
    market_code: 'DNB_HOME',
    sport: 'football',
    family: 'draw_no_bet',
    category: 'main',
    display_name_tr: 'Beraberlikte İade - Ev',
    display_name_en: 'Draw No Bet - Home',
    settle: c => (c.home === c.away ? 'void' : c.home > c.away),
  },
  {
    market_code: 'DNB_AWAY',
    sport: 'football',
    family: 'draw_no_bet',
    category: 'main',
    display_name_tr: 'Beraberlikte İade - Deplasman',
    display_name_en: 'Draw No Bet - Away',
    settle: c => (c.home === c.away ? 'void' : c.away > c.home),
  },
  // Both teams to score
  {
    market_code: 'BTTS_YES',
    sport: 'football',
    family: 'btts',
    category: 'main',
    display_name_tr: 'Karşılıklı Gol Var',
    display_name_en: 'Both Teams Score',
    settle: c => c.home > 0 && c.away > 0,
  },
  {
    market_code: 'BTTS_NO',
    sport: 'football',
    family: 'btts',
    category: 'main',
    display_name_tr: 'Karşılıklı Gol Yok',
    display_name_en: 'Both Teams Don\'t Score',
    settle: c => c.home === 0 || c.away === 0,
  },
  // Half-time winners
  {
    market_code: 'HT_HOME_WIN',
    sport: 'football',
    family: 'first_half',
    category: 'side',
    display_name_tr: 'İY Ev Sahibi Kazanır',
    display_name_en: 'HT Home Win',
    settle: c => (c.home_ht ?? 0) > (c.away_ht ?? 0),
  },
  {
    market_code: 'HT_AWAY_WIN',
    sport: 'football',
    family: 'first_half',
    category: 'side',
    display_name_tr: 'İY Deplasman Kazanır',
    display_name_en: 'HT Away Win',
    settle: c => (c.away_ht ?? 0) > (c.home_ht ?? 0),
  },
  {
    market_code: 'HT_DRAW',
    sport: 'football',
    family: 'first_half',
    category: 'side',
    display_name_tr: 'İY Beraberlik',
    display_name_en: 'HT Draw',
    settle: c => (c.home_ht ?? 0) === (c.away_ht ?? 0),
  },
];

// Programmatically generate over/under bands (consistent with production picks)
for (const line of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
  const code = Math.round(line * 10).toString();
  FOOTBALL_MARKETS.push(
    {
      market_code: `OVER_${code}`,
      sport: 'football',
      family: 'totals',
      category: 'main',
      display_name_tr: `${line} Üst (toplam > ${line})`,
      display_name_en: `Over ${line} Goals`,
      settle: c => c.home + c.away > line,
      requires_line: true,
    },
    {
      market_code: `UNDER_${code}`,
      sport: 'football',
      family: 'totals',
      category: 'main',
      display_name_tr: `${line} Alt (toplam ≤ ${line})`,
      display_name_en: `Under ${line} Goals`,
      settle: c => c.home + c.away < line,
      requires_line: true,
    },
    {
      market_code: `HOME_OVER_${code}`,
      sport: 'football',
      family: 'team_totals',
      category: 'side',
      display_name_tr: `Ev Sahibi ${line} Üst`,
      display_name_en: `Home Over ${line}`,
      settle: c => c.home > line,
      requires_line: true,
    },
    {
      market_code: `HOME_UNDER_${code}`,
      sport: 'football',
      family: 'team_totals',
      category: 'side',
      display_name_tr: `Ev Sahibi ${line} Alt`,
      display_name_en: `Home Under ${line}`,
      settle: c => c.home < line,
      requires_line: true,
    },
    {
      market_code: `AWAY_OVER_${code}`,
      sport: 'football',
      family: 'team_totals',
      category: 'side',
      display_name_tr: `Deplasman ${line} Üst`,
      display_name_en: `Away Over ${line}`,
      settle: c => c.away > line,
      requires_line: true,
    },
    {
      market_code: `AWAY_UNDER_${code}`,
      sport: 'football',
      family: 'team_totals',
      category: 'side',
      display_name_tr: `Deplasman ${line} Alt`,
      display_name_en: `Away Under ${line}`,
      settle: c => c.away < line,
      requires_line: true,
    },
    {
      market_code: `HT_OVER_${code}`,
      sport: 'football',
      family: 'first_half',
      category: 'side',
      display_name_tr: `İY ${line} Üst`,
      display_name_en: `HT Over ${line}`,
      settle: c => (c.home_ht ?? 0) + (c.away_ht ?? 0) > line,
      requires_line: true,
    },
    {
      market_code: `HT_UNDER_${code}`,
      sport: 'football',
      family: 'first_half',
      category: 'side',
      display_name_tr: `İY ${line} Alt`,
      display_name_en: `HT Under ${line}`,
      settle: c => (c.home_ht ?? 0) + (c.away_ht ?? 0) < line,
      requires_line: true,
    },
  );
}

// Asian handicap (integer & half-point lines, typical range -3 to +3)
for (const h of [0.5, 1, 1.5, 2, 2.5]) {
  const plus = Math.round(h * 10).toString();
  FOOTBALL_MARKETS.push(
    {
      market_code: `AH_HOME_PLUS_${plus}`,
      sport: 'football',
      family: 'handicap',
      category: 'side',
      display_name_tr: `Ev Sahibi +${h} Handikap`,
      display_name_en: `Home +${h} AH`,
      requires_line: true,
      settle: c => c.home + h > c.away,
    },
    {
      market_code: `AH_HOME_MINUS_${plus}`,
      sport: 'football',
      family: 'handicap',
      category: 'side',
      display_name_tr: `Ev Sahibi -${h} Handikap`,
      display_name_en: `Home -${h} AH`,
      requires_line: true,
      settle: c => c.home - h > c.away,
    },
    {
      market_code: `AH_AWAY_PLUS_${plus}`,
      sport: 'football',
      family: 'handicap',
      category: 'side',
      display_name_tr: `Deplasman +${h} Handikap`,
      display_name_en: `Away +${h} AH`,
      requires_line: true,
      settle: c => c.away + h > c.home,
    },
    {
      market_code: `AH_AWAY_MINUS_${plus}`,
      sport: 'football',
      family: 'handicap',
      category: 'side',
      display_name_tr: `Deplasman -${h} Handikap`,
      display_name_en: `Away -${h} AH`,
      requires_line: true,
      settle: c => c.away - h > c.home,
    },
  );
}

// Cards (over/under totals)
for (const line of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
  const code = Math.round(line * 10).toString();
  FOOTBALL_MARKETS.push(
    {
      market_code: `CARDS_OVER_${code}`,
      sport: 'football',
      family: 'cards',
      category: 'special',
      display_name_tr: `${line} Üst Kart`,
      display_name_en: `Over ${line} Cards`,
      requires_line: true,
      settle: c => (c.cards_home ?? 0) + (c.cards_away ?? 0) > line,
    },
    {
      market_code: `CARDS_UNDER_${code}`,
      sport: 'football',
      family: 'cards',
      category: 'special',
      display_name_tr: `${line} Alt Kart`,
      display_name_en: `Under ${line} Cards`,
      requires_line: true,
      settle: c => (c.cards_home ?? 0) + (c.cards_away ?? 0) < line,
    },
  );
}

// Corners (over/under totals)
for (const line of [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5]) {
  const code = Math.round(line * 10).toString();
  FOOTBALL_MARKETS.push(
    {
      market_code: `CORNERS_OVER_${code}`,
      sport: 'football',
      family: 'corners',
      category: 'special',
      display_name_tr: `${line} Üst Korner`,
      display_name_en: `Over ${line} Corners`,
      requires_line: true,
      settle: c => (c.corners_home ?? 0) + (c.corners_away ?? 0) > line,
    },
    {
      market_code: `CORNERS_UNDER_${code}`,
      sport: 'football',
      family: 'corners',
      category: 'special',
      display_name_tr: `${line} Alt Korner`,
      display_name_en: `Under ${line} Corners`,
      requires_line: true,
      settle: c => (c.corners_home ?? 0) + (c.corners_away ?? 0) < line,
    },
  );
}

// HT/FT (half-time / full-time combo)
const HT_FT_COMBOS: Array<[string, 'H' | 'D' | 'A', 'H' | 'D' | 'A']> = [
  ['HH', 'H', 'H'], ['HD', 'H', 'D'], ['HA', 'H', 'A'],
  ['DH', 'D', 'H'], ['DD', 'D', 'D'], ['DA', 'D', 'A'],
  ['AH', 'A', 'H'], ['AD', 'A', 'D'], ['AA', 'A', 'A'],
];
function resolveHalf(h: number | null | undefined, a: number | null | undefined): 'H' | 'D' | 'A' {
  const hh = h ?? 0, aa = a ?? 0;
  if (hh > aa) return 'H';
  if (hh < aa) return 'A';
  return 'D';
}
for (const [code, ht, ft] of HT_FT_COMBOS) {
  FOOTBALL_MARKETS.push({
    market_code: `HTFT_${code}`,
    sport: 'football',
    family: 'ht_ft',
    category: 'side',
    display_name_tr: `İY/MS ${code}`,
    display_name_en: `HT/FT ${code}`,
    settle: c => resolveHalf(c.home_ht, c.away_ht) === ht && resolveHalf(c.home, c.away) === ft,
  });
}

// ============================================================================
// BASKETBALL (includes NBA, international leagues)
// ============================================================================

const BASKETBALL_MARKETS: MarketDef[] = [
  {
    market_code: 'BB_HOME_WIN',
    sport: 'basketball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Ev Sahibi Kazanır (Basketbol)',
    display_name_en: 'Home Moneyline',
    settle: c => c.home > c.away,
  },
  {
    market_code: 'BB_AWAY_WIN',
    sport: 'basketball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Deplasman Kazanır (Basketbol)',
    display_name_en: 'Away Moneyline',
    settle: c => c.away > c.home,
  },
];

// Basketball totals (typical NBA lines 190-240, FIBA 140-180)
for (const line of [150.5, 160.5, 170.5, 180.5, 190.5, 200.5, 210.5, 220.5, 230.5]) {
  const code = Math.round(line * 10).toString();
  BASKETBALL_MARKETS.push(
    {
      market_code: `BB_OVER_${code}`,
      sport: 'basketball',
      family: 'totals',
      category: 'main',
      display_name_tr: `Basketbol ${line} Üst`,
      display_name_en: `Basketball Over ${line}`,
      requires_line: true,
      settle: c => c.home + c.away > line,
    },
    {
      market_code: `BB_UNDER_${code}`,
      sport: 'basketball',
      family: 'totals',
      category: 'main',
      display_name_tr: `Basketbol ${line} Alt`,
      display_name_en: `Basketball Under ${line}`,
      requires_line: true,
      settle: c => c.home + c.away < line,
    },
  );
}

// Basketball point spread
for (const h of [1.5, 2.5, 3.5, 4.5, 5.5, 7.5, 10.5]) {
  const s = Math.round(h * 10).toString();
  BASKETBALL_MARKETS.push(
    {
      market_code: `BB_SPREAD_HOME_MINUS_${s}`,
      sport: 'basketball',
      family: 'handicap',
      category: 'main',
      display_name_tr: `Basketbol Ev Sahibi -${h}`,
      display_name_en: `Basketball Home -${h}`,
      requires_line: true,
      settle: c => c.home - h > c.away,
    },
    {
      market_code: `BB_SPREAD_AWAY_PLUS_${s}`,
      sport: 'basketball',
      family: 'handicap',
      category: 'main',
      display_name_tr: `Basketbol Deplasman +${h}`,
      display_name_en: `Basketball Away +${h}`,
      requires_line: true,
      settle: c => c.away + h > c.home,
    },
  );
}

// ============================================================================
// HOCKEY
// ============================================================================

const HOCKEY_MARKETS: MarketDef[] = [
  {
    market_code: 'HO_HOME_WIN_REG',
    sport: 'hockey',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hokey Normal Süre - Ev',
    display_name_en: 'Hockey Regulation - Home',
    settle: c => {
      // Use period sum if available, otherwise fallback to FT - OT
      const periods = c.periods;
      if (periods && periods.length >= 3) {
        const hReg = periods.slice(0, 3).reduce((s, p) => s + (p.home ?? 0), 0);
        const aReg = periods.slice(0, 3).reduce((s, p) => s + (p.away ?? 0), 0);
        return hReg > aReg ? true : hReg < aReg ? false : 'void';
      }
      return c.home > c.away;
    },
  },
  {
    market_code: 'HO_AWAY_WIN_REG',
    sport: 'hockey',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hokey Normal Süre - Deplasman',
    display_name_en: 'Hockey Regulation - Away',
    settle: c => {
      const periods = c.periods;
      if (periods && periods.length >= 3) {
        const hReg = periods.slice(0, 3).reduce((s, p) => s + (p.home ?? 0), 0);
        const aReg = periods.slice(0, 3).reduce((s, p) => s + (p.away ?? 0), 0);
        return aReg > hReg ? true : aReg < hReg ? false : 'void';
      }
      return c.away > c.home;
    },
  },
  {
    market_code: 'HO_DRAW_REG',
    sport: 'hockey',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hokey Normal Süre - Beraberlik',
    display_name_en: 'Hockey Regulation - Tie',
    settle: c => {
      const periods = c.periods;
      if (periods && periods.length >= 3) {
        const hReg = periods.slice(0, 3).reduce((s, p) => s + (p.home ?? 0), 0);
        const aReg = periods.slice(0, 3).reduce((s, p) => s + (p.away ?? 0), 0);
        return hReg === aReg;
      }
      return c.home === c.away;
    },
  },
  {
    market_code: 'HO_HOME_ML',
    sport: 'hockey',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hokey Maç Sonucu - Ev (uzatma dahil)',
    display_name_en: 'Hockey Moneyline - Home',
    settle: c => c.home > c.away,
  },
  {
    market_code: 'HO_AWAY_ML',
    sport: 'hockey',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hokey Maç Sonucu - Deplasman (uzatma dahil)',
    display_name_en: 'Hockey Moneyline - Away',
    settle: c => c.away > c.home,
  },
  {
    market_code: 'HO_BTTS_YES',
    sport: 'hockey',
    family: 'btts',
    category: 'side',
    display_name_tr: 'Hokey Karşılıklı Gol Var',
    display_name_en: 'Hockey BTTS Yes',
    settle: c => c.home > 0 && c.away > 0,
  },
  {
    market_code: 'HO_BTTS_NO',
    sport: 'hockey',
    family: 'btts',
    category: 'side',
    display_name_tr: 'Hokey Karşılıklı Gol Yok',
    display_name_en: 'Hockey BTTS No',
    settle: c => c.home === 0 || c.away === 0,
  },
];

for (const line of [4.5, 5.5, 6.5, 7.5, 8.5]) {
  const code = Math.round(line * 10).toString();
  HOCKEY_MARKETS.push(
    {
      market_code: `HO_OVER_${code}`,
      sport: 'hockey',
      family: 'totals',
      category: 'main',
      display_name_tr: `Hokey ${line} Üst Gol`,
      display_name_en: `Hockey Over ${line}`,
      requires_line: true,
      settle: c => c.home + c.away > line,
    },
    {
      market_code: `HO_UNDER_${code}`,
      sport: 'hockey',
      family: 'totals',
      category: 'main',
      display_name_tr: `Hokey ${line} Alt Gol`,
      display_name_en: `Hockey Under ${line}`,
      requires_line: true,
      settle: c => c.home + c.away < line,
    },
  );
}

// Puck line (hockey handicap, typically ±1.5)
for (const h of [1.5]) {
  const s = Math.round(h * 10).toString();
  HOCKEY_MARKETS.push(
    {
      market_code: `HO_PUCK_HOME_MINUS_${s}`,
      sport: 'hockey',
      family: 'handicap',
      category: 'main',
      display_name_tr: `Hokey Ev Sahibi -${h} Puck Line`,
      display_name_en: `Hockey Home -${h} Puck Line`,
      requires_line: true,
      settle: c => c.home - h > c.away,
    },
    {
      market_code: `HO_PUCK_AWAY_PLUS_${s}`,
      sport: 'hockey',
      family: 'handicap',
      category: 'main',
      display_name_tr: `Hokey Deplasman +${h} Puck Line`,
      display_name_en: `Hockey Away +${h} Puck Line`,
      requires_line: true,
      settle: c => c.away + h > c.home,
    },
  );
}

// ============================================================================
// HANDBALL
// ============================================================================

const HANDBALL_MARKETS: MarketDef[] = [
  {
    market_code: 'HB_HOME_WIN',
    sport: 'handball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hentbol Ev Sahibi Kazanır',
    display_name_en: 'Handball Home Win',
    settle: c => c.home > c.away,
  },
  {
    market_code: 'HB_AWAY_WIN',
    sport: 'handball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hentbol Deplasman Kazanır',
    display_name_en: 'Handball Away Win',
    settle: c => c.away > c.home,
  },
  {
    market_code: 'HB_DRAW',
    sport: 'handball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Hentbol Beraberlik',
    display_name_en: 'Handball Draw',
    settle: c => c.home === c.away,
  },
];

for (const line of [48.5, 51.5, 54.5, 57.5, 60.5, 63.5]) {
  const code = Math.round(line * 10).toString();
  HANDBALL_MARKETS.push(
    {
      market_code: `HB_OVER_${code}`,
      sport: 'handball',
      family: 'totals',
      category: 'main',
      display_name_tr: `Hentbol ${line} Üst`,
      display_name_en: `Handball Over ${line}`,
      requires_line: true,
      settle: c => c.home + c.away > line,
    },
    {
      market_code: `HB_UNDER_${code}`,
      sport: 'handball',
      family: 'totals',
      category: 'main',
      display_name_tr: `Hentbol ${line} Alt`,
      display_name_en: `Handball Under ${line}`,
      requires_line: true,
      settle: c => c.home + c.away < line,
    },
  );
}

// ============================================================================
// VOLLEYBALL (set-based, no draw)
// ============================================================================

const VOLLEYBALL_MARKETS: MarketDef[] = [
  {
    market_code: 'VB_HOME_WIN',
    sport: 'volleyball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Voleybol Ev Sahibi Kazanır',
    display_name_en: 'Volleyball Home Win',
    settle: c => {
      const sets = c.sets ?? [];
      const hSets = sets.filter(s => (s.home ?? 0) > (s.away ?? 0)).length;
      const aSets = sets.filter(s => (s.home ?? 0) < (s.away ?? 0)).length;
      if (hSets === 0 && aSets === 0) return c.home > c.away;
      return hSets > aSets;
    },
  },
  {
    market_code: 'VB_AWAY_WIN',
    sport: 'volleyball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Voleybol Deplasman Kazanır',
    display_name_en: 'Volleyball Away Win',
    settle: c => {
      const sets = c.sets ?? [];
      const hSets = sets.filter(s => (s.home ?? 0) > (s.away ?? 0)).length;
      const aSets = sets.filter(s => (s.home ?? 0) < (s.away ?? 0)).length;
      if (hSets === 0 && aSets === 0) return c.away > c.home;
      return aSets > hSets;
    },
  },
];

const VB_SETS_OUTCOMES: Array<[string, 'H' | 'A', number, number]> = [
  ['VB_CS_3_0_HOME', 'H', 3, 0], ['VB_CS_3_1_HOME', 'H', 3, 1], ['VB_CS_3_2_HOME', 'H', 3, 2],
  ['VB_CS_0_3_AWAY', 'A', 0, 3], ['VB_CS_1_3_AWAY', 'A', 1, 3], ['VB_CS_2_3_AWAY', 'A', 2, 3],
];
for (const [code, _w, hSets, aSets] of VB_SETS_OUTCOMES) {
  VOLLEYBALL_MARKETS.push({
    market_code: code,
    sport: 'volleyball',
    family: 'correct_score',
    category: 'side',
    display_name_tr: `Voleybol Set Skoru ${hSets}-${aSets}`,
    display_name_en: `Volleyball Set Score ${hSets}-${aSets}`,
    settle: c => {
      const sets = c.sets ?? [];
      const h = sets.filter(s => (s.home ?? 0) > (s.away ?? 0)).length;
      const a = sets.filter(s => (s.home ?? 0) < (s.away ?? 0)).length;
      return h === hSets && a === aSets;
    },
  });
}

for (const line of [3.5, 4.5]) {
  const code = Math.round(line * 10).toString();
  VOLLEYBALL_MARKETS.push(
    {
      market_code: `VB_TOTAL_SETS_OVER_${code}`,
      sport: 'volleyball',
      family: 'totals',
      category: 'side',
      display_name_tr: `Voleybol Toplam Set ${line} Üst`,
      display_name_en: `Volleyball Total Sets Over ${line}`,
      requires_line: true,
      settle: c => {
        const sets = c.sets ?? [];
        const played = sets.filter(s => s.home !== null || s.away !== null).length;
        return played > line;
      },
    },
    {
      market_code: `VB_TOTAL_SETS_UNDER_${code}`,
      sport: 'volleyball',
      family: 'totals',
      category: 'side',
      display_name_tr: `Voleybol Toplam Set ${line} Alt`,
      display_name_en: `Volleyball Total Sets Under ${line}`,
      requires_line: true,
      settle: c => {
        const sets = c.sets ?? [];
        const played = sets.filter(s => s.home !== null || s.away !== null).length;
        return played < line;
      },
    },
  );
}

// ============================================================================
// BASEBALL
// ============================================================================

const BASEBALL_MARKETS: MarketDef[] = [
  {
    market_code: 'BS_HOME_ML',
    sport: 'baseball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Beyzbol Ev Sahibi Kazanır',
    display_name_en: 'Baseball Home Moneyline',
    settle: c => c.home > c.away,
  },
  {
    market_code: 'BS_AWAY_ML',
    sport: 'baseball',
    family: 'match_winner',
    category: 'main',
    display_name_tr: 'Beyzbol Deplasman Kazanır',
    display_name_en: 'Baseball Away Moneyline',
    settle: c => c.away > c.home,
  },
];

// Baseball runline (always ±1.5)
BASEBALL_MARKETS.push(
  {
    market_code: 'BS_RUNLINE_HOME_MINUS_15',
    sport: 'baseball',
    family: 'handicap',
    category: 'main',
    display_name_tr: 'Beyzbol Ev Sahibi -1.5 Koşu',
    display_name_en: 'Baseball Home -1.5 Runline',
    requires_line: true,
    settle: c => c.home - 1.5 > c.away,
  },
  {
    market_code: 'BS_RUNLINE_AWAY_PLUS_15',
    sport: 'baseball',
    family: 'handicap',
    category: 'main',
    display_name_tr: 'Beyzbol Deplasman +1.5 Koşu',
    display_name_en: 'Baseball Away +1.5 Runline',
    requires_line: true,
    settle: c => c.away + 1.5 > c.home,
  },
);

for (const line of [6.5, 7.5, 8.5, 9.5, 10.5, 11.5]) {
  const code = Math.round(line * 10).toString();
  BASEBALL_MARKETS.push(
    {
      market_code: `BS_OVER_${code}`,
      sport: 'baseball',
      family: 'totals',
      category: 'main',
      display_name_tr: `Beyzbol ${line} Üst Koşu`,
      display_name_en: `Baseball Over ${line}`,
      requires_line: true,
      settle: c => c.home + c.away > line,
    },
    {
      market_code: `BS_UNDER_${code}`,
      sport: 'baseball',
      family: 'totals',
      category: 'main',
      display_name_tr: `Beyzbol ${line} Alt Koşu`,
      display_name_en: `Baseball Under ${line}`,
      requires_line: true,
      settle: c => c.home + c.away < line,
    },
  );
}

// ============================================================================
// Aggregated taxonomy + lookup helpers
// ============================================================================

export const ALL_MARKETS: MarketDef[] = [
  ...FOOTBALL_MARKETS,
  ...BASKETBALL_MARKETS,
  ...HOCKEY_MARKETS,
  ...HANDBALL_MARKETS,
  ...VOLLEYBALL_MARKETS,
  ...BASEBALL_MARKETS,
];

const MARKET_INDEX = new Map(ALL_MARKETS.map(m => [m.market_code, m]));

export function getMarket(code: string): MarketDef | undefined {
  return MARKET_INDEX.get(code);
}

/**
 * Infer line from a market code if the market requires one (e.g., UNDER_25 → 2.5).
 * Used when settling pickdata that doesn't explicitly include the line.
 */
export function inferLine(code: string): number | undefined {
  const def = MARKET_INDEX.get(code);
  if (!def) return parseLineFromCode(code);
  if (!def.requires_line) return undefined;
  return parseLineFromCode(code);
}

export function listMarketsForSport(sport: SportCode): MarketDef[] {
  return ALL_MARKETS.filter(m => m.sport === sport || m.sport === 'all');
}

/**
 * Seed the market_taxonomy table. Idempotent — upserts every market.
 * Run once at startup or via a setup script.
 */
export async function seedMarketTaxonomy(): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const m of ALL_MARKETS) {
    const existing = await prisma.market_taxonomy.findUnique({
      where: { market_code: m.market_code },
    });
    if (existing) {
      await prisma.market_taxonomy.update({
        where: { market_code: m.market_code },
        data: {
          sport: m.sport,
          family: m.family,
          category: m.category,
          display_name_tr: m.display_name_tr,
          display_name_en: m.display_name_en,
          description: m.description,
          settlement_rule: 'code', // rules live in this file; DB just tracks the contract
          requires_line: m.requires_line ?? false,
        },
      });
      updated++;
    } else {
      await prisma.market_taxonomy.create({
        data: {
          market_code: m.market_code,
          sport: m.sport,
          family: m.family,
          category: m.category,
          display_name_tr: m.display_name_tr,
          display_name_en: m.display_name_en,
          description: m.description,
          settlement_rule: 'code',
          requires_line: m.requires_line ?? false,
        },
      });
      inserted++;
    }
  }
  return { inserted, updated };
}
