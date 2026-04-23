
'use client';

import { GamesDashboard } from '@/components/sports/shared/games-dashboard';

function renderHandballScore(game: any) {
  const homeTotal = typeof game.scores?.home === 'number' ? game.scores.home : game.scores?.home?.total;
  const awayTotal = typeof game.scores?.away === 'number' ? game.scores.away : game.scores?.away?.total;
  const hasScore = homeTotal !== null && homeTotal !== undefined;

  if (!hasScore) {
    return <span className="text-2xl font-bold text-gray-300 dark:text-gray-600">vs</span>;
  }

  return (
    <div className="text-center">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{homeTotal}</span>
        <span className="text-sm text-gray-400">-</span>
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{awayTotal}</span>
      </div>
      {typeof game.scores?.home === 'object' && game.scores?.home !== null && (
        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
          <span>IY: {game.scores?.home?.half_1 ?? '-'}-{game.scores?.away?.half_1 ?? '-'}</span>
          <span>2Y: {game.scores?.home?.half_2 ?? '-'}-{game.scores?.away?.half_2 ?? '-'}</span>
          {game.scores?.home?.extra_time !== null && game.scores?.home?.extra_time !== undefined && (
            <span className="text-purple-500 font-medium">UZ: {game.scores?.home?.extra_time}-{game.scores?.away?.extra_time}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function HandballDashboard() {
  return (
    <GamesDashboard
      sport="handball"
      apiPath="/api/handball/games/today"
      predictionPath="/handball/predictions"
      title="Hentbol Tahminleri"
      icon={'\uD83E\uDD3E'}
      accentColor="purple"
      renderScore={renderHandballScore}
    />
  );
}
