
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MatchPrediction } from '@/lib/prediction-engine';
import { Target, TrendingUp, Activity, Users, BarChart3 } from 'lucide-react';

interface PredictionCardProps {
  prediction: MatchPrediction;
  homeTeamName: string;
  awayTeamName: string;
}

export function PredictionCard({ prediction, homeTeamName, awayTeamName }: PredictionCardProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.7) return 'text-green-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.7) return <Badge className="bg-green-100 text-green-800">High</Badge>;
    if (confidence >= 0.5) return <Badge className="bg-yellow-100 text-yellow-800">Medium</Badge>;
    return <Badge className="bg-red-100 text-red-800">Low</Badge>;
  };

  const formatProbability = (prob: number) => `${(prob * 100).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      {/* Match Winner Prediction */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="w-5 h-5" />
            Match Winner Prediction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-2xl font-bold mb-2">
              {prediction.match_winner.prediction === 'home' && homeTeamName}
              {prediction.match_winner.prediction === 'away' && awayTeamName}
              {prediction.match_winner.prediction === 'draw' && 'Draw'}
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className={`font-medium ${getConfidenceColor(prediction.match_winner.confidence)}`}>
                {formatProbability(prediction.match_winner.confidence)} Confidence
              </span>
              {getConfidenceBadge(prediction.match_winner.confidence)}
            </div>
          </div>
          
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{homeTeamName}</span>
                <span>{formatProbability(prediction.match_winner.home_probability)}</span>
              </div>
              <Progress value={prediction.match_winner.home_probability * 100} className="h-2" />
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Draw</span>
                <span>{formatProbability(prediction.match_winner.draw_probability)}</span>
              </div>
              <Progress value={prediction.match_winner.draw_probability * 100} className="h-2" />
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{awayTeamName}</span>
                <span>{formatProbability(prediction.match_winner.away_probability)}</span>
              </div>
              <Progress value={prediction.match_winner.away_probability * 100} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Additional Predictions */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Both Teams Score */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4" />
              Both Teams Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-xl font-bold mb-1">
                {prediction.both_teams_score.prediction.toUpperCase()}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatProbability(prediction.both_teams_score.confidence)} confidence
              </div>
            </div>
          </CardContent>
        </Card>

        {/* First Half Goals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4" />
              First Half Goals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-center">
                <div className="text-lg font-bold mb-1">
                  {prediction.first_half_goals.prediction.toUpperCase()} Goals in 1st Half
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatProbability(prediction.first_half_goals.confidence)} confidence
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-center p-2 bg-muted rounded">
                  <div className="font-medium">{homeTeamName}</div>
                  <div className="text-primary">{formatProbability(prediction.first_half_goals.home_first_half_probability)}</div>
                </div>
                <div className="text-center p-2 bg-muted rounded">
                  <div className="font-medium">{awayTeamName}</div>
                  <div className="text-primary">{formatProbability(prediction.first_half_goals.away_first_half_probability)}</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-center">
                  <span className="text-muted-foreground">Over 0.5:</span>
                  <span className="ml-1 font-medium">{formatProbability(prediction.first_half_goals.over_0_5_probability)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground">Over 1.5:</span>
                  <span className="ml-1 font-medium">{formatProbability(prediction.first_half_goals.over_1_5_probability)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Over/Under Goals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="w-4 h-4" />
              Goals O/U {prediction.over_under_goals.threshold}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="text-xl font-bold mb-1">
                {prediction.over_under_goals.prediction.toUpperCase()}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatProbability(prediction.over_under_goals.confidence)} confidence
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analysis Factors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="w-5 h-5" />
            Analysis Factors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Form Analysis */}
          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Team Form (Last {prediction.factors.home_form.recent_matches} matches)
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium">{homeTeamName}</div>
                <div className="space-y-1">
                  <div>W: {prediction.factors.home_form.wins}, D: {prediction.factors.home_form.draws}, L: {prediction.factors.home_form.losses}</div>
                  <div>Goals: {prediction.factors.home_form.goals_for}-{prediction.factors.home_form.goals_against}</div>
                  <div>Form Score: {(prediction.factors.home_form.form_score * 100).toFixed(1)}%</div>
                </div>
              </div>
              <div>
                <div className="font-medium">{awayTeamName}</div>
                <div className="space-y-1">
                  <div>W: {prediction.factors.away_form.wins}, D: {prediction.factors.away_form.draws}, L: {prediction.factors.away_form.losses}</div>
                  <div>Goals: {prediction.factors.away_form.goals_for}-{prediction.factors.away_form.goals_against}</div>
                  <div>Form Score: {(prediction.factors.away_form.form_score * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Head to Head */}
          {prediction.factors.head_to_head.total_matches > 0 && (
            <div>
              <h4 className="font-medium mb-2">Head-to-Head Record</h4>
              <div className="text-sm">
                <div>Total Matches: {prediction.factors.head_to_head.total_matches}</div>
                <div>{homeTeamName}: {prediction.factors.head_to_head.home_team_wins}, {awayTeamName}: {prediction.factors.head_to_head.away_team_wins}, Draws: {prediction.factors.head_to_head.draws}</div>
              </div>
            </div>
          )}

          {/* League Position */}
          {prediction.factors.league_standings.home_position > 0 && (
            <div>
              <h4 className="font-medium mb-2">League Position</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>{homeTeamName}: {prediction.factors.league_standings.home_position}th</div>
                <div>{awayTeamName}: {prediction.factors.league_standings.away_position}th</div>
              </div>
            </div>
          )}

          {/* Goal Analysis */}
          <div>
            <h4 className="font-medium mb-2">Goal Analysis</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium">{homeTeamName}</div>
                <div>Avg Goals For: {prediction.factors.goal_analysis.home_avg_goals_for.toFixed(1)}</div>
                <div>Avg Goals Against: {prediction.factors.goal_analysis.home_avg_goals_against.toFixed(1)}</div>
              </div>
              <div>
                <div className="font-medium">{awayTeamName}</div>
                <div>Avg Goals For: {prediction.factors.goal_analysis.away_avg_goals_for.toFixed(1)}</div>
                <div>Avg Goals Against: {prediction.factors.goal_analysis.away_avg_goals_against.toFixed(1)}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
