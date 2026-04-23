'use client';

/**
 * NBA Prediction Detail — Enhanced with NBA-specific context.
 *
 * Uses /api/nba-v2/context/[gameId] to fetch:
 *   - Full v2 prediction (markets + players + ratings)
 *   - Conference standings (playoff race context)
 *   - H2H this season (head-to-head record)
 *   - Season team stats (advanced Four Factors)
 *   - Best value bets highlighted
 *   - Star matchup comparison
 */

import { useState, useEffect } from 'react';
import { V2PredictionDetail } from '@/components/sports/basketball-v2/v2-prediction-detail';

interface NbaPredictionDetailProps {
  gameId: string;
  accentColor?: string;
}

export function NbaPredictionDetail({ gameId }: NbaPredictionDetailProps) {
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const res = await fetch(`/api/nba-v2/context/${gameId}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setContext(data.data);
        } else {
          setError(data.error || 'NBA context yuklenemedi');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Baglanti hatasi');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-base font-semibold text-indigo-700 dark:text-indigo-400">
              NBA Derin Analiz
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Tahminler + standings + H2H + team stats yukleniyor...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !context) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
          <h2 className="font-bold text-red-700 dark:text-red-400 mb-2">NBA Context Hata</h2>
          <p className="text-sm text-red-600 dark:text-red-400">{error || 'Veri alinamadi'}</p>
        </div>
      </div>
    );
  }

  const p = context.prediction;
  const standings = context.standings;
  const h2h = context.headToHead;
  const valueBets = context.valueBets || [];
  const starMatchup = context.starMatchup;
  const confidence = context.confidence;

  const isHomeFav = p.markets.matchResult.predictedWinner === p.homeTeam;
  const bestPick = isHomeFav
    ? { team: p.homeTeam, prob: p.markets.matchResult.homeWinProb, odds: p.markets.matchResult.homeOdds }
    : { team: p.awayTeam, prob: p.markets.matchResult.awayWinProb, odds: p.markets.matchResult.awayOdds };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Hero Banner with NBA branding */}
      <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-purple-700 rounded-2xl p-6 text-white shadow-2xl">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest bg-white/20 px-2 py-1 rounded">
                NBA Analiz Merkezi
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded ${
                confidence.level === 'elite' ? 'bg-yellow-400 text-yellow-900' :
                confidence.level === 'high' ? 'bg-green-400 text-green-900' :
                confidence.level === 'medium' ? 'bg-blue-400 text-blue-900' :
                'bg-gray-400 text-gray-900'
              }`}>
                {confidence.level === 'elite' ? 'ELITE PICK' :
                 confidence.level === 'high' ? 'YUKSEK GUVEN' :
                 confidence.level === 'medium' ? 'ORTA GUVEN' :
                 'DUSUK GUVEN'}
              </span>
            </div>
            <h1 className="text-3xl font-bold mb-1">
              {p.homeTeam}
              <span className="text-white/60 text-xl mx-3">vs</span>
              {p.awayTeam}
            </h1>
            <p className="text-sm text-white/80">
              {new Date(p.gameDate).toLocaleString('tr-TR')}
              {context.liveGame?.arena?.name && ` | ${context.liveGame.arena.name}`}
            </p>
          </div>
          <div className="text-right min-w-[140px]">
            <div className="text-5xl font-bold">%{confidence.percentage.toFixed(1)}</div>
            <p className="text-xs text-white/80 mt-1">Guven</p>
          </div>
        </div>

        {/* Best Pick Highlighted */}
        <div className="bg-white/10 backdrop-blur rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase text-white/70 tracking-wider">Onerilen Pick</div>
          <div className="flex items-end justify-between mt-1">
            <div>
              <div className="text-2xl font-bold">{bestPick.team} Kazanir</div>
              <div className="text-xs text-white/70">
                Model: %{(bestPick.prob * 100).toFixed(1)} | Implied Odds: {bestPick.odds.toFixed(2)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-white/70 uppercase">Spread</div>
              <div className="text-xl font-bold">
                {(p.inputs.expectedHome - p.inputs.expectedAway >= 0 ? '+' : '') +
                  (p.inputs.expectedHome - p.inputs.expectedAway).toFixed(1)}
              </div>
              <div className="text-[10px] text-white/70">Total: {p.markets.totalPoints.expected.toFixed(1)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Standings Row */}
      {(standings.home || standings.away) && (
        <div className="grid md:grid-cols-2 gap-4">
          {standings.home && <StandingCard standing={standings.home} label="Ev Sahibi" />}
          {standings.away && <StandingCard standing={standings.away} label="Deplasman" />}
        </div>
      )}

      {/* H2H + Value Bets Row */}
      <div className="grid md:grid-cols-2 gap-4">
        <H2HCard h2h={h2h} homeTeam={p.homeTeam} awayTeam={p.awayTeam} />
        <ValueBetsCard valueBets={valueBets} />
      </div>

      {/* Star Matchup */}
      {starMatchup && (starMatchup.homeStar || starMatchup.awayStar) && (
        <StarMatchupCard matchup={starMatchup} homeTeam={p.homeTeam} awayTeam={p.awayTeam} />
      )}

      {/* Embed the full v2 prediction detail */}
      <div className="pt-4 border-t-2 border-indigo-200 dark:border-indigo-800">
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            Tam Prediction Detayi
          </h2>
          <p className="text-xs text-gray-500">Tier 2 v2 Engine | Bayesian + ML + Monte Carlo</p>
        </div>
        <V2PredictionDetail
          gameId={gameId}
          source="nba"
          icon={'\uD83C\uDFC0'}
          accentColor="indigo"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StandingCard({ standing, label }: { standing: any; label: string }) {
  const conf = standing.conference;
  const winPct = parseFloat(standing.win?.percentage || '0');
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md border border-gray-100 dark:border-slate-700 p-5">
      <div className="flex items-center gap-3 mb-3">
        {standing.team?.logo && (
          <img src={standing.team.logo} alt="" className="w-12 h-12 object-contain" />
        )}
        <div className="flex-1">
          <div className="text-[10px] text-gray-500 uppercase font-bold">{label}</div>
          <h3 className="font-bold text-lg text-gray-900 dark:text-white">{standing.team?.name}</h3>
          <p className="text-xs text-gray-500">
            {conf?.name} Konferans #{conf?.rank}
            {standing.division && ` | ${standing.division.name} #${standing.division.rank}`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="p-2 bg-gray-50 dark:bg-slate-700 rounded-lg text-center">
          <div className="text-[10px] text-gray-500 uppercase">W-L</div>
          <div className="text-base font-bold">
            {standing.win?.total || 0}-{standing.loss?.total || 0}
          </div>
        </div>
        <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
          <div className="text-[10px] text-gray-500 uppercase">Ev</div>
          <div className="text-base font-bold text-green-700 dark:text-green-400">
            {standing.win?.home || 0}-{standing.loss?.home || 0}
          </div>
        </div>
        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
          <div className="text-[10px] text-gray-500 uppercase">Dep</div>
          <div className="text-base font-bold text-red-700 dark:text-red-400">
            {standing.win?.away || 0}-{standing.loss?.away || 0}
          </div>
        </div>
        <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
          <div className="text-[10px] text-gray-500 uppercase">Son 10</div>
          <div className="text-base font-bold text-yellow-700 dark:text-yellow-400">
            {standing.win?.lastTen || 0}-{standing.loss?.lastTen || 0}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <span className="text-gray-500">Win %:</span>
        <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-green-500 to-emerald-500 h-full"
            style={{ width: `${winPct * 100}%` }}
          />
        </div>
        <span className="font-bold">{(winPct * 100).toFixed(1)}%</span>
      </div>
      {standing.streak !== undefined && (
        <div className="mt-2 text-xs">
          <span className="text-gray-500">Seri:</span>{' '}
          <span className={`font-bold ${standing.winStreak ? 'text-green-600' : 'text-red-600'}`}>
            {standing.winStreak ? 'G' : 'M'} {Math.abs(standing.streak)}
          </span>
        </div>
      )}
    </div>
  );
}

function H2HCard({ h2h, homeTeam, awayTeam }: { h2h: any; homeTeam: string; awayTeam: string }) {
  if (!h2h || h2h.totalGames === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md border border-gray-100 dark:border-slate-700 p-5">
        <h3 className="font-bold text-base mb-3 flex items-center gap-2">
          <span>{'\u2694'}</span>
          Kafa Kafaya Bu Sezon
        </h3>
        <p className="text-sm text-gray-500 text-center py-4">Bu sezon karsılasmalari yok.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md border border-gray-100 dark:border-slate-700 p-5">
      <h3 className="font-bold text-base mb-3 flex items-center gap-2">
        <span>{'\u2694'}</span>
        Kafa Kafaya Bu Sezon
      </h3>
      <div className="grid grid-cols-3 gap-3 text-center mb-3">
        <div>
          <div className="text-[10px] text-gray-500 uppercase">{homeTeam}</div>
          <div className="text-3xl font-bold text-green-600">{h2h.homeWins}</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 uppercase">Toplam Mac</div>
          <div className="text-3xl font-bold text-gray-600 dark:text-gray-400">
            {h2h.totalGames}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 uppercase">{awayTeam}</div>
          <div className="text-3xl font-bold text-red-600">{h2h.awayWins}</div>
        </div>
      </div>
      <div className="border-t border-gray-200 dark:border-slate-700 pt-3 text-xs text-gray-500">
        Ortalama toplam sayı: <strong className="text-blue-600">{h2h.avgTotal.toFixed(1)}</strong>
      </div>
      {h2h.lastMeeting && (
        <div className="mt-2 text-xs text-gray-500">
          Son karsılasma: {new Date(h2h.lastMeeting.date).toLocaleDateString('tr-TR')}{' '}
          <strong className="text-gray-700 dark:text-gray-300">
            {h2h.lastMeeting.homeScore}-{h2h.lastMeeting.awayScore}
          </strong>
        </div>
      )}
    </div>
  );
}

function ValueBetsCard({ valueBets }: { valueBets: any[] }) {
  return (
    <div className="bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 rounded-2xl shadow-md border border-amber-200 dark:border-amber-800 p-5">
      <h3 className="font-bold text-base mb-3 flex items-center gap-2 text-amber-900 dark:text-amber-200">
        <span>{'\uD83D\uDCB0'}</span>
        En Iyi 5 Guvenli Pick
      </h3>
      {valueBets.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">Yuksek guven pick bulunamadi.</p>
      ) : (
        <div className="space-y-2">
          {valueBets.slice(0, 5).map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2 bg-white/60 dark:bg-slate-800/60 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                  {b.pickLabel}
                </div>
                <div className="text-[10px] text-gray-500">{b.market}</div>
              </div>
              <div className="text-right ml-3">
                <div className="text-sm font-bold text-amber-700 dark:text-amber-400">
                  %{(b.modelProb * 100).toFixed(1)}
                </div>
                <div className="text-[10px] text-gray-500">@ {b.impliedOdds.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StarMatchupCard({
  matchup,
  homeTeam,
  awayTeam,
}: {
  matchup: any;
  homeTeam: string;
  awayTeam: string;
}) {
  const home = matchup.homeStar;
  const away = matchup.awayStar;
  if (!home && !away) return null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md border border-gray-100 dark:border-slate-700 p-5">
      <h3 className="font-bold text-base mb-4 flex items-center gap-2">
        <span>{'\u2B50'}</span>
        Yildiz Karsilasmasi
      </h3>
      <div className="grid md:grid-cols-2 gap-4">
        {home && <StarPlayerBadge player={home} team={homeTeam} color="green" />}
        {away && <StarPlayerBadge player={away} team={awayTeam} color="red" />}
      </div>
    </div>
  );
}

function StarPlayerBadge({ player, team, color }: { player: any; team: string; color: 'green' | 'red' }) {
  const gradient =
    color === 'green'
      ? 'from-emerald-500 to-teal-600'
      : 'from-rose-500 to-red-600';

  return (
    <div className={`bg-gradient-to-br ${gradient} text-white rounded-xl p-4 shadow-lg`}>
      <div className="text-[10px] uppercase text-white/70 font-bold">{team}</div>
      <h4 className="text-xl font-bold mb-2">{player.name}</h4>
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div>
          <div className="text-[10px] text-white/70">Sayı</div>
          <div className="text-xl font-bold">{player.projected.points.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[10px] text-white/70">Rib</div>
          <div className="text-xl font-bold">{player.projected.rebounds.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[10px] text-white/70">Ast</div>
          <div className="text-xl font-bold">{player.projected.assists.toFixed(1)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-white/10 rounded p-1">
          <div className="text-[10px] text-white/70">DD %</div>
          <div className="text-base font-bold">
            {(player.combos.doubleDoubleProb * 100).toFixed(0)}
          </div>
        </div>
        <div className="bg-white/10 rounded p-1">
          <div className="text-[10px] text-white/70">TD %</div>
          <div className="text-base font-bold">
            {(player.combos.tripleDoubleProb * 100).toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}
