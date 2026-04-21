
'use client';

import { GamesDashboard } from '@/components/sports/shared/games-dashboard';

function renderHockeyScore(game: any) {
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
          <span>P1: {game.scores?.home?.period_1 ?? '-'}-{game.scores?.away?.period_1 ?? '-'}</span>
          <span>P2: {game.scores?.home?.period_2 ?? '-'}-{game.scores?.away?.period_2 ?? '-'}</span>
          <span>P3: {game.scores?.home?.period_3 ?? '-'}-{game.scores?.away?.period_3 ?? '-'}</span>
          {game.scores?.home?.overtime !== null && game.scores?.home?.overtime !== undefined && (
            <span className="text-blue-500 font-medium">UZ: {game.scores?.home?.overtime}-{game.scores?.away?.overtime}</span>
          )}
          {game.scores?.home?.penalties !== null && game.scores?.home?.penalties !== undefined && (
            <span className="text-red-500 font-medium">P: {game.scores?.home?.penalties}-{game.scores?.away?.penalties}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function HockeyDashboard() {
  return (
    <GamesDashboard
      sport="hockey"
      apiPath="/api/hockey/games/today"
      predictionPath="/hockey/predictions"
      title="Buz Hokeyi Tahminleri"
      icon={'\uD83C\uDFD2'}
      accentColor="blue"
      renderScore={renderHockeyScore}
    />
  );
}
