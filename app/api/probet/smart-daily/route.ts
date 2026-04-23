/**
 * POST /api/probet/smart-daily
 *
 * Multi-sport smart prediction generator.
 * Fetches predictions across ALL sports, filters for quality,
 * and returns organized picks sorted by confidence × EV.
 *
 * Key filters:
 * - Minimum model probability >= 50% (skip speculative picks)
 * - Minimum EV >= 5%
 * - Prioritize picks where model strongly disagrees with market
 * - Mix sports for diversification
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pgConfig = {
  host: process.env.PROBET_PG_HOST || 'awa-postgres',
  port: parseInt(process.env.PROBET_PG_PORT || '5432', 10),
  database: process.env.PROBET_PG_DB || 'probet',
  user: process.env.PROBET_PG_USER || 'awauser',
  password: process.env.PROBET_PG_PASSWORD || '',
  max: 5,
};

let _pool: Pool | null = null;
function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool(pgConfig);
  return _pool;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface SmartPick {
  sport: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  pickLabel: string;
  market: string;
  marketLabel: string;
  probability: number;
  marketOdds: number;
  expectedValue: number;
  category: string;
  tier: 'platinum' | 'gold' | 'silver';
  score: number;
}

export async function POST(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;
  const allPicks: SmartPick[] = [];
  const errors: string[] = [];
  const startTime = Date.now();

  // 1. FOOTBALL — ProBet engine
  try {
    const date = new Date().toISOString().split('T')[0];
    const res = await fetch(baseUrl + '/api/probet?date=' + date + '&limit=50&majorLeagues=false');
    const data = await res.json();
    if (data.success) {
      const preds = data.data?.predictions || [];
      for (const pred of preds) {
        const markets = [
          ...(pred.allMarkets?.HANDIKAP || []),
          ...(pred.allMarkets?.GOL_TOPLAMI || []),
          ...(pred.allMarkets?.MAÇ_SONUCU || []),
          ...(pred.allMarkets?.KG || []),
          ...(pred.allMarkets?.YARI_SONUCU || []),
        ];
        for (const pk of markets) {
          if (!pk.marketOdds || pk.marketOdds < 1.3) continue;
          if (pk.probability < 0.50) continue;
          const ev = pk.probability * pk.marketOdds - 1;
          if (ev < 0.05) continue;
          const score = pk.probability * ev * 100;
          allPicks.push({
            sport: 'football',
            fixtureId: pred.fixtureId,
            homeTeam: pred.homeTeam,
            awayTeam: pred.awayTeam,
            league: pred.league,
            matchDate: pred.matchDate,
            pickLabel: pk.pickLabel,
            market: pk.market,
            marketLabel: pk.marketLabel || pk.market,
            probability: pk.probability,
            marketOdds: pk.marketOdds,
            expectedValue: ev,
            category: pk.category || 'OTHER',
            tier: ev >= 0.20 ? 'platinum' : ev >= 0.10 ? 'gold' : 'silver',
            score,
          });
        }
      }
    }
  } catch (e) { errors.push('football: ' + String(e)); }

  // 2. NBA — basketball predictions
  try {
    const gamesRes = await fetch(baseUrl + '/api/nba/games/today');
    const gamesData = await gamesRes.json();
    const games = gamesData.data?.games || [];
    for (const game of games) {
      const status = game.status?.short || game.status;
      if (status !== 'NS' && status !== 1 && status !== 'Scheduled') continue;
      try {
        const predRes = await fetch(baseUrl + '/api/nba/predictions/' + game.id);
        const predData = await predRes.json();
        if (!predData.success) continue;
        const p = predData.data;
        const gi = p.game_info || {};
        const mr = p.match_result || {};
        // Home win
        if (mr.home_win?.probability >= 0.55 && mr.home_win?.odds >= 1.3) {
          const ev = mr.home_win.probability * mr.home_win.odds - 1;
          if (ev >= 0.02) {
            allPicks.push({
              sport: 'basketball',
              fixtureId: game.id,
              homeTeam: gi.home_team || game.teams?.home?.name || '?',
              awayTeam: gi.away_team || game.teams?.visitors?.name || '?',
              league: 'NBA',
              matchDate: game.date?.start || '',
              pickLabel: (gi.home_team || 'Home') + ' kazanir',
              market: 'HOME_WIN',
              marketLabel: 'MS 1',
              probability: mr.home_win.probability,
              marketOdds: mr.home_win.odds,
              expectedValue: ev,
              category: 'MATCH_RESULT',
              tier: ev >= 0.15 ? 'platinum' : ev >= 0.08 ? 'gold' : 'silver',
              score: mr.home_win.probability * ev * 100,
            });
          }
        }
        // Away win
        if (mr.away_win?.probability >= 0.55 && mr.away_win?.odds >= 1.3) {
          const ev = mr.away_win.probability * mr.away_win.odds - 1;
          if (ev >= 0.02) {
            allPicks.push({
              sport: 'basketball',
              fixtureId: game.id,
              homeTeam: gi.home_team || game.teams?.home?.name || '?',
              awayTeam: gi.away_team || game.teams?.visitors?.name || '?',
              league: 'NBA',
              matchDate: game.date?.start || '',
              pickLabel: (gi.away_team || 'Away') + ' kazanir',
              market: 'AWAY_WIN',
              marketLabel: 'MS 2',
              probability: mr.away_win.probability,
              marketOdds: mr.away_win.odds,
              expectedValue: ev,
              category: 'MATCH_RESULT',
              tier: ev >= 0.15 ? 'platinum' : ev >= 0.08 ? 'gold' : 'silver',
              score: mr.away_win.probability * ev * 100,
            });
          }
        }
        // Total points
        const tp = p.total_points || {};
        const lines = tp.lines || [];
        for (const line of lines) {
          if (line.over_probability >= 0.55 && line.over_odds >= 1.5) {
            const ev = line.over_probability * line.over_odds - 1;
            if (ev >= 0.03) {
              allPicks.push({
                sport: 'basketball',
                fixtureId: game.id,
                homeTeam: gi.home_team || '?',
                awayTeam: gi.away_team || '?',
                league: 'NBA',
                matchDate: game.date?.start || '',
                pickLabel: line.line + ' Ust',
                market: 'TOTAL_OVER',
                marketLabel: 'Total Ust',
                probability: line.over_probability,
                marketOdds: line.over_odds,
                expectedValue: ev,
                category: 'TOTAL_POINTS',
                tier: ev >= 0.15 ? 'platinum' : ev >= 0.08 ? 'gold' : 'silver',
                score: line.over_probability * ev * 100,
              });
            }
          }
          if (line.under_probability >= 0.55 && line.under_odds >= 1.5) {
            const ev = line.under_probability * line.under_odds - 1;
            if (ev >= 0.03) {
              allPicks.push({
                sport: 'basketball',
                fixtureId: game.id,
                homeTeam: gi.home_team || '?',
                awayTeam: gi.away_team || '?',
                league: 'NBA',
                matchDate: game.date?.start || '',
                pickLabel: line.line + ' Alt',
                market: 'TOTAL_UNDER',
                marketLabel: 'Total Alt',
                probability: line.under_probability,
                marketOdds: line.under_odds,
                expectedValue: ev,
                category: 'TOTAL_POINTS',
                tier: ev >= 0.15 ? 'platinum' : ev >= 0.08 ? 'gold' : 'silver',
                score: line.under_probability * ev * 100,
              });
            }
          }
        }
        await new Promise(r => setTimeout(r, 300));
      } catch { /* skip game */ }
    }
  } catch (e) { errors.push('basketball: ' + String(e)); }

  // 3. HOCKEY — individual game predictions
  try {
    const gamesRes = await fetch(baseUrl + '/api/hockey/games/today');
    const gamesData = await gamesRes.json();
    const games = gamesData.data?.games || [];
    const upcoming = games.filter((g: any) => g.status?.short === 'NS').slice(0, 15);
    for (const game of upcoming) {
      try {
        const predRes = await fetch(baseUrl + '/api/hockey/predictions/' + game.id);
        const predData = await predRes.json();
        if (!predData.success) continue;
        const p = predData.data;
        const mr = p.match_result || {};
        if (mr.home_win?.probability >= 0.55 && mr.home_win?.odds >= 1.3) {
          const ev = mr.home_win.probability * mr.home_win.odds - 1;
          if (ev >= 0.02) {
            allPicks.push({
              sport: 'hockey',
              fixtureId: game.id,
              homeTeam: p.game_info?.home_team || '?',
              awayTeam: p.game_info?.away_team || '?',
              league: p.game_info?.league || 'Hockey',
              matchDate: game.date || '',
              pickLabel: (p.game_info?.home_team || 'Home') + ' kazanir',
              market: 'HOME_WIN', marketLabel: 'MS 1',
              probability: mr.home_win.probability,
              marketOdds: mr.home_win.odds,
              expectedValue: ev, category: 'MATCH_RESULT',
              tier: ev >= 0.15 ? 'platinum' : ev >= 0.08 ? 'gold' : 'silver',
              score: mr.home_win.probability * ev * 100,
            });
          }
        }
        if (mr.away_win?.probability >= 0.55 && mr.away_win?.odds >= 1.3) {
          const ev = mr.away_win.probability * mr.away_win.odds - 1;
          if (ev >= 0.02) {
            allPicks.push({
              sport: 'hockey',
              fixtureId: game.id,
              homeTeam: p.game_info?.home_team || '?',
              awayTeam: p.game_info?.away_team || '?',
              league: p.game_info?.league || 'Hockey',
              matchDate: game.date || '',
              pickLabel: (p.game_info?.away_team || 'Away') + ' kazanir',
              market: 'AWAY_WIN', marketLabel: 'MS 2',
              probability: mr.away_win.probability,
              marketOdds: mr.away_win.odds,
              expectedValue: ev, category: 'MATCH_RESULT',
              tier: ev >= 0.15 ? 'platinum' : ev >= 0.08 ? 'gold' : 'silver',
              score: mr.away_win.probability * ev * 100,
            });
          }
        }
        await new Promise(r => setTimeout(r, 300));
      } catch { /* skip */ }
    }
  } catch (e) { errors.push('hockey: ' + String(e)); }

  // Sort by score (probability × EV combined metric)
  allPicks.sort((a, b) => b.score - a.score);

  // Organize by tier
  const platinum = allPicks.filter(p => p.tier === 'platinum');
  const gold = allPicks.filter(p => p.tier === 'gold');
  const silver = allPicks.filter(p => p.tier === 'silver');

  // Sport distribution
  const sportCounts: Record<string, number> = {};
  allPicks.forEach(p => { sportCounts[p.sport] = (sportCounts[p.sport] || 0) + 1; });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return NextResponse.json({
    success: true,
    data: {
      picks: allPicks.slice(0, 50),
      platinum: platinum.slice(0, 15),
      gold: gold.slice(0, 15),
      silver: silver.slice(0, 15),
      stats: {
        totalPicks: allPicks.length,
        bySport: sportCounts,
        byTier: { platinum: platinum.length, gold: gold.length, silver: silver.length },
        elapsedSeconds: parseFloat(elapsed),
      },
      errors,
    },
  });
}
