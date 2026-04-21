
'use client';

import { GamesDashboard } from '@/components/sports/shared/games-dashboard';

// Transform football API response to standard game format
function transformFootballGame(match: any) {
  return {
    id: match.fixture?.id || match.id,
    status: match.fixture?.status || match.status,
    teams: match.teams,
    league: {
      ...match.league,
      // Football has country as string in league, other sports have country object
    },
    country: match.league?.country ? { name: match.league.country, flag: match.league.flag } : undefined,
    goals: match.goals,
    score: match.score,
    scores: match.scores,
    date: match.fixture?.date || match.date,
    time: match.fixture?.date ? new Date(match.fixture.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : undefined,
    timestamp: match.fixture?.timestamp || match.timestamp,
    venue: match.fixture?.venue?.name,
  };
}

function renderFootballScore(game: any) {
  const homeGoals = game.goals?.home;
  const awayGoals = game.goals?.away;
  const hasScore = homeGoals !== null && homeGoals !== undefined;

  if (!hasScore) {
    return <span className="text-2xl font-bold text-gray-300 dark:text-gray-600">vs</span>;
  }

  return (
    <div className="text-center">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{homeGoals}</span>
        <span className="text-sm text-gray-400">-</span>
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{awayGoals}</span>
      </div>
      {game.score?.halftime?.home !== null && game.score?.halftime?.home !== undefined && (
        <div className="text-[10px] text-gray-400 mt-1">
          IY: {game.score.halftime.home}-{game.score.halftime.away}
        </div>
      )}
    </div>
  );
}

export function FootballDashboard() {
  return (
    <GamesDashboard
      sport="football"
      apiPath="/api/matches/today"
      predictionPath="/predictions"
      title="Futbol Tahminleri"
      icon={'\u26BD'}
      accentColor="green"
      renderScore={renderFootballScore}
      transformGame={transformFootballGame}
    />
  );
}
