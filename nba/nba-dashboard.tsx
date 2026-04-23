'use client';

/**
 * NBA-specific Dashboard
 *
 * Uses the shared GamesDashboard with NBA-v2 API endpoint + custom score
 * renderer that shows quarter-by-quarter linescores (which the NBA api
 * provides but basketball-api does not).
 */

import { GamesDashboard } from '@/components/sports/shared/games-dashboard';

function renderNbaScore(game: any) {
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
        <span>Q1: {game.scores?.home?.quarter_1 ?? '-'}</span>
        <span>Q2: {game.scores?.home?.quarter_2 ?? '-'}</span>
        <span>Q3: {game.scores?.home?.quarter_3 ?? '-'}</span>
        <span>Q4: {game.scores?.home?.quarter_4 ?? '-'}</span>
        {game.scores?.home?.over_time !== null && game.scores?.home?.over_time !== undefined && (
          <span className="text-orange-500 font-medium">OT: {game.scores?.home?.over_time}</span>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-gray-400">
        <span>Q1: {game.scores?.away?.quarter_1 ?? '-'}</span>
        <span>Q2: {game.scores?.away?.quarter_2 ?? '-'}</span>
        <span>Q3: {game.scores?.away?.quarter_3 ?? '-'}</span>
        <span>Q4: {game.scores?.away?.quarter_4 ?? '-'}</span>
        {game.scores?.away?.over_time !== null && game.scores?.away?.over_time !== undefined && (
          <span className="text-orange-500 font-medium">OT: {game.scores?.away?.over_time}</span>
        )}
      </div>
    </div>
  );
}

export function NbaDashboard() {
  return (
    <GamesDashboard
      sport="basketball"
      apiPath="/api/nba-v2/games/today"
      predictionPath="/nba/predictions"
      title="NBA Analiz Merkezi"
      icon={'\uD83C\uDFC0'}
      accentColor="purple"
      renderScore={renderNbaScore}
    />
  );
}
