
'use client';

import { GamesDashboard } from '@/components/sports/shared/games-dashboard';

function renderVolleyballScore(game: any) {
  const homeTotal = typeof game.scores?.home === 'number' ? game.scores.home : game.scores?.home?.total;
  const awayTotal = typeof game.scores?.away === 'number' ? game.scores.away : game.scores?.away?.total;
  const hasScore = homeTotal !== null && homeTotal !== undefined;

  if (!hasScore) {
    return <span className="text-2xl font-bold text-gray-300 dark:text-gray-600">vs</span>;
  }

  const sets: { home: any; away: any }[] = [];
  if (typeof game.scores?.home === 'object' && game.scores?.home !== null) {
    for (let i = 1; i <= 5; i++) {
      const homeSet = game.scores?.home?.[`set_${i}`];
      const awaySet = game.scores?.away?.[`set_${i}`];
      if (homeSet !== null && homeSet !== undefined) {
        sets.push({ home: homeSet, away: awaySet });
      }
    }
  }

  return (
    <div className="text-center">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{homeTotal}</span>
        <span className="text-sm text-gray-400">-</span>
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{awayTotal}</span>
      </div>
      {sets.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
          {sets.map((set, i) => (
            <span key={i}>S{i + 1}: {set.home}-{set.away}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function VolleyballDashboard() {
  return (
    <GamesDashboard
      sport="volleyball"
      apiPath="/api/volleyball/games/today"
      predictionPath="/volleyball/predictions"
      title="Voleybol Tahminleri"
      icon={'\uD83C\uDFD0'}
      accentColor="pink"
      renderScore={renderVolleyballScore}
    />
  );
}
