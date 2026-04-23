/**
 * GET /api/probet/iddaa-hockey
 *
 * Fetches ice hockey matches from iddaa.com JSON API and returns value picks.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const IDDAA_API = 'https://sportsbookv2.iddaa.com/sportsbook/events?st=4&type=0&version=0';

interface IddaaMatch {
  i: number;
  hn: string;
  an: string;
  d: number;
  ci: number;
  m: Array<{
    t: number;
    o: Array<{ no: number; odd: number; n: string }>;
  }>;
}

const LEAGUE_MAP: Record<number, string> = {
  5843: 'NHL',
  19221: 'Rusya KHL',
  19101: 'Rusya VHL',
  30076: 'Rusya MHL',
  20161: 'İsveç SHL',
  20131: 'Almanya DEL',
  20687: 'Uluslararası',
  24926: 'Avusturya Lig',
  26401: 'Kanada OHL',
  33531: 'Kanada WHL',
  30103: 'Çekya 1. Lig',
  30618: 'Slovakya Extra',
  69120: 'Slovakya Düşme',
  30451: 'Fransa Magnus',
  30060: 'Letonya Liga',
  30064: 'Alps Hk.Ligi',
  19002: 'ABD AHL',
  20162: 'Fin.Liiga',
  25144: 'Norveç',
  31363: 'İsveç HA',
  5742: 'Beyaz Rusya',
  24751: 'Romanya',
};

interface Recommendation {
  pick: string;
  side: 'home' | 'draw' | 'away';
  odds: number;
  fairProb: number;
  ev: number;
  tier: 'safe_favorite' | 'value' | 'high_odds' | 'draw_value';
  reason: string;
}

interface MatchPick {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  dateStockholm: string;
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
  fairProbHome: number;
  fairProbDraw: number;
  fairProbAway: number;
  recommendations: Recommendation[];
}

export async function GET(_request: NextRequest) {
  try {
    const res = await fetch(IDDAA_API, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ success: false, error: 'iddaa API error' }, { status: 502 });
    }
    const data = await res.json();
    if (!data.isSuccess || !data.data?.events) {
      return NextResponse.json({ success: false, error: 'Invalid iddaa response' }, { status: 502 });
    }

    const events: IddaaMatch[] = data.data.events;
    const picks: MatchPick[] = [];

    for (const event of events) {
      const msMarket = event.m?.find((m) => m.t === 1);
      if (!msMarket || !msMarket.o || msMarket.o.length < 2) continue;

      const oH = msMarket.o.find((x) => x.n === '1')?.odd;
      const oD = msMarket.o.find((x) => x.n === '0')?.odd;
      const oA = msMarket.o.find((x) => x.n === '2')?.odd;
      if (!oH || !oA) continue;

      const impH = 1 / oH;
      const impD = oD ? 1 / oD : 0;
      const impA = 1 / oA;
      const total = impH + impD + impA;
      const pH = impH / total;
      const pD = oD ? impD / total : 0;
      const pA = impA / total;

      const d = new Date(event.d * 1000);
      const time = d.toLocaleTimeString('sv-SE', {
        timeZone: 'Europe/Stockholm',
        hour: '2-digit',
        minute: '2-digit',
      });
      const dateStockholm = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

      const recommendations: Recommendation[] = [];

      // Safe favorite (odd 1.30-1.90)
      if (oH <= 1.90 && oH >= 1.30 && pH >= 0.38) {
        const evValue = pH * oH - 1;
        if (evValue > -0.25) {
          recommendations.push({
            pick: `${event.hn} MS1`,
            side: 'home',
            odds: oH,
            fairProb: pH,
            ev: evValue,
            tier: 'safe_favorite',
            reason: `Güvenli favori — %${(pH * 100).toFixed(0)} olasılık`,
          });
        }
      }
      if (oA <= 1.90 && oA >= 1.30 && pA >= 0.38) {
        const evValue = pA * oA - 1;
        if (evValue > -0.25) {
          recommendations.push({
            pick: `${event.an} MS2`,
            side: 'away',
            odds: oA,
            fairProb: pA,
            ev: evValue,
            tier: 'safe_favorite',
            reason: `Güvenli favori — %${(pA * 100).toFixed(0)} olasılık`,
          });
        }
      }

      // Value (odd 1.90-3.20)
      if (oH >= 1.90 && oH <= 3.20 && pH >= 0.25) {
        const evValue = pH * oH - 1;
        if (evValue > 0) {
          recommendations.push({
            pick: `${event.hn} MS1`,
            side: 'home',
            odds: oH,
            fairProb: pH,
            ev: evValue,
            tier: 'value',
            reason: `Değer — %${(pH * 100).toFixed(0)} × @${oH.toFixed(2)} = EV +${(evValue * 100).toFixed(0)}%`,
          });
        }
      }
      if (oA >= 1.90 && oA <= 3.20 && pA >= 0.25) {
        const evValue = pA * oA - 1;
        if (evValue > 0) {
          recommendations.push({
            pick: `${event.an} MS2`,
            side: 'away',
            odds: oA,
            fairProb: pA,
            ev: evValue,
            tier: 'value',
            reason: `Değer — %${(pA * 100).toFixed(0)} × @${oA.toFixed(2)} = EV +${(evValue * 100).toFixed(0)}%`,
          });
        }
      }

      // High odds (3.0+)
      if (oH >= 3.0 && pH >= 0.18) {
        const evValue = pH * oH - 1;
        recommendations.push({
          pick: `${event.hn} MS1 (sürpriz)`,
          side: 'home',
          odds: oH,
          fairProb: pH,
          ev: evValue,
          tier: 'high_odds',
          reason: `Yüksek oran — %${(pH * 100).toFixed(0)} olasılık @${oH.toFixed(2)}`,
        });
      }
      if (oA >= 3.0 && pA >= 0.18) {
        const evValue = pA * oA - 1;
        recommendations.push({
          pick: `${event.an} MS2 (sürpriz)`,
          side: 'away',
          odds: oA,
          fairProb: pA,
          ev: evValue,
          tier: 'high_odds',
          reason: `Yüksek oran — %${(pA * 100).toFixed(0)} olasılık @${oA.toFixed(2)}`,
        });
      }

      // Draw value
      if (oD && oD >= 3.20 && oD <= 4.50 && pD >= 0.18) {
        const evValue = pD * oD - 1;
        if (evValue > -0.05) {
          recommendations.push({
            pick: 'Beraberlik',
            side: 'draw',
            odds: oD,
            fairProb: pD,
            ev: evValue,
            tier: 'draw_value',
            reason: `Beraberlik — %${(pD * 100).toFixed(0)} olasılık @${oD.toFixed(2)}`,
          });
        }
      }

      if (recommendations.length === 0) continue;

      picks.push({
        matchId: event.i,
        homeTeam: event.hn,
        awayTeam: event.an,
        league: LEAGUE_MAP[event.ci] || `Lig #${event.ci}`,
        time,
        dateStockholm,
        oddsHome: oH,
        oddsDraw: oD || 0,
        oddsAway: oA,
        fairProbHome: pH,
        fairProbDraw: pD,
        fairProbAway: pA,
        recommendations,
      });
    }

    const allPicks: Array<Recommendation & { match: MatchPick }> = [];
    for (const m of picks) {
      for (const r of m.recommendations) {
        allPicks.push({ ...r, match: m });
      }
    }

    const safeFavorites = allPicks.filter((p) => p.tier === 'safe_favorite').sort((a, b) => a.odds - b.odds);
    const value = allPicks.filter((p) => p.tier === 'value').sort((a, b) => b.ev - a.ev);
    const highOdds = allPicks.filter((p) => p.tier === 'high_odds').sort((a, b) => b.fairProb - a.fairProb);
    const drawValue = allPicks.filter((p) => p.tier === 'draw_value').sort((a, b) => b.ev - a.ev);

    const coupon = [...safeFavorites.slice(0, 3), ...value.slice(0, 2)].slice(0, 5);
    const couponMinOdds = coupon.length >= 3
      ? [...coupon].sort((a, b) => a.odds - b.odds).slice(0, 3).reduce((s, p) => s * p.odds, 1)
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        totalMatches: events.length,
        matchesWithPicks: picks.length,
        totalPicks: allPicks.length,
        safeFavorites,
        value,
        highOdds,
        drawValue,
        suggestedCoupon: { picks: coupon, minOddsIfThreeWin: couponMinOdds, systemType: '3/5' },
        allMatches: picks,
      },
    });
  } catch (error) {
    console.error('[IDDAA HOCKEY]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
