/**
 * Player Prop Analizi (Sport-Agnostic)
 *
 * hockey-analytics/lib/playerAnalysis.ts (895 satır) kodunun multi-sport
 * mimariye uyarlanmış hali. Her spor için prop kategorileri farklı,
 * ama analiz pipeline'ı ortak.
 *
 * Pipeline:
 *   1. Odds'tan oyuncu prop marketlerini tara
 *   2. Her prop için implied probability çıkar
 *   3. Oyuncu geçmiş performansından trueProbability tahmin et
 *   4. Edge hesapla, düşük-riskli yüksek-değerli olanları filtrele
 *   5. Riski kategorile (very-low / low / medium / high)
 */

import type { NormalizedOdds, NormalizedGame, SportId } from './types';

// ===== PROP KATEGORILERI (her spor için) =====
export type PropCategory =
  | 'goal'              // Futbol, hokey
  | 'assist'            // Futbol, hokey, NBA
  | 'shot'              // Futbol, hokey
  | 'shot_on_goal'      // Hokey
  | 'point'             // Hokey (gol + assist), NBA
  | 'rebound'           // NBA, basketball
  | 'three_pointer'     // NBA, basketball
  | 'pass_yard'         // American football
  | 'rush_yard'         // American football
  | 'touchdown'         // American football
  | 'hit'               // Baseball
  | 'home_run'          // Baseball
  | 'strikeout'         // Baseball
  | 'card'              // Futbol (sarı/kırmızı kart)
  | 'other';

export interface PlayerPropPrediction {
  playerName: string;
  team: 'home' | 'away';
  teamName: string;
  sport: SportId;
  category: PropCategory;
  betType: string;                 // Market ismi (örn "Anytime Goalscorer")
  selection: string;               // Seçim (örn "Lionel Messi Over 0.5 Goals")
  odds: number;
  bookmaker: string;
  impliedProb: number;
  estimatedProb: number;
  edge: number;                    // (estimated - implied) / implied
  confidence: number;              // 0-100
  reasoning: string;
  riskLevel: 'very-low' | 'low' | 'medium' | 'high';
}

// ===== SPORT → PROP CATEGORY MAPPING =====
export const SPORT_PROP_KEYWORDS: Record<SportId, Partial<Record<PropCategory, string[]>>> = {
  football: {
    goal: ['goalscorer', 'anytime scorer', 'first goalscorer', 'last goalscorer', 'to score'],
    assist: ['assist', 'anytime assist'],
    shot: ['shots', 'total shots'],
    shot_on_goal: ['shots on target', 'shots on goal'],
    card: ['to be carded', 'player booked', 'card'],
  },
  hockey: {
    goal: ['anytime goalscorer', 'to score', 'goalscorer'],
    assist: ['anytime assist', 'player assist'],
    point: ['anytime points', 'total points', 'to record'],
    shot_on_goal: ['shots on goal', 'sog', 'shot on goal'],
  },
  basketball: {
    point: ['player points', 'total points'],
    rebound: ['rebounds'],
    assist: ['assists'],
    three_pointer: ['three pointers', '3 pointers'],
  },
  nba: {
    point: ['player points', 'total points'],
    rebound: ['rebounds'],
    assist: ['assists'],
    three_pointer: ['three pointers', '3 pointers'],
  },
  handball: {
    goal: ['goalscorer', 'to score'],
  },
  americanFootball: {
    pass_yard: ['passing yards', 'pass yards'],
    rush_yard: ['rushing yards', 'rush yards'],
    touchdown: ['anytime touchdown', 'to score a touchdown'],
  },
  baseball: {
    hit: ['player hits', 'total hits'],
    home_run: ['home run', 'hr'],
    strikeout: ['strikeouts', 'k'],
  },
  volleyball: {},
  rugby: {
    goal: ['try', 'tryscorer'],
  },
  mma: {},
  afl: {
    goal: ['goalkicker', 'anytime goalkicker'],
  },
  formula1: {},
};

// ===== ODDS'TAN PLAYER PROP MARKETLERINI TARA =====
interface PlayerPropMarket {
  bookmaker: string;
  betName: string;
  selection: string;
  odds: number;
  category: PropCategory | null;
}

function detectPropCategory(sport: SportId, betName: string): PropCategory | null {
  const name = betName.toLowerCase();
  const kws = SPORT_PROP_KEYWORDS[sport] ?? {};
  for (const [cat, keywords] of Object.entries(kws)) {
    if (!keywords) continue;
    for (const kw of keywords) {
      if (name.includes(kw.toLowerCase())) {
        return cat as PropCategory;
      }
    }
  }
  return null;
}

function extractPropMarkets(odds: NormalizedOdds, sport: SportId): PlayerPropMarket[] {
  const out: PlayerPropMarket[] = [];
  for (const bm of odds.bookmakers) {
    for (const bet of bm.bets) {
      const cat = detectPropCategory(sport, bet.name);
      if (!cat) continue;
      for (const v of bet.values) {
        out.push({
          bookmaker: bm.name,
          betName: bet.name,
          selection: v.value,
          odds: v.odd,
          category: cat,
        });
      }
    }
  }
  return out;
}

// ===== OYUNCU PERFORMANS SKORU =====
/**
 * Geçmiş event verilerinden oyuncunun son N oyunda prop kategori oranı.
 * Örn: bir hokey oyuncusu son 10 maçta 6 kez gol attıysa goal rate = 0.6
 */
export interface PlayerEventRecord {
  playerId?: number;
  playerName: string;
  eventType: string;          // "goal", "assist", "shot", "yellow_card" vs
  timestamp: number;
}

export interface PlayerHistoryStats {
  gamesAnalyzed: number;
  rates: Partial<Record<PropCategory, number>>;  // 0-1 per game
  avgPerGame: Partial<Record<PropCategory, number>>;
}

export function computePlayerHistory(
  events: PlayerEventRecord[],
  gamesPlayed: number
): Map<string, PlayerHistoryStats> {
  const byPlayer = new Map<string, PlayerEventRecord[]>();
  for (const ev of events) {
    const key = ev.playerName.toLowerCase();
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key)!.push(ev);
  }

  const eventTypeToCategory: Record<string, PropCategory> = {
    goal: 'goal',
    assist: 'assist',
    shot: 'shot',
    shot_on_goal: 'shot_on_goal',
    sog: 'shot_on_goal',
    point: 'point',
    rebound: 'rebound',
    three: 'three_pointer',
    yellow_card: 'card',
    red_card: 'card',
    hit: 'hit',
    home_run: 'home_run',
    strikeout: 'strikeout',
    touchdown: 'touchdown',
  };

  const result = new Map<string, PlayerHistoryStats>();
  for (const [player, playerEvents] of byPlayer.entries()) {
    const gameCount = Math.max(1, gamesPlayed);
    const counts: Partial<Record<PropCategory, number>> = {};
    for (const e of playerEvents) {
      const cat = eventTypeToCategory[e.eventType.toLowerCase()];
      if (!cat) continue;
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    const rates: Partial<Record<PropCategory, number>> = {};
    const avg: Partial<Record<PropCategory, number>> = {};
    for (const [cat, c] of Object.entries(counts)) {
      if (c === undefined) continue;
      // "En az 1 kez" oranı: 1 - P(0) Poisson yaklaşıkla = 1 - exp(-avg)
      const avgPerGame = c / gameCount;
      avg[cat as PropCategory] = avgPerGame;
      rates[cat as PropCategory] = 1 - Math.exp(-avgPerGame);
    }
    result.set(player, {
      gamesAnalyzed: gameCount,
      rates,
      avgPerGame: avg,
    });
  }
  return result;
}

// ===== OYUNCU ADINI MARKET SELECTION'DAN PARSE =====
function parsePlayerNameFromSelection(selection: string): string | null {
  // Tipik formatlar:
  //   "Lionel Messi"
  //   "Lionel Messi - Over 0.5"
  //   "Over 1.5 - Lionel Messi"
  //   "Player Goal - Lionel Messi"
  const parts = selection.split(/\s*[-–—]\s*/).map(s => s.trim());
  // Genelde en uzun string oyuncu adıdır
  const likely = parts
    .filter(p => p && !/^(over|under|\d+(\.\d+)?|yes|no)$/i.test(p))
    .sort((a, b) => b.length - a.length);
  return likely[0] ?? null;
}

function parseThreshold(selection: string): number | null {
  const m = selection.match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function isOverSelection(selection: string): boolean {
  return /over/i.test(selection);
}

// ===== PROP TAHMIN PIPELINE =====
export interface PlayerPropAnalysisInput {
  sport: SportId;
  game: NormalizedGame;
  odds: NormalizedOdds | null;
  playerHistory: Map<string, PlayerHistoryStats>;
  minEdge?: number;              // Default 0.05
  maxRisk?: 'very-low' | 'low' | 'medium' | 'high'; // Default 'medium' (very-low ve low geçer)
}

export function analyzePlayerProps(input: PlayerPropAnalysisInput): PlayerPropPrediction[] {
  if (!input.odds) return [];
  const markets = extractPropMarkets(input.odds, input.sport);
  const minEdge = input.minEdge ?? 0.05;

  const preds: PlayerPropPrediction[] = [];
  const homeId = input.game.teams.home.id;
  const awayId = input.game.teams.away.id;
  const homeName = input.game.teams.home.name;
  const awayName = input.game.teams.away.name;

  for (const m of markets) {
    if (!m.category) continue;

    const playerName = parsePlayerNameFromSelection(m.selection);
    if (!playerName) continue;

    const history = input.playerHistory.get(playerName.toLowerCase());
    if (!history) continue;

    let estimatedProb: number;
    let reasoning: string;

    const threshold = parseThreshold(m.selection);
    const isOver = isOverSelection(m.selection);
    const avgPerGame = history.avgPerGame[m.category];
    const rate = history.rates[m.category];

    if (threshold !== null && avgPerGame !== undefined) {
      // Poisson: P(X > threshold) where X ~ Poisson(lambda=avgPerGame)
      const lambda = avgPerGame;
      let pUnder = 0;
      const t = Math.floor(threshold);
      for (let k = 0; k <= t; k++) {
        pUnder += Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k);
      }
      estimatedProb = isOver ? 1 - pUnder : pUnder;
      reasoning = `${playerName} son ${history.gamesAnalyzed} maçta ortalama ${avgPerGame.toFixed(2)} ${m.category}. Poisson(λ=${lambda.toFixed(2)}) ile ${isOver ? 'Over' : 'Under'} ${threshold} olasılığı %${(estimatedProb * 100).toFixed(1)}`;
    } else if (rate !== undefined) {
      // Yes/No anytime-type
      estimatedProb = rate;
      reasoning = `${playerName} son ${history.gamesAnalyzed} maçın %${(rate * 100).toFixed(0)}'ünde ${m.category} kaydetti`;
    } else {
      continue;
    }

    const impliedProb = 1 / m.odds;
    const edge = (estimatedProb - impliedProb) / impliedProb;

    if (edge < minEdge) continue;
    if (m.odds < 1.5 || m.odds > 10) continue; // çok ucuz veya çok yüksek = trap

    // Hangi takım?
    let team: 'home' | 'away' = 'home';
    let teamName = homeName;
    // Heuristic: stats bilinmediğinden şu aşamada ev-safi varsayılan

    // Risk level
    let riskLevel: PlayerPropPrediction['riskLevel'];
    if (estimatedProb >= 0.75 && m.odds <= 2.0) riskLevel = 'very-low';
    else if (estimatedProb >= 0.65 && m.odds <= 2.5) riskLevel = 'low';
    else if (estimatedProb >= 0.50) riskLevel = 'medium';
    else riskLevel = 'high';

    // Max risk filtresi
    const maxRisk = input.maxRisk ?? 'medium';
    const riskOrder = ['very-low', 'low', 'medium', 'high'];
    if (riskOrder.indexOf(riskLevel) > riskOrder.indexOf(maxRisk)) continue;

    // Confidence
    const confidence = Math.round(
      Math.min(95,
        40 +
        (history.gamesAnalyzed >= 10 ? 20 : history.gamesAnalyzed * 2) +
        edge * 100 +
        (estimatedProb - 0.5) * 60
      )
    );

    preds.push({
      playerName,
      team,
      teamName,
      sport: input.sport,
      category: m.category,
      betType: m.betName,
      selection: m.selection,
      odds: m.odds,
      bookmaker: m.bookmaker,
      impliedProb,
      estimatedProb,
      edge,
      confidence: Math.max(0, confidence),
      reasoning,
      riskLevel,
    });
  }

  // Sort: en yüksek edge ilk
  preds.sort((a, b) => b.edge - a.edge);
  return preds;
}

// ===== YARDIMCI =====
function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
