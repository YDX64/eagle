
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  TrendingUp, TrendingDown, Target, Trophy, 
  BarChart3, AlertTriangle, CheckCircle, 
  Clock, Users, Zap, Shield, Activity 
} from 'lucide-react';
import { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';

interface AdvancedPredictionCardProps {
  prediction: AdvancedMatchPrediction;
  homeTeamName: string;
  awayTeamName: string;
}

export function AdvancedPredictionCard({ 
  prediction, 
  homeTeamName, 
  awayTeamName 
}: AdvancedPredictionCardProps) {
  const [activeTab, setActiveTab] = useState('match');

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-green-600 bg-green-100';
    if (confidence >= 50) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getOddsColor = (odds: number) => {
    if (odds <= 2) return 'text-green-600 font-bold';
    if (odds <= 3) return 'text-yellow-600 font-semibold';
    return 'text-red-600';
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Gelişmiş Maç Analizi
            </CardTitle>
            <Badge className={`${getConfidenceColor(prediction.prediction_confidence)} border-0`}>
              {prediction.prediction_confidence}% Güven
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {prediction.match_result.home_win.probability}%
              </div>
              <div className="text-sm text-muted-foreground">{homeTeamName}</div>
              <div className="text-lg font-semibold text-blue-600">
                {prediction.match_result.home_win.odds}
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-600">
                {prediction.match_result.draw.probability}%
              </div>
              <div className="text-sm text-muted-foreground">Beraberlik</div>
              <div className="text-lg font-semibold text-gray-600">
                {prediction.match_result.draw.odds}
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {prediction.match_result.away_win.probability}%
              </div>
              <div className="text-sm text-muted-foreground">{awayTeamName}</div>
              <div className="text-lg font-semibold text-red-600">
                {prediction.match_result.away_win.odds}
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <Progress value={prediction.match_result.home_win.probability} className="h-2" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{homeTeamName}</span>
              <span>{awayTeamName}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Predictions */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="match">Maç</TabsTrigger>
          <TabsTrigger value="goals">Goller</TabsTrigger>
          <TabsTrigger value="scores">Skor</TabsTrigger>
          <TabsTrigger value="handicap">Handikap</TabsTrigger>
          <TabsTrigger value="specials">Korner&Kart</TabsTrigger>
          <TabsTrigger value="risk">Risk</TabsTrigger>
        </TabsList>

        {/* Match Result Tab */}
        <TabsContent value="match" className="space-y-4">
          {/* First Half Goals Section - Moved to Top */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                İlk Yarı Gol Tahminleri
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-lg font-bold text-primary">{prediction.first_half_goals.over_0_5.probability}%</div>
                    <div className="text-sm text-muted-foreground">1+ Gol</div>
                    <div className="text-xs">Oran: {prediction.first_half_goals.over_0_5.odds.toFixed(2)}</div>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-lg font-bold text-primary">{prediction.first_half_goals.over_1_5.probability}%</div>
                    <div className="text-sm text-muted-foreground">2+ Gol</div>
                    <div className="text-xs">Oran: {prediction.first_half_goals.over_1_5.odds.toFixed(2)}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{homeTeamName} Gol Atması</span>
                    <div className="text-right">
                      <Badge variant="outline">{prediction.first_half_goals.home_team_score.probability}%</Badge>
                      <div className="text-xs text-muted-foreground">Oran: {prediction.first_half_goals.home_team_score.odds.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{awayTeamName} Gol Atması</span>
                    <div className="text-right">
                      <Badge variant="outline">{prediction.first_half_goals.away_team_score.probability}%</Badge>
                      <div className="text-xs text-muted-foreground">Oran: {prediction.first_half_goals.away_team_score.odds.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Her İki Takım Gol</span>
                    <div className="text-right">
                      <Badge variant="outline">{prediction.first_half_goals.both_teams_score.probability}%</Badge>
                      <div className="text-xs text-muted-foreground">Oran: {prediction.first_half_goals.both_teams_score.odds.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  İki Takım Da Gol Atar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <div className="text-center flex-1">
                    <div className="text-2xl font-bold text-green-600">
                      {prediction.both_teams_score.probability}%
                    </div>
                    <div className="text-sm text-muted-foreground">Evet</div>
                    <div className="text-lg font-semibold">
                      {prediction.both_teams_score.odds}
                    </div>
                  </div>
                  <div className="text-center flex-1">
                    <div className="text-2xl font-bold text-red-600">
                      {100 - prediction.both_teams_score.probability}%
                    </div>
                    <div className="text-sm text-muted-foreground">Hayır</div>
                    <div className="text-lg font-semibold">
                      {(1 / ((100 - prediction.both_teams_score.probability) / 100)).toFixed(2)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  İlk Gol
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span>{homeTeamName}</span>
                    <Badge variant="outline">{prediction.first_goal.home_team}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>{awayTeamName}</span>
                    <Badge variant="outline">{prediction.first_goal.away_team}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Gol Olmaz</span>
                    <Badge variant="outline">{prediction.first_goal.no_goal}%</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader>
              <CardTitle>Devre Arası Sonucu</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-xl font-bold">{prediction.halftime_result.home_win}%</div>
                  <div className="text-sm text-muted-foreground">{homeTeamName}</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold">{prediction.halftime_result.draw}%</div>
                  <div className="text-sm text-muted-foreground">Beraberlik</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold">{prediction.halftime_result.away_win}%</div>
                  <div className="text-sm text-muted-foreground">{awayTeamName}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Goals Tab */}
        <TabsContent value="goals" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Toplam Gol (Alt/Üst)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(prediction.total_goals).map(([key, value]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="capitalize">{key.replace('_', ' ')}</span>
                      <div className="text-right">
                        <div className="font-semibold">{value.probability}%</div>
                        <div className={`text-sm ${getOddsColor(value.odds)}`}>
                          {value.odds}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Takım Golleri</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="font-semibold mb-2">{homeTeamName} Golleri</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>0.5 Üstü</span>
                        <Badge variant="outline">{prediction.home_team_goals.over_0_5}%</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>1.5 Üstü</span>
                        <Badge variant="outline">{prediction.home_team_goals.over_1_5}%</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>2.5 Üstü</span>
                        <Badge variant="outline">{prediction.home_team_goals.over_2_5}%</Badge>
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <div className="font-semibold mb-2">{awayTeamName} Golleri</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>0.5 Üstü</span>
                        <Badge variant="outline">{prediction.away_team_goals.over_0_5}%</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>1.5 Üstü</span>
                        <Badge variant="outline">{prediction.away_team_goals.over_1_5}%</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>2.5 Üstü</span>
                        <Badge variant="outline">{prediction.away_team_goals.over_2_5}%</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* First Half Goals Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-600" />
                İlk Yarı Gol Tahminleri
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Over/Under Options */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="text-2xl font-bold text-blue-600">{prediction.first_half_goals.over_0_5.probability}%</div>
                    <div className="text-sm text-muted-foreground mb-1">İlk Yarıda 1+ Gol</div>
                    <div className="text-xs text-blue-600 font-medium">Oran: {prediction.first_half_goals.over_0_5.odds.toFixed(2)}</div>
                  </div>
                  <div className="text-center p-4 bg-indigo-50 dark:bg-indigo-950/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <div className="text-2xl font-bold text-indigo-600">{prediction.first_half_goals.over_1_5.probability}%</div>
                    <div className="text-sm text-muted-foreground mb-1">İlk Yarıda 2+ Gol</div>
                    <div className="text-xs text-indigo-600 font-medium">Oran: {prediction.first_half_goals.over_1_5.odds.toFixed(2)}</div>
                  </div>
                </div>

                <Separator />

                {/* Team First Half Goals */}
                <div className="space-y-4">
                  <h4 className="font-semibold text-center">Takım Bazında İlk Yarı Gol</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                      <div className="font-semibold text-green-800 dark:text-green-200">{homeTeamName}</div>
                      <div className="text-2xl font-bold text-green-600 my-1">{prediction.first_half_goals.home_team_score.probability}%</div>
                      <div className="text-xs text-green-600">Oran: {prediction.first_half_goals.home_team_score.odds.toFixed(2)}</div>
                    </div>
                    <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                      <div className="font-semibold text-purple-800 dark:text-purple-200">Her İki Takım</div>
                      <div className="text-2xl font-bold text-purple-600 my-1">{prediction.first_half_goals.both_teams_score.probability}%</div>
                      <div className="text-xs text-purple-600">Oran: {prediction.first_half_goals.both_teams_score.odds.toFixed(2)}</div>
                    </div>
                    <div className="text-center p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                      <div className="font-semibold text-orange-800 dark:text-orange-200">{awayTeamName}</div>
                      <div className="text-2xl font-bold text-orange-600 my-1">{prediction.first_half_goals.away_team_score.probability}%</div>
                      <div className="text-xs text-orange-600">Oran: {prediction.first_half_goals.away_team_score.odds.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                {/* Analysis Note */}
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 text-sm font-medium mb-1">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                    <span>İlk Yarı Analiz Notu</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    İlk yarı tahminleri, takımların son maçlarındaki ilk yarı performansları ve 
                    genel gol ortalamaları baz alınarak hesaplanmıştır. İlk yarıda genellikle 
                    maçın %60'ı kadar gol atılır.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Exact Scores Tab */}
        <TabsContent value="scores" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-4 h-4" />
                En Olası Skorlar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {prediction.exact_scores.slice(0, 15).map((score, index) => (
                  <div key={score.score} 
                       className={`text-center p-3 rounded-lg border ${
                         index < 3 ? 'bg-green-50 border-green-200' : 
                         index < 6 ? 'bg-yellow-50 border-yellow-200' : 
                         'bg-gray-50 border-gray-200'
                       }`}>
                    <div className="font-bold text-lg">{score.score}</div>
                    <div className="text-sm text-muted-foreground">{score.probability}%</div>
                    <div className={`text-sm font-semibold ${getOddsColor(score.odds)}`}>
                      {score.odds}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Asian Handicap Tab */}
        <TabsContent value="handicap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Asya Handikap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {prediction.asian_handicap.map((handicap) => (
                  <div key={handicap.handicap} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="font-semibold">
                      {handicap.handicap > 0 ? '+' : ''}{handicap.handicap}
                    </div>
                    <div className="flex gap-6">
                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">{homeTeamName}</div>
                        <div className="font-semibold">{handicap.home_probability}%</div>
                        <div className="text-sm text-blue-600">{handicap.odds.home}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">{awayTeamName}</div>
                        <div className="font-semibold">{handicap.away_probability}%</div>
                        <div className="text-sm text-red-600">{handicap.odds.away}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Special Bets Tab */}
        <TabsContent value="specials" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Korner Tahminleri
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>8.5 Altı</span>
                    <Badge variant="outline">{prediction.corners.total_under_8_5}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>8.5 Üstü</span>
                    <Badge variant="outline">{prediction.corners.total_over_8_5}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>9.5 Altı</span>
                    <Badge variant="outline">{prediction.corners.total_under_9_5}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>9.5 Üstü</span>
                    <Badge variant="outline">{prediction.corners.total_over_9_5}%</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Kart Tahminleri
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>3.5 Altı</span>
                    <Badge variant="outline">{prediction.cards.total_under_3_5}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>3.5 Üstü</span>
                    <Badge variant="outline">{prediction.cards.total_over_3_5}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>4.5 Altı</span>
                    <Badge variant="outline">{prediction.cards.total_under_4_5}%</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>4.5 Üstü</span>
                    <Badge variant="outline">{prediction.cards.total_over_4_5}%</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Risk Analysis Tab */}
        <TabsContent value="risk" className="space-y-6">
          {/* High Confidence Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-green-600">Yüksek Güven Önerileri</h3>
              <Badge className="bg-green-100 text-green-800">En Güvenilir</Badge>
            </div>
            
            {prediction.risk_analysis.high_confidence_bets.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {prediction.risk_analysis.high_confidence_bets.map((bet, index) => (
                  <Card key={index} className="border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-950/20">
                    <CardContent className="pt-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold text-green-800 dark:text-green-200">{bet.title}</h4>
                            <p className="text-sm text-green-700 dark:text-green-300">{bet.description}</p>
                          </div>
                          <Badge className="bg-green-600 text-white font-bold">
                            %{bet.confidence}
                          </Badge>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Target className="w-4 h-4 text-green-600" />
                            <span className="text-muted-foreground">Analiz:</span>
                            <span className="text-green-800 dark:text-green-200">{bet.reason}</span>
                          </div>
                          
                          <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
                            <div className="flex items-center gap-2 text-sm font-medium text-green-800 dark:text-green-200">
                              <Zap className="w-4 h-4" />
                              <span>Öneri:</span>
                            </div>
                            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                              {bet.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-gray-50 dark:bg-gray-900/20">
                <CardContent className="pt-4 text-center">
                  <Shield className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Bu maç için yüksek güvenli bahis önerisi bulunamadı.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Orta risk kategorisindeki seçenekleri değerlendirebilirsiniz.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Medium Risk Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-yellow-600" />
              <h3 className="text-lg font-semibold text-yellow-600">Orta Risk Seçenekleri</h3>
              <Badge className="bg-yellow-100 text-yellow-800">Dikkatli Değerlendirme</Badge>
            </div>
            
            {prediction.risk_analysis.medium_risk_bets.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {prediction.risk_analysis.medium_risk_bets.map((bet, index) => (
                  <Card key={index} className="border-l-4 border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20">
                    <CardContent className="pt-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">{bet.title}</h4>
                            <p className="text-sm text-yellow-700 dark:text-yellow-300">{bet.description}</p>
                          </div>
                          <Badge className="bg-yellow-600 text-white font-bold">
                            %{bet.confidence}
                          </Badge>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <BarChart3 className="w-4 h-4 text-yellow-600" />
                            <span className="text-muted-foreground">Analiz:</span>
                            <span className="text-yellow-800 dark:text-yellow-200">{bet.reason}</span>
                          </div>
                          
                          <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                            <div className="flex items-center gap-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">
                              <AlertTriangle className="w-4 h-4" />
                              <span>Öneri:</span>
                            </div>
                            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                              {bet.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-gray-50 dark:bg-gray-900/20">
                <CardContent className="pt-4 text-center">
                  <TrendingUp className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Orta risk seviyesinde öneri bulunamadı.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* High Risk Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="text-lg font-semibold text-red-600">Yüksek Risk - Spekülatif</h3>
              <Badge className="bg-red-100 text-red-800">Sadece Küçük Bahisler</Badge>
            </div>
            
            {prediction.risk_analysis.high_risk_bets.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {prediction.risk_analysis.high_risk_bets.map((bet, index) => (
                  <Card key={index} className="border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20">
                    <CardContent className="pt-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold text-red-800 dark:text-red-200">{bet.title}</h4>
                            <p className="text-sm text-red-700 dark:text-red-300">{bet.description}</p>
                          </div>
                          <Badge className="bg-red-600 text-white font-bold">
                            %{bet.confidence}
                          </Badge>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Trophy className="w-4 h-4 text-red-600" />
                            <span className="text-muted-foreground">Analiz:</span>
                            <span className="text-red-800 dark:text-red-200">{bet.reason}</span>
                          </div>
                          
                          <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-800">
                            <div className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-200">
                              <AlertTriangle className="w-4 h-4" />
                              <span>⚠️ Uyarı:</span>
                            </div>
                            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                              {bet.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-gray-50 dark:bg-gray-900/20">
                <CardContent className="pt-4 text-center">
                  <Shield className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Yüksek risk seviyesinde öneri bulunamadı.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Analysis Factors */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Analiz Faktörleri
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Form</div>
                  <div className="text-lg font-semibold text-primary">{(prediction.analysis_factors.form_weight * 100).toFixed(0)}%</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Ev Sahibi</div>
                  <div className="text-lg font-semibold text-primary">{(prediction.analysis_factors.home_advantage_weight * 100).toFixed(0)}%</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Lig Sırası</div>
                  <div className="text-lg font-semibold text-primary">{(prediction.analysis_factors.league_position_weight * 100).toFixed(0)}%</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">H2H</div>
                  <div className="text-lg font-semibold text-primary">{(prediction.analysis_factors.head_to_head_weight * 100).toFixed(0)}%</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
