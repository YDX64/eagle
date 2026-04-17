import 'dotenv/config';
import { ApiFootballService } from '../lib/api-football';
import { AdvancedPredictionEngine } from '../lib/advanced-prediction-engine';

interface RiskRow {
  fixtureId: number;
  kickoffUtc: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  recommendationTitle: string;
  description: string;
  confidence: number;
  reason: string;
  recommendation: string;
}

// Basic in-memory cache to avoid repeated API calls per league/team
const fixturesByLeagueCache = new Map<string, any>();
const standingsCache = new Map<string, any>();
const teamStatsCache = new Map<string, any>();
const h2hCache = new Map<string, any>();

const originalGetFixturesByLeague = ApiFootballService.getFixturesByLeague.bind(ApiFootballService);
const originalGetStandings = ApiFootballService.getStandings.bind(ApiFootballService);
const originalGetTeamStatistics = ApiFootballService.getTeamStatistics.bind(ApiFootballService);
const originalGetHeadToHead = ApiFootballService.getHeadToHead.bind(ApiFootballService);

(ApiFootballService as any).getFixturesByLeague = async (league: number, season: number, status?: string) => {
  const key = `${league}-${season}-${status ?? 'all'}`;
  if (!fixturesByLeagueCache.has(key)) {
    fixturesByLeagueCache.set(key, await originalGetFixturesByLeague(league, season, status));
  }
  return fixturesByLeagueCache.get(key);
};

(ApiFootballService as any).getStandings = async (league: number, season: number) => {
  const key = `${league}-${season}`;
  if (!standingsCache.has(key)) {
    standingsCache.set(key, await originalGetStandings(league, season));
  }
  return standingsCache.get(key);
};

(ApiFootballService as any).getTeamStatistics = async (league: number, season: number, team: number) => {
  const key = `${league}-${season}-${team}`;
  if (!teamStatsCache.has(key)) {
    teamStatsCache.set(key, await originalGetTeamStatistics(league, season, team));
  }
  return teamStatsCache.get(key);
};

(ApiFootballService as any).getHeadToHead = async (h2h: string) => {
  if (!h2hCache.has(h2h)) {
    h2hCache.set(h2h, await originalGetHeadToHead(h2h));
  }
  return h2hCache.get(h2h);
};

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const date = process.argv[2] || '2025-09-28';

  if (!process.env.AWASTATS_API_KEY && !process.env.API_FOOTBALL_KEY) {
    throw new Error('AWASTATS_API_KEY is not set');
  }

  console.error(`Fetching fixtures for ${date}...`);
  const fixtures = await ApiFootballService.getFixturesByDate(date);

  if (!fixtures || fixtures.length === 0) {
    console.log(JSON.stringify({ date, matches: [], note: 'No fixtures found for date' }, null, 2));
    return;
  }

  const rows: RiskRow[] = [];

  for (const fixture of fixtures) {
    const { fixture: fixtureInfo, league, teams } = fixture;
    const kickoffUtc = fixtureInfo.date;
    const leagueLabel = `${league.name} (${league.country})`;

    try {
      console.error(`Analyzing fixture ${fixtureInfo.id} - ${teams.home.name} vs ${teams.away.name}`);
      const advancedPrediction = await AdvancedPredictionEngine.generateAdvancedPrediction(
        teams.home.id,
        teams.away.id,
        league.id,
        league.season,
        fixtureInfo.id
      );

      const highConfidence = advancedPrediction.risk_analysis.high_confidence_bets;

      if (!highConfidence || highConfidence.length === 0) {
        rows.push({
          fixtureId: fixtureInfo.id,
          kickoffUtc,
          league: leagueLabel,
          homeTeam: teams.home.name,
          awayTeam: teams.away.name,
          recommendationTitle: 'Yüksek güvenli öneri yok',
          description: '-',
          confidence: 0,
          reason: 'Model bu maç için güvenli öneri üretmedi',
          recommendation: 'Orta risk seçeneklerini değerlendirin'
        });
      } else {
        for (const bet of highConfidence) {
          rows.push({
            fixtureId: fixtureInfo.id,
            kickoffUtc,
            league: leagueLabel,
            homeTeam: teams.home.name,
            awayTeam: teams.away.name,
            recommendationTitle: bet.title,
            description: bet.description,
            confidence: bet.confidence,
            reason: bet.reason,
            recommendation: bet.recommendation
          });
        }
      }

      // Respect API rate limits lightly
      await delay(200);
    } catch (error) {
      console.error(`Failed to analyze fixture ${fixtureInfo.id}:`, error);
      rows.push({
        fixtureId: fixtureInfo.id,
        kickoffUtc,
        league: leagueLabel,
        homeTeam: teams.home.name,
        awayTeam: teams.away.name,
        recommendationTitle: 'Analiz hata verdi',
        description: '-',
        confidence: 0,
        reason: error instanceof Error ? error.message : 'Bilinmeyen hata',
        recommendation: 'Maçı manuel inceleyin'
      });
    }
  }

  console.log(JSON.stringify({ date, matches: rows }, null, 2));
}

main().catch(error => {
  console.error('Fatal error while generating risk report:', error);
  process.exitCode = 1;
});
