
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  TrendingUp, Target, Trophy, Shield, BarChart3, 
  CheckCircle, AlertCircle, Users, Clock, Zap
} from 'lucide-react';

interface ApiPredictionsCardProps {
  apiPredictions: any;
  homeTeamName: string;
  awayTeamName: string;
}

export function ApiPredictionsCard({ 
  apiPredictions, 
  homeTeamName, 
  awayTeamName 
}: ApiPredictionsCardProps) {
  
  if (!apiPredictions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-600">
            <Target className="w-5 h-5" />
            API-Football Resmi Tahminleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <div className="text-muted-foreground mb-2">
              Bu maç için API-Football resmi tahmin verisi bulunamadı
            </div>
            <div className="text-sm text-muted-foreground">
              API-Football tüm maçlar için tahmin verisi sağlamayabilir
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!apiPredictions.predictions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-600">
            <Target className="w-5 h-5" />
            API-Football Resmi Tahminleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <div className="text-muted-foreground">
              Bu maç için tahmin verisi mevcut değil
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Enhanced prediction analysis functions
  const getConfidenceLevel = (percentage: string): { level: string; color: string; icon: React.ReactNode } => {
    const percent = parseInt(percentage?.replace('%', '') || '0');
    if (percent >= 70) return { level: 'Çok Yüksek', color: 'text-green-600', icon: <CheckCircle className="w-4 h-4" /> };
    if (percent >= 60) return { level: 'Yüksek', color: 'text-blue-600', icon: <TrendingUp className="w-4 h-4" /> };
    if (percent >= 50) return { level: 'Orta', color: 'text-yellow-600', icon: <BarChart3 className="w-4 h-4" /> };
    return { level: 'Düşük', color: 'text-red-600', icon: <AlertCircle className="w-4 h-4" /> };
  };

  const generateEnhancedGoalPredictions = () => {
    const predictions = apiPredictions.predictions;
    const comparison = apiPredictions.comparison;
    const h2h = apiPredictions.h2h;
    const enhancedPredictions = [];

    // Ana gol tahminleri - Geliştirilmiş algoritma
    const calculateGoalPredictions = () => {
      const homeGoals = parseFloat(predictions?.goals?.home) || 1.2;
      const awayGoals = parseFloat(predictions?.goals?.away) || 1.0;
      const totalGoals = homeGoals + awayGoals;
      
      // Form analizi
      const homeForm = parseFloat(comparison?.form?.home) || 50;
      const awayForm = parseFloat(comparison?.form?.away) || 50;
      const formFactor = (homeForm + awayForm) / 100;
      
      // Atak/Defans güç analizi
      const homeAttack = parseFloat(comparison?.att?.home) || 50;
      const awayAttack = parseFloat(comparison?.att?.away) || 50;
      const homeDef = parseFloat(comparison?.def?.home) || 50;
      const awayDef = parseFloat(comparison?.def?.away) || 50;
      
      const adjustedTotal = totalGoals * formFactor;
      
      return {
        total: Math.round(adjustedTotal * 10) / 10,
        home: Math.round((homeGoals * (homeAttack / 50) * (1 - awayDef / 100)) * 10) / 10,
        away: Math.round((awayGoals * (awayAttack / 50) * (1 - homeDef / 100)) * 10) / 10,
        confidence: totalGoals > 2.5 ? 'Yüksek' : 'Orta'
      };
    };

    const goalAnalysis = calculateGoalPredictions();
    
    enhancedPredictions.push({
      category: 'Gelişmiş Gol Analizi',
      items: [
        { 
          label: 'Toplam Gol Tahmini', 
          value: `${goalAnalysis.total} (${goalAnalysis.total < 2.5 ? 'Alt' : 'Üst'} 2.5)`, 
          confidence: goalAnalysis.confidence 
        },
        { 
          label: `${homeTeamName} Beklenen Gol`, 
          value: goalAnalysis.home.toString(), 
          confidence: goalAnalysis.home > 1.5 ? 'Yüksek' : 'Orta' 
        },
        { 
          label: `${awayTeamName} Beklenen Gol`, 
          value: goalAnalysis.away.toString(), 
          confidence: goalAnalysis.away > 1.5 ? 'Yüksek' : 'Orta' 
        },
        {
          label: 'İki Takım Gol',
          value: goalAnalysis.home >= 1 && goalAnalysis.away >= 1 ? 'Evet' : 'Hayır',
          confidence: goalAnalysis.home >= 1 && goalAnalysis.away >= 1 ? 'Yüksek' : 'Düşük'
        }
      ]
    });

    // İlk yarı tahminleri - Geliştirilmiş algoritma
    const calculateFirstHalfPredictions = () => {
      const homeAttack = parseFloat(comparison?.att?.home) || 50;
      const awayAttack = parseFloat(comparison?.att?.away) || 50;
      const avgAttack = (homeAttack + awayAttack) / 2;
      
      // İlk yarı genellikle toplam golün %40-45'i
      const firstHalfGoals = goalAnalysis.total * 0.425;
      const firstHalfHome = goalAnalysis.home * 0.4;
      const firstHalfAway = goalAnalysis.away * 0.4;
      
      return {
        total: Math.round(firstHalfGoals * 10) / 10,
        home: Math.round(firstHalfHome * 10) / 10,
        away: Math.round(firstHalfAway * 10) / 10,
        probability: avgAttack > 60 ? 'Yüksek' : avgAttack > 45 ? 'Orta' : 'Düşük'
      };
    };

    const firstHalfAnalysis = calculateFirstHalfPredictions();
    
    enhancedPredictions.push({
      category: 'İlk Yarı Detaylı Analiz',
      items: [
        { 
          label: 'İlk Yarı Toplam Gol', 
          value: `${firstHalfAnalysis.total} (${firstHalfAnalysis.total > 1.5 ? 'Üst' : 'Alt'} 1.5)`, 
          confidence: firstHalfAnalysis.probability 
        },
        { 
          label: 'İlk Yarı İlk Gol', 
          value: firstHalfAnalysis.home > firstHalfAnalysis.away ? homeTeamName : 
                 firstHalfAnalysis.away > firstHalfAnalysis.home ? awayTeamName : 'Eşit Şans', 
          confidence: Math.abs(firstHalfAnalysis.home - firstHalfAnalysis.away) > 0.3 ? 'Yüksek' : 'Orta' 
        },
        {
          label: 'İlk 15 Dk Gol',
          value: firstHalfAnalysis.total > 1.2 ? 'Var' : 'Yok',
          confidence: firstHalfAnalysis.total > 1.2 ? 'Yüksek' : 'Düşük'
        }
      ]
    });

    // Korner ve kart tahminleri - Gelişmiş algoritma
    const calculateSpecialEvents = () => {
      const homeAttack = parseFloat(comparison?.att?.home) || 50;
      const awayAttack = parseFloat(comparison?.att?.away) || 50;
      const totalAttack = homeAttack + awayAttack;
      
      // Korner tahmini
      const expectedCorners = Math.round((totalAttack / 10) + (goalAnalysis.total * 2));
      
      // Kart tahmini - daha agresif takımlar daha fazla kart alır
      const homeAggression = 100 - parseFloat(comparison?.def?.home || 70);
      const awayAggression = 100 - parseFloat(comparison?.def?.away || 70);
      const expectedCards = Math.round(((homeAggression + awayAggression) / 25) + 2);
      
      return {
        corners: expectedCorners,
        cards: expectedCards,
        cornerConfidence: totalAttack > 80 ? 'Yüksek' : 'Orta',
        cardConfidence: expectedCards > 4 ? 'Yüksek' : 'Orta'
      };
    };

    const specialEvents = calculateSpecialEvents();
    
    enhancedPredictions.push({
      category: 'Korner & Kart Analizi',
      items: [
        { 
          label: 'Toplam Korner', 
          value: `${specialEvents.corners}-${specialEvents.corners + 2}`, 
          confidence: specialEvents.cornerConfidence 
        },
        { 
          label: 'İlk Korner', 
          value: 'İlk 8 dk', 
          confidence: 'Yüksek' 
        },
        { 
          label: 'Toplam Kart', 
          value: `${specialEvents.cards}-${specialEvents.cards + 1}`, 
          confidence: specialEvents.cardConfidence 
        },
        {
          label: 'Her Takım Kart',
          value: specialEvents.cards > 3 ? 'Evet' : 'Hayır',
          confidence: specialEvents.cards > 3 ? 'Yüksek' : 'Orta'
        }
      ]
    });

    // Risk analizi ve öneriler
    const calculateRiskAnalysis = () => {
      const homeWinProb = parseInt(predictions?.percent?.home?.replace('%', '') || '33');
      const awayWinProb = parseInt(predictions?.percent?.away?.replace('%', '') || '33');
      const drawProb = parseInt(predictions?.percent?.draw?.replace('%', '') || '33');
      
      const recommendations = [];
      
      if (homeWinProb > 60) {
        recommendations.push({ 
          label: `${homeTeamName} Kazanır`, 
          value: 'ÖNERİLİR', 
          confidence: 'Yüksek' 
        });
      }
      
      if (goalAnalysis.total > 2.5) {
        recommendations.push({ 
          label: 'Üst 2.5 Gol', 
          value: 'ÖNERİLİR', 
          confidence: 'Yüksek' 
        });
      }
      
      if (goalAnalysis.home >= 1 && goalAnalysis.away >= 1) {
        recommendations.push({ 
          label: 'İki Takım Gol Atar', 
          value: 'ÖNERİLİR', 
          confidence: 'Yüksek' 
        });
      }
      
      return recommendations;
    };

    const riskRecommendations = calculateRiskAnalysis();
    
    if (riskRecommendations.length > 0) {
      enhancedPredictions.push({
        category: 'Akıllı Bahis Önerileri',
        items: riskRecommendations
      });
    }

    return enhancedPredictions;
  };

  const getPercentageFromFraction = (fraction: string): number => {
    if (!fraction || fraction === 'N/A') return 0;
    try {
      const [numerator, denominator] = fraction.split('/').map(Number);
      return Math.round((numerator / denominator) * 100);
    } catch {
      return 0;
    }
  };

  const predictions = apiPredictions.predictions;
  const teams = apiPredictions.teams;
  const comparison = apiPredictions.comparison;
  const h2h = apiPredictions.h2h;

  // Get enhanced predictions
  const enhancedPredictions = generateEnhancedGoalPredictions();

  return (
    <div className="space-y-6">
      {/* Main Winner Prediction with Enhanced Display */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-600">
            <Target className="w-5 h-5" />
            API-Football Resmi Tahminleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          {predictions?.winner && (
            <div className="mb-6">
              <div className="text-center">
                <div className="text-lg font-semibold mb-2">Kazanan Tahmini</div>
                <div className="text-3xl font-bold text-orange-600 mb-2">
                  {predictions.winner.name === homeTeamName ? homeTeamName : 
                   predictions.winner.name === awayTeamName ? awayTeamName : 
                   'Beraberlik'}
                </div>
                <div className="text-sm text-muted-foreground">
                  Güven: {predictions.winner.comment || 'Orta'}
                </div>
              </div>
            </div>
          )}

          {/* Match Winner Percentages with Visual Enhancement */}
          {predictions?.percent && (
            <div className="mb-6">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {predictions.percent.home || '0%'}
                  </div>
                  <div className="text-sm text-muted-foreground">{homeTeamName}</div>
                  <Progress 
                    value={parseInt(predictions.percent.home?.replace('%', '') || '0')} 
                    className="mt-2 h-2"
                  />
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-600">
                    {predictions.percent.draw || '0%'}
                  </div>
                  <div className="text-sm text-muted-foreground">Beraberlik</div>
                  <Progress 
                    value={parseInt(predictions.percent.draw?.replace('%', '') || '0')} 
                    className="mt-2 h-2"
                  />
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {predictions.percent.away || '0%'}
                  </div>
                  <div className="text-sm text-muted-foreground">{awayTeamName}</div>
                  <Progress 
                    value={parseInt(predictions.percent.away?.replace('%', '') || '0')} 
                    className="mt-2 h-2"
                  />
                </div>
              </div>
              
              {/* Confidence Level Display */}
              <div className="text-center">
                <div className="inline-flex items-center gap-2 bg-muted px-3 py-1 rounded-full">
                  {getConfidenceLevel(predictions.percent.home || '0%').icon}
                  <span className={`font-medium ${getConfidenceLevel(predictions.percent.home || '0%').color}`}>
                    Güven Seviyesi: {getConfidenceLevel(predictions.percent.home || '0%').level}
                  </span>
                </div>
              </div>
            </div>
          )}

          <Separator className="mb-6" />
        </CardContent>
      </Card>

      {/* Enhanced Predictions Categories */}
      {enhancedPredictions.map((category, categoryIndex) => (
        <Card key={categoryIndex}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              {category.category}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {category.items.map((item, itemIndex) => (
                <div key={itemIndex} className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-sm">{item.label}</span>
                    <Badge variant={item.confidence === 'Çok Yüksek' ? 'default' : 
                                  item.confidence === 'Yüksek' ? 'secondary' : 'outline'}>
                      {item.confidence}
                    </Badge>
                  </div>
                  <div className="text-lg font-bold text-orange-600">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Original API Predictions with Better Formatting */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Detaylı API Tahminleri
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Goals Predictions */}
            {predictions?.goals && (
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4" />
                  Gol Tahminleri
                </h4>
                <div className="space-y-3">
                  {predictions.goals.total && (
                    <div className="flex justify-between items-center p-2 bg-blue-50 rounded">
                      <span>Toplam Gol:</span>
                      <Badge variant="default">
                        {predictions.goals.total}
                      </Badge>
                    </div>
                  )}
                  {predictions.goals.home && (
                    <div className="flex justify-between items-center p-2 bg-green-50 rounded">
                      <span>{homeTeamName}:</span>
                      <Badge variant="secondary">
                        {predictions.goals.home}
                      </Badge>
                    </div>
                  )}
                  {predictions.goals.away && (
                    <div className="flex justify-between items-center p-2 bg-red-50 rounded">
                      <span>{awayTeamName}:</span>
                      <Badge variant="outline">
                        {predictions.goals.away}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Under/Over */}
            {predictions?.under_over && (
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Alt/Üst Tahminleri
                </h4>
                <div className="space-y-3">
                  {typeof predictions.under_over === 'string' ? (
                    <div className="flex justify-between items-center p-2 bg-yellow-50 rounded">
                      <span>Tahmin:</span>
                      <Badge variant="default">
                        {predictions.under_over.startsWith('-') ? 
                          `Alt ${Math.abs(parseFloat(predictions.under_over))}` : 
                          `Üst ${predictions.under_over}`
                        }
                      </Badge>
                    </div>
                  ) : predictions.under_over && typeof predictions.under_over === 'object' ? (
                    <>
                      {predictions.under_over.under && (
                        <div className="flex justify-between items-center p-2 bg-blue-50 rounded">
                          <span>Alt 2.5:</span>
                          <Badge variant="secondary">
                            {predictions.under_over.under}
                          </Badge>
                        </div>
                      )}
                      {predictions.under_over.over && (
                        <div className="flex justify-between items-center p-2 bg-red-50 rounded">
                          <span>Üst 2.5:</span>
                          <Badge variant="outline">
                            {predictions.under_over.over}
                          </Badge>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {/* Both Teams Score */}
            {predictions?.btts && (
              <div className="space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  İki Takım Gol
                </h4>
                <div className="space-y-3">
                  {predictions.btts?.yes && (
                    <div className="flex justify-between items-center p-2 bg-green-50 rounded">
                      <span>Evet:</span>
                      <Badge variant="default">
                        {predictions.btts.yes}
                      </Badge>
                    </div>
                  )}
                  {predictions.btts?.no && (
                    <div className="flex justify-between items-center p-2 bg-red-50 rounded">
                      <span>Hayır:</span>
                      <Badge variant="secondary">
                        {predictions.btts.no}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Team Comparison with Visual Analytics */}
      {comparison && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Detaylı Takım Karşılaştırması
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Performance Bars */}
              <div className="space-y-4">
                {[
                  { label: 'Form', homeValue: comparison.form?.home, awayValue: comparison.form?.away },
                  { label: 'Atak Gücü', homeValue: comparison.att?.home, awayValue: comparison.att?.away },
                  { label: 'Defans Gücü', homeValue: comparison.def?.home, awayValue: comparison.def?.away },
                  { label: 'Gol Ortalaması', homeValue: comparison.goals?.home, awayValue: comparison.goals?.away },
                  { label: 'Toplam Güç', homeValue: comparison.total?.home, awayValue: comparison.total?.away }
                ].map((stat, index) => {
                  const homeVal = parseFloat(stat.homeValue) || 0;
                  const awayVal = parseFloat(stat.awayValue) || 0;
                  const maxVal = Math.max(homeVal, awayVal);
                  const homePercentage = maxVal > 0 ? (homeVal / maxVal) * 100 : 0;
                  const awayPercentage = maxVal > 0 ? (awayVal / maxVal) * 100 : 0;
                  
                  return (
                    <div key={index} className="space-y-2">
                      <div className="flex justify-between text-sm font-medium">
                        <span>{stat.label}</span>
                        <span className="text-muted-foreground">
                          {homeVal > awayVal ? `${homeTeamName} Üstün` : awayVal > homeVal ? `${awayTeamName} Üstün` : 'Eşit'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-right space-y-1">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs">{homeTeamName}</span>
                            <Badge variant={homeVal > awayVal ? 'default' : 'outline'}>
                              {stat.homeValue || 'N/A'}
                            </Badge>
                          </div>
                          <Progress value={homePercentage} className="h-2" />
                        </div>
                        <div className="text-left space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={awayVal > homeVal ? 'default' : 'outline'}>
                              {stat.awayValue || 'N/A'}
                            </Badge>
                            <span className="text-xs">{awayTeamName}</span>
                          </div>
                          <Progress value={awayPercentage} className="h-2" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Advantage Analysis */}
              <div className="mt-6 p-4 bg-muted/30 rounded-lg">
                <h5 className="font-semibold mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Avantaj Analizi
                </h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium text-blue-600 mb-2">{homeTeamName} Avantajları</div>
                    <div className="space-y-1">
                      {parseFloat(comparison.form?.home || '0') > parseFloat(comparison.form?.away || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Daha iyi form</span>
                        </div>
                      )}
                      {parseFloat(comparison.att?.home || '0') > parseFloat(comparison.att?.away || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Güçlü atak</span>
                        </div>
                      )}
                      {parseFloat(comparison.def?.home || '0') > parseFloat(comparison.def?.away || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Sağlam defans</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        <span>Ev sahibi avantajı</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-red-600 mb-2">{awayTeamName} Avantajları</div>
                    <div className="space-y-1">
                      {parseFloat(comparison.form?.away || '0') > parseFloat(comparison.form?.home || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Daha iyi form</span>
                        </div>
                      )}
                      {parseFloat(comparison.att?.away || '0') > parseFloat(comparison.att?.home || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Güçlü atak</span>
                        </div>
                      )}
                      {parseFloat(comparison.def?.away || '0') > parseFloat(comparison.def?.home || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Sağlam defans</span>
                        </div>
                      )}
                      {parseFloat(comparison.goals?.away || '0') > parseFloat(comparison.goals?.home || '0') && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Yüksek gol ortalaması</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enhanced Head to Head Analysis */}
      {h2h && h2h.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Son Karşılaşmalar & H2H Analizi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* H2H Summary Statistics */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
                {(() => {
                  let homeWins = 0, awayWins = 0, draws = 0;
                  let totalHomeGoals = 0, totalAwayGoals = 0;
                  
                  h2h.slice(0, 10).forEach((match: any) => {
                    if (match.goals.home > match.goals.away) {
                      if (match.teams.home.name === homeTeamName) homeWins++;
                      else awayWins++;
                    } else if (match.goals.home < match.goals.away) {
                      if (match.teams.away.name === homeTeamName) homeWins++;
                      else awayWins++;
                    } else {
                      draws++;
                    }
                    totalHomeGoals += match.goals.home;
                    totalAwayGoals += match.goals.away;
                  });
                  
                  const totalMatches = Math.min(h2h.length, 10);
                  const avgTotalGoals = totalMatches > 0 ? ((totalHomeGoals + totalAwayGoals) / totalMatches).toFixed(1) : '0';
                  
                  return (
                    <>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{homeWins}</div>
                        <div className="text-sm text-muted-foreground">{homeTeamName}</div>
                        <div className="text-xs mt-1">
                          %{totalMatches > 0 ? Math.round((homeWins/totalMatches)*100) : 0}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-600">{draws}</div>
                        <div className="text-sm text-muted-foreground">Beraberlik</div>
                        <div className="text-xs mt-1">
                          %{totalMatches > 0 ? Math.round((draws/totalMatches)*100) : 0}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{awayWins}</div>
                        <div className="text-sm text-muted-foreground">{awayTeamName}</div>
                        <div className="text-xs mt-1">
                          %{totalMatches > 0 ? Math.round((awayWins/totalMatches)*100) : 0}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
              
              {/* Additional H2H Statistics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(() => {
                  let over25Games = 0, under25Games = 0;
                  let bttsGames = 0;
                  let totalMatches = Math.min(h2h.length, 10);
                  
                  h2h.slice(0, 10).forEach((match: any) => {
                    const totalGoals = match.goals.home + match.goals.away;
                    if (totalGoals > 2.5) over25Games++;
                    else under25Games++;
                    
                    if (match.goals.home > 0 && match.goals.away > 0) bttsGames++;
                  });
                  
                  return (
                    <>
                      <div className="text-center p-3 bg-blue-50 rounded">
                        <div className="font-bold">%{totalMatches > 0 ? Math.round((over25Games/totalMatches)*100) : 0}</div>
                        <div className="text-xs text-muted-foreground">Üst 2.5</div>
                      </div>
                      <div className="text-center p-3 bg-red-50 rounded">
                        <div className="font-bold">%{totalMatches > 0 ? Math.round((under25Games/totalMatches)*100) : 0}</div>
                        <div className="text-xs text-muted-foreground">Alt 2.5</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded">
                        <div className="font-bold">%{totalMatches > 0 ? Math.round((bttsGames/totalMatches)*100) : 0}</div>
                        <div className="text-xs text-muted-foreground">BTTS</div>
                      </div>
                      <div className="text-center p-3 bg-yellow-50 rounded">
                        <div className="font-bold">
                          {(() => {
                            const total = h2h.slice(0, 10).reduce((sum: number, match: any) => 
                              sum + match.goals.home + match.goals.away, 0);
                            return totalMatches > 0 ? (total / totalMatches).toFixed(1) : '0';
                          })()}
                        </div>
                        <div className="text-xs text-muted-foreground">Ort. Gol</div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Recent Matches */}
              <div>
                <h5 className="font-semibold mb-3">Son 5 Karşılaşma</h5>
                <div className="space-y-3">
                  {h2h.slice(0, 5).map((match: any, index: number) => {
                    const isHomeWin = match.goals.home > match.goals.away;
                    const isAwayWin = match.goals.home < match.goals.away;
                    const isDraw = match.goals.home === match.goals.away;
                    const totalGoals = match.goals.home + match.goals.away;
                    const isBtts = match.goals.home > 0 && match.goals.away > 0;
                    
                    return (
                      <div key={index} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg hover:bg-muted/70 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="text-sm">
                            <div className="font-medium">
                              {match.teams.home.name} vs {match.teams.away.name}
                            </div>
                            <div className="text-muted-foreground">
                              {new Date(match.fixture.date).toLocaleDateString('tr-TR')}
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="font-bold text-lg mb-1">
                            {match.goals.home} - {match.goals.away}
                          </div>
                          <div className="flex gap-1 justify-end">
                            <Badge variant={totalGoals > 2.5 ? 'default' : 'outline'} className="text-xs">
                              {totalGoals > 2.5 ? 'Ü2.5' : 'A2.5'}
                            </Badge>
                            <Badge variant={isBtts ? 'default' : 'outline'} className="text-xs">
                              {isBtts ? 'BTTS' : 'No BTTS'}
                            </Badge>
                            <Badge 
                              variant={isDraw ? 'secondary' : 'default'} 
                              className={`text-xs ${isHomeWin ? 'bg-blue-100 text-blue-800' : 
                                         isAwayWin ? 'bg-red-100 text-red-800' : ''}`}
                            >
                              {isDraw ? 'X' : isHomeWin ? 'H' : 'A'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* League Info */}
      {apiPredictions.league && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              Lig Bilgileri
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <img 
                src={apiPredictions.league.logo} 
                alt={apiPredictions.league.name}
                className="w-12 h-12 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div>
                <div className="font-semibold">{apiPredictions.league.name}</div>
                <div className="text-sm text-muted-foreground">
                  Sezon: {apiPredictions.league.season}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
