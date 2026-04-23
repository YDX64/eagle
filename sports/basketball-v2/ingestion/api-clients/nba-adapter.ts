/**
 * NBA API Adapter
 *
 * Converts v2.nba.api-sports.io shapes into CanonicalGame + PlayerGameLog for
 * the basketball-v2 warehouse. The existing ApiNbaService (lib/sports/nba/api-nba.ts)
 * is reused — this adapter only does the shape mapping.
 */

import { nbaApi, type NbaGame, type NbaPlayerGameStats } from '@/lib/sports/nba/api-nba';
import type { UpsertGameInput } from '../../warehouse/games-repo';
import type { PlayerGameLog } from '../../warehouse/player-logs-repo';

/**
 * Parse minutes string "35" or "35:42" → decimal minutes.
 */
function parseMinutes(m: string | number | undefined | null): number | null {
  if (m === null || m === undefined) return null;
  if (typeof m === 'number') return m;
  if (m.includes(':')) {
    const [mm, ss] = m.split(':').map(Number);
    return mm + ss / 60;
  }
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : null;
}

/**
 * NBA game status.short is a NUMBER: 1=NS, 2=In Play, 3=Finished.
 * We convert to string codes the warehouse expects.
 */
function nbaStatusToString(short: number | undefined): string {
  switch (short) {
    case 1: return 'NS';
    case 2: return 'LIVE';
    case 3: return 'FT';
    default: return String(short ?? 'UNK');
  }
}

export function nbaGameToCanonical(game: NbaGame): UpsertGameInput {
  // Parse linescore strings to numbers
  const parseLinescore = (ls: string[] | undefined): number[] | null => {
    if (!ls) return null;
    const nums = ls.map((s) => parseInt(s || '0', 10) || 0);
    // Only store if at least one quarter has data
    return nums.some((n) => n > 0) ? nums : null;
  };

  return {
    source: 'nba',
    apiGameId: game.id,
    leagueId: 12, // NBA league_id in api-basketball is 12; v2 API doesn't have league_id, use standard
    leagueName: 'NBA',
    season: String(game.season),
    gameDate: game.date?.start || new Date().toISOString(),
    statusShort: nbaStatusToString(game.status?.short),
    statusLong: game.status?.long || null,
    homeTeamId: game.teams.home.id,
    homeTeamName: game.teams.home.name,
    homeTeamCode: game.teams.home.code,
    awayTeamId: game.teams.visitors.id,
    awayTeamName: game.teams.visitors.name,
    awayTeamCode: game.teams.visitors.code,
    homeScore: game.scores?.home?.points ?? null,
    awayScore: game.scores?.visitors?.points ?? null,
    homeLinescore: parseLinescore(game.scores?.home?.linescore),
    awayLinescore: parseLinescore(game.scores?.visitors?.linescore),
    venueName: game.arena?.name || null,
    venueCity: game.arena?.city || null,
    rawData: game,
  };
}

export function nbaPlayerStatsToLog(
  stat: NbaPlayerGameStats,
  gameId: string
): PlayerGameLog {
  return {
    source: 'nba',
    gameId,
    apiGameId: stat.game.id,
    playerId: stat.player.id,
    playerName: `${stat.player.firstname} ${stat.player.lastname}`.trim(),
    teamId: stat.team.id,
    teamName: stat.team.name,
    minutes: parseMinutes(stat.min),
    points: stat.points ?? null,
    fgm: stat.fgm ?? null,
    fga: stat.fga ?? null,
    ftm: stat.ftm ?? null,
    fta: stat.fta ?? null,
    tpm: stat.tpm ?? null,
    tpa: stat.tpa ?? null,
    offReb: stat.offReb ?? null,
    defReb: stat.defReb ?? null,
    totalReb: stat.totReb ?? null,
    assists: stat.assists ?? null,
    steals: stat.steals ?? null,
    blocks: stat.blocks ?? null,
    turnovers: stat.turnovers ?? null,
    personalFouls: stat.pFouls ?? null,
    plusMinus: (() => {
      if (!stat.plusMinus) return null;
      const n = parseFloat(stat.plusMinus);
      return Number.isFinite(n) ? n : null;
    })(),
    position: stat.pos || null,
    isStarter: null, // Not provided by API
    dnp: parseMinutes(stat.min) === 0 || stat.min === null || stat.min === undefined || stat.min === '',
  };
}

/**
 * Fetch all games for a given date from NBA API + return canonical form.
 */
export async function fetchNbaGamesByDate(date: string): Promise<UpsertGameInput[]> {
  const games = await nbaApi.getGamesByDate(date);
  return games.map(nbaGameToCanonical);
}

/**
 * Fetch all games in a season for the NBA.
 * The NBA API v2 doesn't have a direct "all games in season" endpoint, so we
 * iterate through every day of the regular season. Slow — use only for
 * backfill.
 *
 * Returns games array and player logs array in parallel.
 */
export async function fetchNbaSeasonGames(
  season: number
): Promise<{ games: UpsertGameInput[]; playerLogs: PlayerGameLog[] }> {
  // NBA regular season: mid-October → mid-April of the next year
  // Playoffs: mid-April → mid-June
  const startYear = season;
  const endYear = season + 1;
  const startDate = new Date(`${startYear}-10-01`);
  const endDate = new Date(`${endYear}-06-30`);

  const allGames: UpsertGameInput[] = [];
  const allLogs: PlayerGameLog[] = [];
  const seenGameIds = new Set<number>();

  const current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().slice(0, 10);
    try {
      const dayGames = await nbaApi.getGamesByDate(dateStr);
      for (const g of dayGames) {
        if (seenGameIds.has(g.id)) continue;
        seenGameIds.add(g.id);

        const canonical = nbaGameToCanonical(g);
        allGames.push(canonical);

        // Fetch player stats for finished games only
        if (g.status?.short === 3) {
          try {
            const stats = await nbaApi.getGamePlayerStats(g.id);
            const gameId = `nba:${g.id}`;
            for (const s of stats) {
              allLogs.push(nbaPlayerStatsToLog(s, gameId));
            }
          } catch {
            // Player stats missing — not fatal
          }
        }
      }
    } catch (err) {
      console.warn(`[nba-adapter] failed to fetch ${dateStr}:`, err);
    }
    current.setDate(current.getDate() + 1);
  }

  return { games: allGames, playerLogs: allLogs };
}
