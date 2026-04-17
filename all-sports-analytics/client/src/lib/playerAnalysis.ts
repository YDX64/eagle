/**
 * AWA Stats - Oyuncu Performans Tahmin Motoru
 * Arctic Futurism Theme
 * 
 * Algoritmalar:
 * 1. Oyuncu Gol Atma Olasılığı (Poisson + Oran Analizi)
 * 2. Oyuncu Performans Skoru (Geçmiş Event Verileri)
 * 3. Düşük Riskli Yüksek Oran Stratejisi
 * 4. Smart Combo Builder (Akıllı Kombinasyon Oluşturucu)
 */

import type { Game, GameEvent, OddsResponse, BookmakerOdds, BetOdds } from './api';
import type { MatchPrediction, ValueBet } from './analysis';

// ===== PLAYER PROP TYPES =====
export interface PlayerPropPrediction {
  playerName: string;
  team: 'home' | 'away';
  teamName: string;
  betType: string;
  selection: string;
  odds: number;
  bookmaker: string;
  impliedProb: number;
  estimatedProb: number;
  edge: number;
  confidence: number;
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  category: 'goal' | 'assist' | 'shot' | 'point' | 'other';
}

// ===== DÜŞÜK RİSKLİ YÜKSEK ORAN BAHİS TÜRLERİ =====
export interface SmartBet {
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  betType: string;
  selection: string;
  odds: number;
  bookmaker: string;
  trueProbability: number;
  edge: number;
  riskScore: number; // 0-100, düşük = düşük risk
  riskCategory: 'very-low' | 'low' | 'medium' | 'high';
  profitPotential: number; // edge * odds
  reasoning: string;
  tags: string[];
}

export interface SmartCombo {
  name: string;
  description: string;
  strategy: string;
  bets: SmartBet[];
  totalOdds: number;
  combinedProbability: number;
  riskScore: number;
  riskCategory: 'very-low' | 'low' | 'medium' | 'high';
  expectedValue: number;
  suggestedStake: number;
  potentialReturn: number;
  tags: string[];
}

// ===== OYUNCU TAHMİN MOTORU =====
export function analyzePlayerProps(
  oddsData: OddsResponse | null,
  prediction: MatchPrediction,
  game: Game,
  events: GameEvent[]
): PlayerPropPrediction[] {
  if (!oddsData || !oddsData.bookmakers) return [];

  const predictions: PlayerPropPrediction[] = [];
  const homeTeamName = game.teams.home.name;
  const awayTeamName = game.teams.away.name;

  // Geçmiş event'lerden oyuncu performans verileri
  const playerGoalHistory = new Map<string, number>();
  const playerAssistHistory = new Map<string, number>();
  events.forEach(ev => {
    if (ev.type === 'goal') {
      ev.players.forEach(p => {
        playerGoalHistory.set(p, (playerGoalHistory.get(p) || 0) + 1);
      });
      ev.assists.forEach(a => {
        playerAssistHistory.set(a, (playerAssistHistory.get(a) || 0) + 1);
      });
    }
  });

  // Player Props bahis türlerini filtrele
  const playerBetTypes = [
    'Anytime Goal Scorer', 'First Goal Scorer', 'Home Anytime Goal Scorer',
    'Away Anytime Goal Scorer', 'Home First Goal Scorer', 'Away First Goal Scorer',
    'Player Points', 'Player Points Milestones', 'Player Shots On Goal',
    'Player Powerplay Points', 'Player Assists', 'Player Singles',
  ];

  oddsData.bookmakers.forEach(bm => {
    bm.bets.forEach(bet => {
      const isPlayerBet = playerBetTypes.some(pt => bet.name.includes(pt)) ||
        bet.name.toLowerCase().includes('scorer') ||
        bet.name.toLowerCase().includes('player');

      if (!isPlayerBet) return;

      bet.values.forEach(v => {
        const odds = parseFloat(v.odd);
        if (isNaN(odds) || odds <= 1) return;

        const impliedProb = (1 / odds) * 100;
        const playerName = extractPlayerName(v.value, bet.name);
        const isHome = bet.name.includes('Home') || (!bet.name.includes('Away') && Math.random() > 0.5);
        const team = isHome ? 'home' : 'away';
        const teamName = isHome ? homeTeamName : awayTeamName;

        // Oyuncu tahmin algoritması
        const { estimatedProb, confidence, reasoning, category, riskLevel } = estimatePlayerProbability(
          bet.name, v.value, odds, prediction, playerGoalHistory, playerAssistHistory, playerName, team
        );

        const edge = ((estimatedProb / 100) - (impliedProb / 100)) / (impliedProb / 100) * 100;

        predictions.push({
          playerName,
          team,
          teamName,
          betType: bet.name,
          selection: v.value,
          odds,
          bookmaker: bm.name,
          impliedProb,
          estimatedProb,
          edge,
          confidence,
          reasoning,
          riskLevel,
          category,
        });
      });
    });
  });

  // Edge'e göre sırala, en iyi tahminler üstte
  return predictions.sort((a, b) => b.edge - a.edge);
}

function extractPlayerName(value: string, betName: string): string {
  // "Nazem Kadri" veya "Brent Burns - Over 2.5" formatlarından isim çıkar
  const parts = value.split(' - ');
  if (parts.length >= 2) return parts[0].trim();
  // Anytime/First Goal Scorer formatı: sadece isim
  if (betName.includes('Scorer')) return value.trim();
  return value.trim();
}

function estimatePlayerProbability(
  betName: string,
  value: string,
  odds: number,
  prediction: MatchPrediction,
  goalHistory: Map<string, number>,
  assistHistory: Map<string, number>,
  playerName: string,
  team: 'home' | 'away'
): { estimatedProb: number; confidence: number; reasoning: string; category: 'goal' | 'assist' | 'shot' | 'point' | 'other'; riskLevel: 'low' | 'medium' | 'high' } {

  const expectedTeamGoals = team === 'home' ? prediction.expectedHomeGoals : prediction.expectedAwayGoals;
  const impliedProb = (1 / odds) * 100;

  // === ANYTIME GOAL SCORER ===
  if (betName.includes('Anytime Goal Scorer') || betName.includes('Anytime Goal')) {
    // Bir oyuncunun maçta en az 1 gol atma olasılığı
    // Poisson: P(X >= 1) = 1 - P(X = 0) = 1 - e^(-lambda)
    // Lambda = takım beklenen gol / ortalama kadro sayısı * oyuncu ağırlığı
    
    // Bahisçi oranından implied prob hesapla, sonra takım gücüne göre düzelt
    const teamStrengthFactor = expectedTeamGoals / 3.0; // 3.0 ortalama gol
    
    // Yıldız oyuncular (düşük odds = yüksek olasılık) için daha güvenilir tahmin
    let adjustedProb = impliedProb;
    
    if (odds <= 3.0) {
      // Yıldız oyuncu - takım gücüne göre hafif düzeltme
      adjustedProb = impliedProb * (0.85 + teamStrengthFactor * 0.15);
    } else if (odds <= 5.0) {
      // Orta seviye oyuncu
      adjustedProb = impliedProb * (0.80 + teamStrengthFactor * 0.20);
    } else if (odds <= 10.0) {
      // Düşük olasılıklı oyuncu - savunmacı/yedek
      adjustedProb = impliedProb * (0.75 + teamStrengthFactor * 0.25);
    } else {
      // Çok düşük olasılık - kaleci/yedek savunmacı
      adjustedProb = impliedProb * (0.70 + teamStrengthFactor * 0.30);
    }

    // Geçmiş gol verisi varsa düzelt
    const pastGoals = goalHistory.get(playerName) || 0;
    if (pastGoals > 0) {
      adjustedProb *= (1 + pastGoals * 0.05);
    }

    const riskLevel = odds <= 4.0 ? 'medium' : odds <= 8.0 ? 'high' : 'high';
    
    return {
      estimatedProb: Math.min(95, adjustedProb),
      confidence: odds <= 5.0 ? 70 : 55,
      reasoning: `Takım beklenen gol: ${expectedTeamGoals.toFixed(1)}. ${odds <= 3.0 ? 'Yıldız oyuncu, gol atma olasılığı yüksek.' : odds <= 6.0 ? 'Orta seviye gol potansiyeli.' : 'Düşük gol olasılığı ama yüksek oran.'}${pastGoals > 0 ? ` Geçmiş ${pastGoals} gol kaydı var.` : ''}`,
      category: 'goal',
      riskLevel,
    };
  }

  // === FIRST GOAL SCORER ===
  if (betName.includes('First Goal Scorer') || betName.includes('First Goal')) {
    // İlk golü atma olasılığı = Anytime Goal * (1 / toplam gol atan oyuncu sayısı)
    const teamStrengthFactor = expectedTeamGoals / 3.0;
    let adjustedProb = impliedProb * (0.80 + teamStrengthFactor * 0.20);
    
    // First Goal Scorer genellikle çok yüksek oranlar sunar
    return {
      estimatedProb: Math.min(30, adjustedProb),
      confidence: 45,
      reasoning: `İlk gol atma olasılığı düşük ama oran çok yüksek. Takım beklenen gol: ${expectedTeamGoals.toFixed(1)}. ${odds >= 15 ? 'Yüksek oran, düşük olasılık - kupon bacağı olarak değerli.' : 'Makul oran aralığında.'}`,
      category: 'goal',
      riskLevel: 'high',
    };
  }

  // === PLAYER SHOTS ON GOAL ===
  if (betName.includes('Shots On Goal') || betName.includes('Player Shots') || betName.includes('Home Player Shots')) {
    const isOver = value.includes('Over');
    const line = parseFloat(value.replace(/.*?([\d.]+)$/, '$1')) || 2.5;
    
    // Şut sayısı tahminleri daha güvenilir
    let adjustedProb = impliedProb;
    const teamStrengthFactor = expectedTeamGoals / 3.0;
    
    if (isOver) {
      adjustedProb = impliedProb * (0.90 + teamStrengthFactor * 0.10);
    } else {
      adjustedProb = impliedProb * (1.10 - teamStrengthFactor * 0.10);
    }

    return {
      estimatedProb: Math.min(85, Math.max(15, adjustedProb)),
      confidence: 65,
      reasoning: `Şut sayısı tahmini. ${isOver ? 'Üst' : 'Alt'} ${line} şut. Takım gol beklentisi: ${expectedTeamGoals.toFixed(1)}. Şut tahminleri gol tahminlerinden daha güvenilir.`,
      category: 'shot',
      riskLevel: 'low',
    };
  }

  // === PLAYER POINTS ===
  if (betName.includes('Player Points') && !betName.includes('Milestones') && !betName.includes('Powerplay')) {
    const isOver = value.includes('Over');
    const teamStrengthFactor = expectedTeamGoals / 3.0;
    let adjustedProb = impliedProb * (0.85 + teamStrengthFactor * 0.15);

    return {
      estimatedProb: Math.min(80, adjustedProb),
      confidence: 60,
      reasoning: `Oyuncu puan tahmini (gol + asist). Takım beklenen gol: ${expectedTeamGoals.toFixed(1)}. ${isOver ? 'Üst' : 'Alt'} puan beklentisi.`,
      category: 'point',
      riskLevel: 'medium',
    };
  }

  // === PLAYER POINTS MILESTONES ===
  if (betName.includes('Milestones')) {
    const milestone = parseInt(value.replace(/\D/g, '').slice(-1)) || 1;
    const teamStrengthFactor = expectedTeamGoals / 3.0;
    let adjustedProb = impliedProb;
    
    if (milestone === 1) {
      adjustedProb = impliedProb * (0.90 + teamStrengthFactor * 0.10);
    } else if (milestone === 2) {
      adjustedProb = impliedProb * (0.85 + teamStrengthFactor * 0.15);
    } else {
      adjustedProb = impliedProb * (0.75 + teamStrengthFactor * 0.25);
    }

    return {
      estimatedProb: Math.min(70, adjustedProb),
      confidence: 55,
      reasoning: `${milestone}+ puan milestone. ${milestone === 1 ? 'Tek puan hedefi - makul olasılık.' : milestone === 2 ? 'Çift puan - orta zorluk.' : 'Yüksek puan hedefi - zor ama yüksek oran.'}`,
      category: 'point',
      riskLevel: milestone <= 1 ? 'medium' : 'high',
    };
  }

  // === PLAYER POWERPLAY POINTS ===
  if (betName.includes('Powerplay')) {
    const isOver = value.includes('Over');
    const teamStrengthFactor = expectedTeamGoals / 3.0;
    let adjustedProb = impliedProb * (0.80 + teamStrengthFactor * 0.20);

    return {
      estimatedProb: Math.min(70, adjustedProb),
      confidence: 50,
      reasoning: `Powerplay puan tahmini. Güç oyununda puan yapma olasılığı. Takım gol beklentisi: ${expectedTeamGoals.toFixed(1)}.`,
      category: 'point',
      riskLevel: 'medium',
    };
  }

  // === PLAYER ASSISTS ===
  if (betName.includes('Assists')) {
    const isOver = value.includes('Over');
    const teamStrengthFactor = expectedTeamGoals / 3.0;
    let adjustedProb = impliedProb * (0.85 + teamStrengthFactor * 0.15);

    const pastAssists = assistHistory.get(playerName) || 0;
    if (pastAssists > 0) adjustedProb *= (1 + pastAssists * 0.03);

    return {
      estimatedProb: Math.min(75, adjustedProb),
      confidence: 55,
      reasoning: `Asist tahmini. Takım beklenen gol: ${expectedTeamGoals.toFixed(1)}.${pastAssists > 0 ? ` Geçmiş ${pastAssists} asist kaydı.` : ''}`,
      category: 'assist',
      riskLevel: 'medium',
    };
  }

  // === PLAYER SINGLES (Kaleci şut kurtarma vb.) ===
  if (betName.includes('Singles')) {
    const isOver = value.includes('Over');
    const opponentGoals = team === 'home' ? prediction.expectedAwayGoals : prediction.expectedHomeGoals;
    // Kaleci kurtarma sayısı genellikle şut sayısının ~%70'i
    const expectedSaves = opponentGoals * 3.5 * 0.70;
    const line = parseFloat(value.replace(/.*?([\d.]+)$/, '$1')) || 20;
    
    let adjustedProb: number;
    if (isOver) {
      adjustedProb = expectedSaves > line ? 65 : expectedSaves > line * 0.9 ? 50 : 35;
    } else {
      adjustedProb = expectedSaves < line ? 65 : expectedSaves < line * 1.1 ? 50 : 35;
    }

    return {
      estimatedProb: adjustedProb,
      confidence: 60,
      reasoning: `Kaleci kurtarma tahmini. Rakip beklenen gol: ${opponentGoals.toFixed(1)}, beklenen şut: ~${(opponentGoals * 3.5).toFixed(0)}, beklenen kurtarma: ~${expectedSaves.toFixed(0)}.`,
      category: 'other',
      riskLevel: 'low',
    };
  }

  // Genel fallback
  return {
    estimatedProb: impliedProb * 0.95,
    confidence: 40,
    reasoning: 'Genel oyuncu bahis tahmini.',
    category: 'other',
    riskLevel: 'medium',
  };
}

// ===== DÜŞÜK RİSKLİ YÜKSEK ORAN STRATEJİSİ =====

// Bahis türlerinin risk skorları (0 = en düşük risk)
const BET_RISK_SCORES: Record<string, number> = {
  'Double Chance': 10,
  'Home/Away': 25,
  'Both Teams To Score': 20,
  'Over/Under': 30,
  'Over/Under (Reg Time)': 30,
  '3Way Result': 35,
  'Asian Handicap': 25,
  'Asian Handicap (Reg Time)': 25,
  'Handicap Result': 30,
  'Home team will score a goal': 15,
  'Away team will score a goal': 15,
  'Match ends in Regular Time': 20,
  'Will match go to overtime?': 25,
  'Team To Score First': 30,
  'Odd/Even': 45,
  'Correct Score': 80,
  'First Goal Scorer': 85,
  'Anytime Goal Scorer': 70,
};

function getBetRiskScore(betName: string, odds: number, trueProbability: number): number {
  // Temel risk skoru
  let baseRisk = 50;
  for (const [key, risk] of Object.entries(BET_RISK_SCORES)) {
    if (betName.includes(key)) {
      baseRisk = risk;
      break;
    }
  }

  // Olasılık düzeltmesi - yüksek olasılık = düşük risk
  if (trueProbability > 70) baseRisk -= 15;
  else if (trueProbability > 55) baseRisk -= 8;
  else if (trueProbability < 30) baseRisk += 15;
  else if (trueProbability < 40) baseRisk += 8;

  // Oran düzeltmesi - çok yüksek oran = yüksek risk
  if (odds > 5) baseRisk += 10;
  else if (odds > 3) baseRisk += 5;
  else if (odds < 1.5) baseRisk -= 5;

  return Math.max(0, Math.min(100, baseRisk));
}

function getRiskCategory(score: number): 'very-low' | 'low' | 'medium' | 'high' {
  if (score <= 20) return 'very-low';
  if (score <= 40) return 'low';
  if (score <= 60) return 'medium';
  return 'high';
}

export function findSmartBets(
  prediction: MatchPrediction,
  oddsData: OddsResponse | null,
  game: Game
): SmartBet[] {
  if (!oddsData || !oddsData.bookmakers) return [];

  const smartBets: SmartBet[] = [];
  const expectedTotal = prediction.expectedTotalGoals;
  const homeExpected = prediction.expectedHomeGoals;
  const awayExpected = prediction.expectedAwayGoals;

  oddsData.bookmakers.forEach(bm => {
    bm.bets.forEach(bet => {
      bet.values.forEach(v => {
        const odds = parseFloat(v.odd);
        if (isNaN(odds) || odds <= 1.01) return;

        const impliedProb = 1 / odds;
        let trueProbability = 0;
        let reasoning = '';
        const tags: string[] = [];

        // === DOUBLE CHANCE === (En düşük riskli bahis türü)
        if (bet.name.includes('Double Chance')) {
          if (v.value === '1X' || v.value === 'Home/Draw') {
            trueProbability = (prediction.homeWinProb + prediction.drawProb) / 100;
            reasoning = `Ev sahibi kazanır veya berabere. Ev: ${prediction.homeWinProb.toFixed(0)}% + Berabere: ${prediction.drawProb.toFixed(0)}%`;
            tags.push('düşük-risk', 'double-chance');
          } else if (v.value === 'X2' || v.value === 'Draw/Away') {
            trueProbability = (prediction.drawProb + prediction.awayWinProb) / 100;
            reasoning = `Deplasman kazanır veya berabere. Dep: ${prediction.awayWinProb.toFixed(0)}% + Berabere: ${prediction.drawProb.toFixed(0)}%`;
            tags.push('düşük-risk', 'double-chance');
          } else if (v.value === '12' || v.value === 'Home/Away') {
            trueProbability = (prediction.homeWinProb + prediction.awayWinProb) / 100;
            reasoning = `Berabere olmaz. Ev: ${prediction.homeWinProb.toFixed(0)}% + Dep: ${prediction.awayWinProb.toFixed(0)}%`;
            tags.push('orta-risk', 'double-chance');
          }
        }

        // === GOL ATACAK MI === (Düşük riskli)
        else if (bet.name.includes('will score a goal') && !bet.name.includes('Period')) {
          const isHome = bet.name.includes('Home');
          const teamGoals = isHome ? homeExpected : awayExpected;
          trueProbability = 1 - Math.exp(-teamGoals); // P(X >= 1) = 1 - e^(-lambda)
          if (v.value === 'Yes') {
            reasoning = `${isHome ? 'Ev sahibi' : 'Deplasman'} en az 1 gol atar. Beklenen gol: ${teamGoals.toFixed(1)}`;
            tags.push('düşük-risk', 'gol-var');
          } else {
            trueProbability = 1 - trueProbability;
            reasoning = `${isHome ? 'Ev sahibi' : 'Deplasman'} gol atamaz. Beklenen gol: ${teamGoals.toFixed(1)}`;
            tags.push('yüksek-risk', 'gol-yok');
          }
        }

        // === BTTS (KG VAR/YOK) ===
        else if (bet.name === 'Both Teams To Score' && !bet.name.includes('Period')) {
          if (v.value === 'Yes') {
            trueProbability = prediction.btts.yes / 100;
            reasoning = `Her iki takım da gol atar. KG Var olasılığı: ${prediction.btts.yes.toFixed(0)}%`;
            tags.push('orta-risk', 'btts');
          } else {
            trueProbability = prediction.btts.no / 100;
            reasoning = `En az bir takım gol atamaz. KG Yok olasılığı: ${prediction.btts.no.toFixed(0)}%`;
            tags.push('orta-risk', 'btts');
          }
        }

        // === OVER/UNDER (Maç geneli) ===
        else if ((bet.name === 'Over/Under' || bet.name === 'Over/Under (Reg Time)') && !bet.name.includes('Period')) {
          const line = parseFloat(v.value.replace('Over ', '').replace('Under ', ''));
          if (!isNaN(line)) {
            if (v.value.startsWith('Over')) {
              if (line === 2.5) trueProbability = prediction.overUnder25.over / 100;
              else if (line === 3.5) trueProbability = prediction.overUnder35.over / 100;
              else if (line === 4.5) trueProbability = prediction.overUnder45.over / 100;
              else if (line === 5.5) trueProbability = prediction.overUnder55.over / 100;
              reasoning = `Toplam gol ${line} üstü. Beklenen toplam: ${expectedTotal.toFixed(1)}`;
              tags.push('over-under');
            } else {
              if (line === 2.5) trueProbability = prediction.overUnder25.under / 100;
              else if (line === 3.5) trueProbability = prediction.overUnder35.under / 100;
              else if (line === 4.5) trueProbability = prediction.overUnder45.under / 100;
              else if (line === 5.5) trueProbability = prediction.overUnder55.under / 100;
              reasoning = `Toplam gol ${line} altı. Beklenen toplam: ${expectedTotal.toFixed(1)}`;
              tags.push('over-under');
            }
          }
        }

        // === 3WAY RESULT ===
        else if (bet.name === '3Way Result') {
          if (v.value === 'Home') {
            trueProbability = prediction.homeWinProb / 100;
            reasoning = `Ev sahibi kazanır. Olasılık: ${prediction.homeWinProb.toFixed(0)}%`;
          } else if (v.value === 'Draw') {
            trueProbability = prediction.drawProb / 100;
            reasoning = `Berabere. Olasılık: ${prediction.drawProb.toFixed(0)}%`;
          } else if (v.value === 'Away') {
            trueProbability = prediction.awayWinProb / 100;
            reasoning = `Deplasman kazanır. Olasılık: ${prediction.awayWinProb.toFixed(0)}%`;
          }
          tags.push('maç-sonucu');
        }

        // === HOME/AWAY ===
        else if (bet.name === 'Home/Away' || bet.name === 'Home/Away (Reg Time)') {
          const totalNonDraw = prediction.homeWinProb + prediction.awayWinProb;
          if (v.value === 'Home') {
            trueProbability = prediction.homeWinProb / totalNonDraw;
            reasoning = `Ev sahibi kazanır (berabere hariç). Olasılık: ${(trueProbability * 100).toFixed(0)}%`;
          } else {
            trueProbability = prediction.awayWinProb / totalNonDraw;
            reasoning = `Deplasman kazanır (berabere hariç). Olasılık: ${(trueProbability * 100).toFixed(0)}%`;
          }
          tags.push('maç-sonucu');
        }

        // === MAÇIN UZATMAYA GİDİP GİTMEYECEĞİ ===
        else if (bet.name.includes('overtime') || bet.name.includes('Regular Time')) {
          if (bet.name.includes('Regular Time')) {
            if (v.value === 'Yes') {
              trueProbability = (prediction.homeWinProb + prediction.awayWinProb) / 100;
              reasoning = `Maç normal sürede biter. Berabere olmaz olasılığı: ${((prediction.homeWinProb + prediction.awayWinProb)).toFixed(0)}%`;
            } else {
              trueProbability = prediction.drawProb / 100;
              reasoning = `Maç uzatmaya gider. Berabere olasılığı: ${prediction.drawProb.toFixed(0)}%`;
            }
          } else {
            if (v.value === 'Yes') {
              trueProbability = prediction.drawProb / 100;
              reasoning = `Maç uzatmaya gider. Berabere olasılığı: ${prediction.drawProb.toFixed(0)}%`;
            } else {
              trueProbability = (prediction.homeWinProb + prediction.awayWinProb) / 100;
              reasoning = `Maç uzatmaya gitmez. Normal sürede biter olasılığı: ${((prediction.homeWinProb + prediction.awayWinProb)).toFixed(0)}%`;
            }
          }
          tags.push('uzatma');
        }

        // === ASIAN HANDICAP ===
        else if (bet.name.includes('Asian Handicap') && !bet.name.includes('Period')) {
          const handicapMatch = v.value.match(/(Home|Away)\s*([-+]?\d+\.?\d*)/);
          if (handicapMatch) {
            const side = handicapMatch[1];
            const handicap = parseFloat(handicapMatch[2]);
            const teamGoals = side === 'Home' ? homeExpected : awayExpected;
            const oppGoals = side === 'Home' ? awayExpected : homeExpected;
            const adjustedDiff = teamGoals - oppGoals + handicap;
            
            // Normal dağılım yaklaşımı
            const std = Math.sqrt(teamGoals + oppGoals) * 0.8;
            trueProbability = normalCDF(adjustedDiff / std);
            reasoning = `${side === 'Home' ? 'Ev' : 'Dep'} ${handicap > 0 ? '+' : ''}${handicap} handikap. Beklenen fark: ${(teamGoals - oppGoals).toFixed(1)}`;
            tags.push('handikap');
          }
        }

        if (trueProbability > 0) {
          const edge = ((trueProbability - impliedProb) / impliedProb) * 100;
          const riskScore = getBetRiskScore(bet.name, odds, trueProbability * 100);
          const riskCategory = getRiskCategory(riskScore);

          if (edge > -5) { // Çok kötü olmayan tüm bahisleri dahil et
            smartBets.push({
              gameId: game.id,
              homeTeam: game.teams.home.name,
              awayTeam: game.teams.away.name,
              league: game.league.name,
              betType: bet.name,
              selection: v.value,
              odds,
              bookmaker: bm.name,
              trueProbability: trueProbability * 100,
              edge,
              riskScore,
              riskCategory,
              profitPotential: edge * odds / 100,
              reasoning,
              tags,
            });
          }
        }
      });
    });
  });

  return smartBets.sort((a, b) => {
    // Önce düşük risk, sonra yüksek edge
    const riskDiff = a.riskScore - b.riskScore;
    if (Math.abs(riskDiff) > 15) return riskDiff;
    return b.edge - a.edge;
  });
}

// Normal CDF yaklaşımı
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327;
  const p = d * Math.exp(-x * x / 2) * (t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744)))));
  return x > 0 ? 1 - p : p;
}

// ===== AKILLI KOMBİNASYON OLUŞTURUCU =====
export function generateSmartCombos(
  allSmartBets: SmartBet[]
): SmartCombo[] {
  const combos: SmartCombo[] = [];

  // Maç bazında en iyi düşük riskli bahisleri grupla
  const byGame = new Map<number, SmartBet[]>();
  allSmartBets.forEach(b => {
    if (!byGame.has(b.gameId)) byGame.set(b.gameId, []);
    byGame.get(b.gameId)!.push(b);
  });

  // Her maçtan en iyi düşük riskli bahisi seç
  const bestLowRisk: SmartBet[] = [];
  const bestMediumRisk: SmartBet[] = [];
  const bestHighOdds: SmartBet[] = [];
  const bestValue: SmartBet[] = [];

  byGame.forEach((bets, gameId) => {
    // Düşük riskli en iyi
    const lowRisk = bets
      .filter(b => b.riskScore <= 30 && b.edge > 0 && b.trueProbability > 55)
      .sort((a, b) => b.edge - a.edge)[0];
    if (lowRisk) bestLowRisk.push(lowRisk);

    // Orta riskli yüksek edge
    const medRisk = bets
      .filter(b => b.riskScore <= 50 && b.edge > 5 && b.odds >= 1.5)
      .sort((a, b) => b.edge - a.edge)[0];
    if (medRisk) bestMediumRisk.push(medRisk);

    // Yüksek oran + pozitif edge
    const highOdds = bets
      .filter(b => b.odds >= 2.0 && b.edge > 3)
      .sort((a, b) => b.odds - a.odds)[0];
    if (highOdds) bestHighOdds.push(highOdds);

    // En yüksek value (edge)
    const bestVal = bets
      .filter(b => b.edge > 8)
      .sort((a, b) => b.edge - a.edge)[0];
    if (bestVal) bestValue.push(bestVal);
  });

  // === STRATEJI 1: KALE GİBİ KUPON (Çok düşük risk) ===
  const fortressBets = bestLowRisk
    .filter(b => b.trueProbability > 65 && b.odds >= 1.10)
    .sort((a, b) => b.trueProbability - a.trueProbability)
    .slice(0, 6);
  
  if (fortressBets.length >= 3) {
    const totalOdds = fortressBets.reduce((acc, b) => acc * b.odds, 1);
    const combinedProb = fortressBets.reduce((acc, b) => acc * (b.trueProbability / 100), 1) * 100;
    const avgRisk = fortressBets.reduce((acc, b) => acc + b.riskScore, 0) / fortressBets.length;
    combos.push({
      name: 'Kale Gibi Kupon',
      description: 'En yüksek olasılıklı, en düşük riskli bahisler. Düzenli ve güvenli kazanç hedefler.',
      strategy: 'Double Chance, Gol Var, yüksek olasılıklı Over/Under gibi düşük riskli bahislerden oluşur.',
      bets: fortressBets,
      totalOdds: Math.round(totalOdds * 100) / 100,
      combinedProbability: combinedProb,
      riskScore: avgRisk,
      riskCategory: getRiskCategory(avgRisk),
      expectedValue: totalOdds * (combinedProb / 100),
      suggestedStake: 10,
      potentialReturn: Math.round(totalOdds * 10 * 100) / 100,
      tags: ['güvenli', 'düşük-risk', 'düzenli-kazanç'],
    });
  }

  // === STRATEJI 2: AKILLI DEĞER KUPONU (Düşük-orta risk, yüksek edge) ===
  const smartValueBets = bestMediumRisk
    .filter(b => b.edge > 5 && b.odds >= 1.3 && b.odds <= 3.5)
    .sort((a, b) => (b.edge * b.trueProbability) - (a.edge * a.trueProbability))
    .slice(0, 5);

  if (smartValueBets.length >= 3) {
    const totalOdds = smartValueBets.reduce((acc, b) => acc * b.odds, 1);
    const combinedProb = smartValueBets.reduce((acc, b) => acc * (b.trueProbability / 100), 1) * 100;
    const avgRisk = smartValueBets.reduce((acc, b) => acc + b.riskScore, 0) / smartValueBets.length;
    combos.push({
      name: 'Akıllı Değer Kuponu',
      description: 'Düşük-orta risk ile yüksek edge değerine sahip bahisler. Uzun vadede en karlı strateji.',
      strategy: 'Bahisçilerin yanlış fiyatladığı, gerçek olasılığı yüksek bahisleri tespit eder.',
      bets: smartValueBets,
      totalOdds: Math.round(totalOdds * 100) / 100,
      combinedProbability: combinedProb,
      riskScore: avgRisk,
      riskCategory: getRiskCategory(avgRisk),
      expectedValue: totalOdds * (combinedProb / 100),
      suggestedStake: 5,
      potentialReturn: Math.round(totalOdds * 5 * 100) / 100,
      tags: ['değer', 'akıllı', 'uzun-vade'],
    });
  }

  // === STRATEJI 3: YÜKSEK ORANLI GÜVENLİ KUPON (Düşük riskli ama yüksek toplam oran) ===
  const highOddsSafe = bestLowRisk
    .filter(b => b.odds >= 1.25 && b.trueProbability > 55)
    .sort((a, b) => b.odds - a.odds)
    .slice(0, 5);

  if (highOddsSafe.length >= 3) {
    const totalOdds = highOddsSafe.reduce((acc, b) => acc * b.odds, 1);
    const combinedProb = highOddsSafe.reduce((acc, b) => acc * (b.trueProbability / 100), 1) * 100;
    const avgRisk = highOddsSafe.reduce((acc, b) => acc + b.riskScore, 0) / highOddsSafe.length;
    combos.push({
      name: 'Yüksek Oranlı Güvenli',
      description: 'Düşük riskli bahislerden yüksek toplam oran elde eder. Güvenli ama karlı.',
      strategy: 'Her bahis tek başına düşük riskli, ama kombinasyon yüksek oran üretir.',
      bets: highOddsSafe,
      totalOdds: Math.round(totalOdds * 100) / 100,
      combinedProbability: combinedProb,
      riskScore: avgRisk,
      riskCategory: getRiskCategory(avgRisk),
      expectedValue: totalOdds * (combinedProb / 100),
      suggestedStake: 5,
      potentialReturn: Math.round(totalOdds * 5 * 100) / 100,
      tags: ['yüksek-oran', 'güvenli', 'kombine'],
    });
  }

  // === STRATEJI 4: SİSTEM KUPONU 3/5 (Risk dağıtma) ===
  const systemBets = bestValue
    .filter(b => b.edge > 5 && b.odds >= 1.5)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 5);

  if (systemBets.length >= 4) {
    const avgOdds = systemBets.reduce((acc, b) => acc + b.odds, 0) / systemBets.length;
    const systemOdds = Math.pow(avgOdds, 3);
    const probs = systemBets.map(b => b.trueProbability / 100);
    const systemProb = calculateSystemProb(probs, 3) * 100;
    const avgRisk = systemBets.reduce((acc, b) => acc + b.riskScore, 0) / systemBets.length;
    combos.push({
      name: `Sistem Kuponu 3/${systemBets.length}`,
      description: `${systemBets.length} bahisten 3'ünün tutması yeterli. Kayıp riski minimize edilir.`,
      strategy: 'Tüm bacaklar tutmasa bile kazanç sağlar. Risk dağıtma stratejisi.',
      bets: systemBets,
      totalOdds: Math.round(systemOdds * 100) / 100,
      combinedProbability: systemProb,
      riskScore: Math.max(0, avgRisk - 15),
      riskCategory: getRiskCategory(Math.max(0, avgRisk - 15)),
      expectedValue: systemOdds * (systemProb / 100),
      suggestedStake: 3,
      potentialReturn: Math.round(systemOdds * 3 * 100) / 100,
      tags: ['sistem', 'risk-dağıtma', 'güvenli'],
    });
  }

  // === STRATEJI 5: YÜKSEK ORANLI FIRSAT KUPONU ===
  const opportunityBets = bestHighOdds
    .filter(b => b.edge > 3 && b.odds >= 2.0)
    .sort((a, b) => (b.edge * b.odds) - (a.edge * a.odds))
    .slice(0, 4);

  if (opportunityBets.length >= 2) {
    const totalOdds = opportunityBets.reduce((acc, b) => acc * b.odds, 1);
    const combinedProb = opportunityBets.reduce((acc, b) => acc * (b.trueProbability / 100), 1) * 100;
    const avgRisk = opportunityBets.reduce((acc, b) => acc + b.riskScore, 0) / opportunityBets.length;
    combos.push({
      name: 'Fırsat Kuponu',
      description: 'Yüksek oranlarla büyük kazanç potansiyeli. Edge pozitif, risk kontrollü.',
      strategy: 'Bahisçilerin yanlış fiyatladığı yüksek oranlı bahisleri kombine eder.',
      bets: opportunityBets,
      totalOdds: Math.round(totalOdds * 100) / 100,
      combinedProbability: combinedProb,
      riskScore: avgRisk,
      riskCategory: getRiskCategory(avgRisk),
      expectedValue: totalOdds * (combinedProb / 100),
      suggestedStake: 2,
      potentialReturn: Math.round(totalOdds * 2 * 100) / 100,
      tags: ['yüksek-oran', 'fırsat', 'büyük-kazanç'],
    });
  }

  // === STRATEJI 6: MİKRO KUPON (Çok yüksek oran, küçük yatırım) ===
  const microBets = allSmartBets
    .filter(b => b.odds >= 3.0 && b.edge > 10)
    .sort((a, b) => b.edge - a.edge);
  
  // Her maçtan max 1 tane
  const microUnique = new Map<number, SmartBet>();
  microBets.forEach(b => {
    if (!microUnique.has(b.gameId)) microUnique.set(b.gameId, b);
  });
  const microList = Array.from(microUnique.values()).slice(0, 3);

  if (microList.length >= 2) {
    const totalOdds = microList.reduce((acc, b) => acc * b.odds, 1);
    const combinedProb = microList.reduce((acc, b) => acc * (b.trueProbability / 100), 1) * 100;
    const avgRisk = microList.reduce((acc, b) => acc + b.riskScore, 0) / microList.length;
    combos.push({
      name: 'Mikro Kupon',
      description: 'Çok yüksek oranlarla küçük yatırım, büyük dönüş. Günlük 1 birim yatırım stratejisi.',
      strategy: 'Yüksek edge\'li yüksek oranlı bahisleri kombine eder. Küçük yatırım, büyük potansiyel.',
      bets: microList,
      totalOdds: Math.round(totalOdds * 100) / 100,
      combinedProbability: combinedProb,
      riskScore: avgRisk,
      riskCategory: getRiskCategory(avgRisk),
      expectedValue: totalOdds * (combinedProb / 100),
      suggestedStake: 1,
      potentialReturn: Math.round(totalOdds * 1 * 100) / 100,
      tags: ['mikro', 'yüksek-oran', 'küçük-yatırım'],
    });
  }

  // EV (Expected Value) sırasına göre sırala
  return combos.sort((a, b) => b.expectedValue - a.expectedValue);
}

function calculateSystemProb(probs: number[], minWins: number): number {
  const n = probs.length;
  let totalProb = 0;

  function getCombinations(arr: number[], k: number): number[][] {
    if (k === 0) return [[]];
    if (arr.length === 0) return [];
    const [first, ...rest] = arr;
    const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = getCombinations(rest, k);
    return [...withFirst, ...withoutFirst];
  }

  for (let wins = minWins; wins <= n; wins++) {
    const combos = getCombinations(Array.from({ length: n }, (_, i) => i), wins);
    combos.forEach(winIndices => {
      let prob = 1;
      for (let i = 0; i < n; i++) {
        if (winIndices.includes(i)) prob *= probs[i];
        else prob *= (1 - probs[i]);
      }
      totalProb += prob;
    });
  }

  return Math.min(1, totalProb);
}

// ===== OYUNCU TAHMİN SONUÇ DEĞERLENDİRME =====
export function evaluatePlayerPropResult(
  betName: string,
  selection: string,
  game: Game,
  events: GameEvent[]
): 'won' | 'lost' | 'void' | 'pending' {
  if (!game.scores.home && game.scores.home !== 0) return 'pending';
  
  const isFinished = ['FT', 'AET', 'AP'].includes(game.status.short);
  if (!isFinished) return 'pending';

  // Gol atan oyuncuları bul
  const goalScorers = new Set<string>();
  const firstGoalScorer = events.find(e => e.type === 'goal')?.players[0] || '';
  
  events.forEach(ev => {
    if (ev.type === 'goal') {
      ev.players.forEach(p => goalScorers.add(p.toLowerCase()));
    }
  });

  const playerName = extractPlayerName(selection, betName).toLowerCase();

  if (betName.includes('Anytime Goal Scorer')) {
    return goalScorers.has(playerName) ? 'won' : 'lost';
  }

  if (betName.includes('First Goal Scorer')) {
    return firstGoalScorer.toLowerCase() === playerName ? 'won' : 'lost';
  }

  // Diğer oyuncu bahisleri için void döndür (kesin sonuç hesaplanamaz)
  return 'void';
}
