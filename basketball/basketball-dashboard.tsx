
'use client';

import { GamesDashboard } from '@/components/sports/shared/games-dashboard';

function renderBasketballScore(game: any) {
  const homeTotal = game.scores?.home?.total;
  const awayTotal = game.scores?.away?.total;
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
      <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
        <span>C1: {game.scores?.home?.quarter_1 ?? '-'}</span>
        <span>C2: {game.scores?.home?.quarter_2 ?? '-'}</span>
        <span>C3: {game.scores?.home?.quarter_3 ?? '-'}</span>
        <span>C4: {game.scores?.home?.quarter_4 ?? '-'}</span>
        {game.scores?.home?.over_time !== null && game.scores?.home?.over_time !== undefined && (
          <span className="text-orange-500 font-medium">UZ: {game.scores?.home?.over_time}</span>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-gray-400">
        <span>C1: {game.scores?.away?.quarter_1 ?? '-'}</span>
        <span>C2: {game.scores?.away?.quarter_2 ?? '-'}</span>
        <span>C3: {game.scores?.away?.quarter_3 ?? '-'}</span>
        <span>C4: {game.scores?.away?.quarter_4 ?? '-'}</span>
        {game.scores?.away?.over_time !== null && game.scores?.away?.over_time !== undefined && (
          <span className="text-orange-500 font-medium">UZ: {game.scores?.away?.over_time}</span>
        )}
      </div>
    </div>
  );
}

export function BasketballDashboard() {
  return (
    <GamesDashboard
      sport="basketball"
      apiPath="/api/basketball/games/today"
      predictionPath="/basketball/predictions"
      title="Basketbol Tahminleri"
      icon={'\uD83C\uDFC0'}
      accentColor="orange"
      renderScore={renderBasketballScore}
    />
  );
}
