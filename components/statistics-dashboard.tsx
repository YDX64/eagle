'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TrendingUp, TrendingDown, Target, Trophy, AlertCircle, ChartBar, Users, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface StatisticsData {
  leagues?: any[];
  teams?: any[];
  predictions?: any[];
  backtest?: any;
}

export function StatisticsDashboard() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StatisticsData>({});
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    to: new Date(),
  });
  const [selectedTab, setSelectedTab] = useState('overview');
  const [progressiveMode, setProgressiveMode] = useState(false);

  const fetchStatistics = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
      });

      const [leagues, teams, predictions] = await Promise.all([
        fetch(`/api/statistics/leagues?${params}`).then(res => res.json()),
        fetch(`/api/statistics/teams?${params}`).then(res => res.json()),
        fetch(`/api/statistics/predictions?${params}`).then(res => res.json()),
      ]);

      setData({
        leagues: leagues.data || [],
        teams: teams.data || [],
        predictions: predictions.data || [],
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatistics();
  }, [dateRange]);

  const runBacktest = async () => {
    setLoading(true);
    console.log('[STATISTICS] Starting backtest with date range:', dateRange, 'Progressive:', progressiveMode);

    try {
      const requestBody = {
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
        progressive: progressiveMode,
      };

      console.log('[STATISTICS] Request body:', requestBody);

      const response = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('[STATISTICS] Response status:', response.status);
      const responseText = await response.text();
      console.log('[STATISTICS] Response text:', responseText);

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[STATISTICS] Failed to parse response:', parseError);
        throw new Error(`Invalid JSON response: ${responseText}`);
      }

      if (result.success) {
        console.log('[STATISTICS] Backtest successful, data:', result.data);
        setData(prev => ({ ...prev, backtest: result.data }));
        // Refresh statistics after backtest
        fetchStatistics();
      } else {
        console.error('[STATISTICS] Backtest failed:', result.error);
      }
    } catch (error) {
      console.error('[STATISTICS] Error running backtest:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 70) return 'text-green-600';
    if (rate >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSuccessRateBadge = (rate: number) => {
    if (rate >= 70) return 'bg-green-100 text-green-800';
    if (rate >= 50) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Range and Backtest Button */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChartBar className="w-5 h-5" />
            Tahmin Performans İstatistikleri
          </CardTitle>
          <CardDescription>
            Algoritmaların başarı oranlarını analiz edin ve geriye dönük test yapın
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex gap-2 items-end">
              <div>
                <Label htmlFor="date-from">Başlangıç Tarihi</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={format(dateRange.from, 'yyyy-MM-dd')}
                  onChange={(e) => setDateRange(prev => ({ ...prev, from: new Date(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="date-to">Bitiş Tarihi</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={format(dateRange.to, 'yyyy-MM-dd')}
                  onChange={(e) => setDateRange(prev => ({ ...prev, to: new Date(e.target.value) }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="progressive-mode"
                  checked={progressiveMode}
                  onCheckedChange={setProgressiveMode}
                />
                <Label htmlFor="progressive-mode" className="cursor-pointer">
                  Progresif Mod (Günlük Analiz)
                </Label>
              </div>
              <Button onClick={runBacktest} disabled={loading}>
                {loading ? 'Analiz Ediliyor...' : 'Backtest Çalıştır'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backtest Results */}
      {data.backtest && (
        <Card>
          <CardHeader>
            <CardTitle>Backtest Sonuçları</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold">{data.backtest.totalPredictions}</div>
                <div className="text-sm text-muted-foreground">Toplam Tahmin</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold">{data.backtest.correctPredictions}</div>
                <div className="text-sm text-muted-foreground">Doğru Tahmin</div>
              </div>
              <div className="text-center">
                <div className={`text-3xl font-bold ${getSuccessRateColor(data.backtest.successRate)}`}>
                  %{data.backtest.successRate.toFixed(1)}
                </div>
                <div className="text-sm text-muted-foreground">Başarı Oranı</div>
              </div>
            </div>

            {/* Detailed Metrics */}
            <div className="mt-6 space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Tahmin Tipi Başarıları</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Ev Sahibi Galibiyeti</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {data.backtest.detailedMetrics.homeWin.correct}/{data.backtest.detailedMetrics.homeWin.count}
                      </span>
                      <Badge className={getSuccessRateBadge(data.backtest.detailedMetrics.homeWin.rate)}>
                        %{data.backtest.detailedMetrics.homeWin.rate.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Deplasman Galibiyeti</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {data.backtest.detailedMetrics.awayWin.correct}/{data.backtest.detailedMetrics.awayWin.count}
                      </span>
                      <Badge className={getSuccessRateBadge(data.backtest.detailedMetrics.awayWin.rate)}>
                        %{data.backtest.detailedMetrics.awayWin.rate.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Beraberlik</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {data.backtest.detailedMetrics.draw.correct}/{data.backtest.detailedMetrics.draw.count}
                      </span>
                      <Badge className={getSuccessRateBadge(data.backtest.detailedMetrics.draw.rate)}>
                        %{data.backtest.detailedMetrics.draw.rate.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Güven Skoru Analizi</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Yüksek Güven (≥70%)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {data.backtest.confidenceMetrics.high.correct}/{data.backtest.confidenceMetrics.high.count}
                      </span>
                      <Badge className={getSuccessRateBadge(data.backtest.confidenceMetrics.high.rate)}>
                        %{data.backtest.confidenceMetrics.high.rate.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Orta Güven (50-70%)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {data.backtest.confidenceMetrics.medium.correct}/{data.backtest.confidenceMetrics.medium.count}
                      </span>
                      <Badge className={getSuccessRateBadge(data.backtest.confidenceMetrics.medium.rate)}>
                        %{data.backtest.confidenceMetrics.medium.rate.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Düşük Güven (&lt;50%)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {data.backtest.confidenceMetrics.low.correct}/{data.backtest.confidenceMetrics.low.count}
                      </span>
                      <Badge className={getSuccessRateBadge(data.backtest.confidenceMetrics.low.rate)}>
                        %{data.backtest.confidenceMetrics.low.rate.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              {data.backtest.roiMetrics && (
                <div>
                  <h4 className="font-semibold mb-2">ROI Analizi</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Toplam Bahis</span>
                      <span>{data.backtest.roiMetrics.totalStake.toFixed(2)} birim</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Toplam Kazanç</span>
                      <span>{data.backtest.roiMetrics.totalReturn.toFixed(2)} birim</span>
                    </div>
                    <div className="flex justify-between">
                      <span>ROI</span>
                      <span className={data.backtest.roiMetrics.roiPercentage >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {data.backtest.roiMetrics.roiPercentage >= 0 ? '+' : ''}{data.backtest.roiMetrics.roiPercentage.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistics Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="leagues">Ligler</TabsTrigger>
          <TabsTrigger value="teams">Takımlar</TabsTrigger>
          <TabsTrigger value="predictions">Tahmin Tipleri</TabsTrigger>
        </TabsList>

        <TabsContent value="leagues" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>En Başarılı Ligler</CardTitle>
              <CardDescription>
                Tahmin başarı oranına göre sıralanmış ligler
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">Yükleniyor...</div>
              ) : (
                <div className="space-y-3">
                  {data.leagues?.slice(0, 10).map((league, index) => (
                    <div key={`${league.league_id}-${league.season}`} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-semibold">#{index + 1}</div>
                        <div>
                          <div className="font-medium">{league.league_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Sezon {league.season} • {league.total} tahmin
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={league.success_rate} className="w-20" />
                        <Badge className={getSuccessRateBadge(league.success_rate)}>
                          %{league.success_rate.toFixed(1)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>En Kolay Tahmin Edilen Takımlar</CardTitle>
              <CardDescription>
                Tahmin başarı oranına göre sıralanmış takımlar
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">Yükleniyor...</div>
              ) : (
                <div className="space-y-3">
                  {data.teams?.slice(0, 10).map((team, index) => (
                    <div key={team.team_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-semibold">#{index + 1}</div>
                        <div>
                          <div className="font-medium">{team.team_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {team.total} maç tahmini
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={team.success_rate} className="w-20" />
                        <Badge className={getSuccessRateBadge(team.success_rate)}>
                          %{team.success_rate.toFixed(1)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tahmin Tipi Performansları</CardTitle>
              <CardDescription>
                Her tahmin tipinin başarı oranları
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">Yükleniyor...</div>
              ) : (
                <div className="space-y-3">
                  {data.predictions?.map((pred, index) => (
                    <div key={`${pred.prediction_type}-${pred.predicted_value}`} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-semibold">#{index + 1}</div>
                        <div>
                          <div className="font-medium">
                            {pred.prediction_type === 'match_winner' ? 'Maç Sonucu' : pred.prediction_type}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {pred.predicted_value === 'home' ? 'Ev Sahibi' :
                             pred.predicted_value === 'away' ? 'Deplasman' :
                             pred.predicted_value === 'draw' ? 'Beraberlik' : pred.predicted_value}
                            {' • '}{pred.total} tahmin
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-muted-foreground">
                          Güven: %{(pred.avg_confidence * 100).toFixed(0)}
                        </div>
                        <Progress value={pred.success_rate} className="w-20" />
                        <Badge className={getSuccessRateBadge(pred.success_rate)}>
                          %{pred.success_rate.toFixed(1)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}