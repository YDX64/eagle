import type { Fixture, Standing } from '@/lib/api-football';
import type { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import type { PredictionApiData } from '@/lib/types';

interface TeamFormSummary {
  recent_matches?: number;
  wins?: number;
  draws?: number;
  losses?: number;
}

interface PredictionMetadata {
  homeForm?: TeamFormSummary | null;
  awayForm?: TeamFormSummary | null;
  homeStanding?: Standing | null;
  awayStanding?: Standing | null;
  [key: string]: unknown;
}

export type PredictionApiResponse = PredictionApiData;

export interface TeamDisplayData {
  name: string;
  logo: string;
  position: string;
  form: string[];
}

export interface PredictionStat {
  name: string;
  value: number;
  isHigh?: boolean;
  isMedium?: boolean;
  isHighlighted?: boolean;
}

export interface PredictionSegment {
  score: { home: number; away: number };
  odds: {
    home: { value: number; percentage: number };
    draw: { value: number; percentage: number };
    away: { value: number; percentage: number };
  };
  mainPrediction: string;
  stats: PredictionStat[];
}

export interface BettingPredictionData {
  matchData: {
    league: string;
    date: string;
    time: string;
    homeTeam: TeamDisplayData;
    awayTeam: TeamDisplayData;
  };
  predictions: {
    firstHalf: PredictionSegment;
    fullTime: PredictionSegment;
    banko: {
      value: number;
      prediction: string;
      source: string;
    };
    cardCorner: {
      card: { prediction: string; value: number };
      corner: { prediction: string; value: number };
    };
  };
}

const DEFAULT_FORM = Array(5).fill('draw');

const roundPercentage = (value?: number | null): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
};

export const probabilityToOdds = (probability?: number | null): number => {
  if (!probability || probability <= 0) {
    return 0;
  }
  const decimal = 100 / probability;
  return Math.round(decimal * 100) / 100;
};

const formatOrdinal = (value?: number | null): string => {
  if (!value || value <= 0) {
    return 'N/A';
  }

  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  const v = value % 100;
  const suffix = suffixes[v] ?? suffixes[v % 10] ?? 'th';
  return `${value}${suffix}`;
};

export const getConfidenceColor = (confidence: number): 'success' | 'warning' | 'error' => {
  if (confidence >= 70) {
    return 'success';
  }
  if (confidence >= 50) {
    return 'warning';
  }
  return 'error';
};

export const extractTeamPosition = (standing?: Standing | null): string => {
  if (!standing) {
    return '—';
  }
  return formatOrdinal(standing.rank);
};

export const formatFormArray = (
  formString?: string | null,
  fallback?: TeamFormSummary | null
): string[] => {
  if (formString && formString.trim().length > 0) {
    const normalized = formString
      .toUpperCase()
      .replace(/[^WDL]/g, '')
      .slice(-5);
    if (normalized.length > 0) {
      return normalized.split('').map((char) => {
        if (char === 'W') return 'win';
        if (char === 'L') return 'loss';
        return 'draw';
      });
    }
  }

  if (fallback) {
    const results: string[] = [];
    const wins = Math.max(0, Math.min(5, Math.floor(fallback.wins ?? 0)));
    const draws = Math.max(0, Math.min(5 - results.length, Math.floor(fallback.draws ?? 0)));
    const losses = Math.max(0, Math.min(5 - results.length - draws, Math.floor(fallback.losses ?? 0)));

    for (let i = 0; i < wins && results.length < 5; i += 1) {
      results.push('win');
    }
    for (let i = 0; i < draws && results.length < 5; i += 1) {
      results.push('draw');
    }
    for (let i = 0; i < losses && results.length < 5; i += 1) {
      results.push('loss');
    }

    while (results.length < 5) {
      results.push('draw');
    }

    return results;
  }

  return DEFAULT_FORM.slice();
};

const buildTeamDisplay = (
  team: Fixture['teams']['home'],
  standing?: Standing | null,
  form?: TeamFormSummary | null
): TeamDisplayData => ({
  name: team?.name ?? 'Unknown Team',
  logo: team?.logo ?? '',
  position: extractTeamPosition(standing),
  form: formatFormArray(standing?.form, form)
});

const formatMatchDate = (fixture?: Fixture['fixture']): { date: string; time: string } => {
  const iso = fixture?.date;
  if (!iso) {
    return { date: '—', time: '—' };
  }

  const date = new Date(iso);

  const dateStr = date
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
    .replaceAll('/', '-');

  const timeStr = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const weekday = date
    .toLocaleDateString('en-US', {
      weekday: 'long'
    })
    .toUpperCase();

  const timezoneSuffix = fixture?.timezone ? ` ${fixture.timezone}` : '';

  return {
    date: dateStr,
    time: `${timeStr} ${weekday}${timezoneSuffix}`.trim()
  };
};

const determineOutcomeLabel = (
  home: number,
  draw: number,
  away: number,
  score?: { home: number; away: number }
): '1' | 'X' | '2' => {
  // If we have actual score, use it as primary indicator
  // CRITICAL: Score takes absolute priority to prevent display bugs
  if (score !== undefined && score !== null) {
    if (score.home > score.away) {
      return '1';
    }
    if (score.away > score.home) {
      return '2';
    }
    // Score is a draw (e.g., 0-0, 1-1) - ALWAYS return 'X' for equal scores
    return 'X';
  }

  // Fallback to probabilities only if no score available
  // Use threshold to avoid calling draws as wins when probabilities are close
  const threshold = 8; // Increased threshold to 8% for clearer distinction

  // Normalize probabilities to percentages if needed
  const total = home + draw + away;
  const normalizedHome = total > 0 ? (home / total) * 100 : 0;
  const normalizedDraw = total > 0 ? (draw / total) * 100 : 0;
  const normalizedAway = total > 0 ? (away / total) * 100 : 0;

  // Find the maximum probability
  const maxProb = Math.max(normalizedHome, normalizedDraw, normalizedAway);

  // Only predict a winner if there's a clear margin over others
  if (normalizedHome === maxProb && normalizedHome - normalizedDraw > threshold && normalizedHome - normalizedAway > threshold) {
    return '1';
  }
  if (normalizedAway === maxProb && normalizedAway - normalizedDraw > threshold && normalizedAway - normalizedHome > threshold) {
    return '2';
  }
  // Default to draw if probabilities are close or draw has highest probability
  return 'X';
};

const estimateFirstHalfScore = (
  halftime?: { home_win?: number; draw?: number; away_win?: number },
  fullTimeScore?: { home: number; away: number }
): { home: number; away: number } => {
  // Default to 0-0 if no full-time score data
  if (!fullTimeScore) {
    return { home: 0, away: 0 };
  }

  const totalFTGoals = fullTimeScore.home + fullTimeScore.away;

  // CRITICAL: If full time is 0-0, halftime MUST be 0-0
  // This prevents impossible scenarios where first-half has goals but full-time doesn't
  if (totalFTGoals === 0) {
    return { home: 0, away: 0 };
  }

  // CRITICAL: If full time is 1-0 or 0-1, first half cannot have more than 1 goal total
  // Conservative estimation: use roughly 40-50% of full-time goals for first half
  // This is statistically more accurate than 50% for low-scoring games
  const estimationRatio = totalFTGoals <= 2 ? 0.4 : 0.5;

  let htScore = {
    home: Math.floor(fullTimeScore.home * estimationRatio),
    away: Math.floor(fullTimeScore.away * estimationRatio)
  };

  // REMOVED: Probability-based adjustments that could create impossible scenarios
  // The score should be based solely on the full-time score, not probabilities
  // Probabilities are for outcome prediction, not score calculation

  // Final safety check: ensure first-half score never exceeds full-time score
  htScore.home = Math.min(htScore.home, fullTimeScore.home);
  htScore.away = Math.min(htScore.away, fullTimeScore.away);

  return htScore;
};

const parseScoreString = (score?: string | null): { home: number; away: number } => {
  if (!score) {
    return { home: 0, away: 0 };
  }
  const [home, away] = score.split('-').map((value) => Number.parseInt(value, 10));
  if (Number.isNaN(home) || Number.isNaN(away)) {
    return { home: 0, away: 0 };
  }
  return { home, away };
};

/**
 * Validates prediction segment consistency to prevent impossible scenarios
 * CRITICAL: Ensures display data is logically consistent
 */
const validatePredictionSegment = (segment: PredictionSegment): PredictionSegment => {
  const { score, mainPrediction } = segment;

  // Validation Rule 1: If score is 0-0, mainPrediction MUST be 'X' (draw)
  if (score.home === 0 && score.away === 0 && mainPrediction !== 'X') {
    console.warn(
      '[mui-data-mapper] Invalid state detected: 0-0 score with non-draw prediction. Correcting to X.',
      { score, mainPrediction }
    );
    return {
      ...segment,
      mainPrediction: 'X'
    };
  }

  // Validation Rule 2: If score shows a winner, mainPrediction should match
  if (score.home > score.away && mainPrediction !== '1') {
    console.warn(
      '[mui-data-mapper] Inconsistent prediction: home winning score but prediction is not "1". Correcting.',
      { score, mainPrediction }
    );
    return {
      ...segment,
      mainPrediction: '1'
    };
  }

  if (score.away > score.home && mainPrediction !== '2') {
    console.warn(
      '[mui-data-mapper] Inconsistent prediction: away winning score but prediction is not "2". Correcting.',
      { score, mainPrediction }
    );
    return {
      ...segment,
      mainPrediction: '2'
    };
  }

  // Validation Rule 3: Equal scores should be draw
  if (score.home === score.away && mainPrediction !== 'X') {
    console.warn(
      '[mui-data-mapper] Inconsistent prediction: equal score but prediction is not "X". Correcting.',
      { score, mainPrediction }
    );
    return {
      ...segment,
      mainPrediction: 'X'
    };
  }

  return segment;
};

const decorateStat = (name: string, value?: number | null, highlight = false): PredictionStat => {
  const percentage = roundPercentage(value);
  return {
    name,
    value: percentage,
    isHigh: percentage >= 70,
    isMedium: percentage >= 50 && percentage < 70,
    isHighlighted: highlight
  };
};

export const mapMatchHeader = (
  response: PredictionApiResponse
): BettingPredictionData['matchData'] => {
  const { match, metadata } = response;
  const league = match?.league?.name ? match.league.name.toUpperCase() : 'MATCH';
  const { date, time } = formatMatchDate(match?.fixture);

  return {
    league,
    date,
    time,
    homeTeam: buildTeamDisplay(match?.teams?.home, metadata.homeStanding, metadata.homeForm),
    awayTeam: buildTeamDisplay(match?.teams?.away, metadata.awayStanding, metadata.awayForm)
  };
};

const computeTwoToThreeGoalsProbability = (prediction: AdvancedMatchPrediction): number => {
  const under3 = prediction.total_goals.under_3_5?.probability ?? 0;
  const under1 = prediction.total_goals.under_1_5?.probability ?? 0;
  const value = under3 - under1;
  return Math.max(0, value);
};

export const mapPredictionData = (
  prediction: AdvancedMatchPrediction
): BettingPredictionData['predictions'] => {
  if (!prediction) {
    throw new Error('Prediction data is missing or invalid');
  }
  
  const mainScore = prediction.exact_scores?.[0]?.score;
  const fullTimeScore = parseScoreString(mainScore);

  const halftime = prediction.halftime_result ?? { home_win: 0, draw: 0, away_win: 0 };
  const firstHalfScore = estimateFirstHalfScore(halftime, fullTimeScore);

  const firstHalfStats: PredictionStat[] = [
    decorateStat('[Over 0.5]', prediction.first_half_goals?.over_0_5?.probability, true),
    decorateStat('[Over 1.5]', prediction.first_half_goals?.over_1_5?.probability),
    decorateStat('[Under 1.5]', 100 - (prediction.first_half_goals?.over_1_5?.probability ?? 0)),
    decorateStat('Home Scores', prediction.first_half_goals?.home_team_score?.probability),
    decorateStat('Away Scores', prediction.first_half_goals?.away_team_score?.probability),
    decorateStat('[BTTS Yes]', prediction.first_half_goals?.both_teams_score?.probability)
  ];

  const fullTimeStats: PredictionStat[] = [
    decorateStat('[Over 0.5]', prediction.total_goals?.over_0_5?.probability, true),
    decorateStat('[Over 1.5]', prediction.total_goals?.over_1_5?.probability),
    decorateStat('[Under 2.5]', prediction.total_goals?.under_2_5?.probability),
    decorateStat('[Under 3.5]', prediction.total_goals?.under_3_5?.probability),
    decorateStat('[BTTS Yes]', prediction.both_teams_score?.probability),
    decorateStat('[2-3 Goals]', computeTwoToThreeGoalsProbability(prediction))
  ];

  const firstHalfOdds = {
    home: {
      percentage: roundPercentage(halftime.home_win),
      value: probabilityToOdds(halftime.home_win)
    },
    draw: {
      percentage: roundPercentage(halftime.draw),
      value: probabilityToOdds(halftime.draw)
    },
    away: {
      percentage: roundPercentage(halftime.away_win),
      value: probabilityToOdds(halftime.away_win)
    }
  };

  const matchResult = prediction.match_result;

  const fullTimeOdds = {
    home: {
      percentage: roundPercentage(matchResult?.home_win?.probability),
      value: matchResult?.home_win?.odds ?? probabilityToOdds(matchResult?.home_win?.probability)
    },
    draw: {
      percentage: roundPercentage(matchResult?.draw?.probability),
      value: matchResult?.draw?.odds ?? probabilityToOdds(matchResult?.draw?.probability)
    },
    away: {
      percentage: roundPercentage(matchResult?.away_win?.probability),
      value: matchResult?.away_win?.odds ?? probabilityToOdds(matchResult?.away_win?.probability)
    }
  };

  const firstHalfPrediction: PredictionSegment = {
    score: firstHalfScore,
    odds: firstHalfOdds,
    mainPrediction: determineOutcomeLabel(
      halftime.home_win ?? 0,
      halftime.draw ?? 0,
      halftime.away_win ?? 0,
      firstHalfScore
    ),
    stats: firstHalfStats
  };

  const fullTimePrediction: PredictionSegment = {
    score: fullTimeScore,
    odds: fullTimeOdds,
    mainPrediction: determineOutcomeLabel(
      matchResult?.home_win?.probability ?? 0,
      matchResult?.draw?.probability ?? 0,
      matchResult?.away_win?.probability ?? 0,
      fullTimeScore
    ),
    stats: fullTimeStats
  };

  // CRITICAL: Validate both segments to prevent impossible display states
  // This ensures 0-0 scores show as draws, not winners
  return {
    firstHalf: validatePredictionSegment(firstHalfPrediction),
    fullTime: validatePredictionSegment(fullTimePrediction),
    banko: mapBankerPrediction(prediction),
    cardCorner: mapCardCornerPredictions(prediction)
  };
};

export const mapBankerPrediction = (
  prediction: AdvancedMatchPrediction
): BettingPredictionData['predictions']['banko'] => {
  const pools = [
    { entries: prediction.risk_analysis?.high_confidence_bets ?? [], priority: 3 },
    { entries: prediction.risk_analysis?.medium_risk_bets ?? [], priority: 2 },
    { entries: prediction.risk_analysis?.high_risk_bets ?? [], priority: 1 }
  ];

  const best = pools
    .flatMap(({ entries, priority }) =>
      entries.map((entry) => ({ ...entry, priority }))
    )
    .sort((a, b) => {
      const diff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (diff !== 0) {
        return diff;
      }
      return (b.priority ?? 0) - (a.priority ?? 0);
    })[0];

  const fallbackConfidence = roundPercentage(prediction.prediction_confidence ?? prediction.match_result?.confidence);

  return {
    value: roundPercentage(best?.confidence ?? fallbackConfidence),
    prediction: best?.title ?? 'Model Confidence',
    source: best?.recommendation ? 'risk analysis' : 'ava-football.ai'
  };
};

export const mapCardCornerPredictions = (
  prediction: AdvancedMatchPrediction
): BettingPredictionData['predictions']['cardCorner'] => {
  const cardOptions = [
    { label: 'Total Cards: Over 3.5', value: prediction.cards?.total_over_3_5 },
    { label: 'Total Cards: Over 4.5', value: prediction.cards?.total_over_4_5 },
    { label: 'Total Cards: Under 3.5', value: prediction.cards?.total_under_3_5 },
    { label: 'Total Cards: Under 4.5', value: prediction.cards?.total_under_4_5 }
  ];

  const cornerOptions = [
    { label: 'Total Corners: Over 8.5', value: prediction.corners?.total_over_8_5 },
    { label: 'Total Corners: Over 9.5', value: prediction.corners?.total_over_9_5 },
    { label: 'Total Corners: Under 8.5', value: prediction.corners?.total_under_8_5 },
    { label: 'Total Corners: Under 9.5', value: prediction.corners?.total_under_9_5 }
  ];

  const bestCard = cardOptions
    .filter((option) => typeof option.value === 'number')
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];

  const bestCorner = cornerOptions
    .filter((option) => typeof option.value === 'number')
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];

  return {
    card: {
      prediction: bestCard?.label ?? 'Total Cards: Over 3.5',
      value: roundPercentage(bestCard?.value)
    },
    corner: {
      prediction: bestCorner?.label ?? 'Total Corners: Over 8.5',
      value: roundPercentage(bestCorner?.value)
    }
  };
};

export const transformApiResponseToMuiData = (
  response: PredictionApiResponse
): BettingPredictionData => {
  const advancedPrediction = response.sourceSnapshots?.advancedPrediction;
  
  if (!advancedPrediction) {
    throw new Error('Advanced prediction data is not available in the response');
  }
  
  return {
    matchData: mapMatchHeader(response),
    predictions: mapPredictionData(advancedPrediction)
  };
};

