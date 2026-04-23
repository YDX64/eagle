'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CheckCircle,
  XCircle,
  MinusCircle,
  TrendingUp,
  TrendingDown,
  Target,
  Trophy,
  ArrowLeft,
  Calendar,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Percent,
  Zap,
  Shield,
  Award,
} from 'lucide-react';

interface PredictionRecord {
  id: number;
  matchId: number;
  predictionType: string;
  predictedValue: string;
  confidenceScore: number;
  confidenceTier: string | null;
  isCorrect: boolean | null;
  actualResult: string | null;
  isHighConfidence: boolean;
  expectedValue: number | null;
  createdAt: string;
  match: {
    id: number;
    date: string;
    status: string;
    homeTeam: { id: number; name: string; logo: string | null };
    awayTeam: { id: number; name: string; logo: string | null };
    homeGoals: number | null;
    awayGoals: number | null;
    league: { id: number; name: string; logo: string | null; country: string };
  };
}

interface Summary {
  total: number;
  won: number;
  lost: number;
  pending: number;
  overallRate: number;
  typeStats: Record<string, { total: number; won: number; lost: number; pending: number; rate: number }>;
  tierStats: Record<string, { total: number; won: number; lost: number; rate: number }>;
}

export default function PredictionHistoryPage() {
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');

  const fetchHistory = async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pageNum.toString(), limit: '50' });
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (typeFilter) params.set('type', typeFilter);
      if (outcomeFilter) params.set('outcome', outcomeFilter);
      if (tierFilter) params.set('tier', tierFilter);

      const res = await fetch(`/api/predictions/history?${params}`);
      const data = await res.json();

      if (data.success) {
        setPredictions(data.data.predictions);
        setSummary(data.data.summary);
        setTotalPages(data.data.pagination.totalPages);
        setPage(pageNum);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(1);
  }, [dateFrom, dateTo, typeFilter, outcomeFilter, tierFilter]);

  const typeLabels: Record<string, string> = {
    match_winner: 'Mac Sonucu',
    ensemble: 'Ensemble (MS)',
    both_teams_score: 'Karsilikli Gol',
    over_under_goals: 'Ust/Alt 2.5',
  };

  const valueLabels: Record<string, string> = {
    home: 'Ev Sahibi',
    away: 'Deplasman',
    draw: 'Beraberlik',
    yes: 'Var',
    no: 'Yok',
    over: 'Ust 2.5',
    under: 'Alt 2.5',
  };

  const tierColors: Record<string, string> = {
    platinum: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/40',
    gold: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/40',
    silver: 'bg-gray-400/15 text-gray-600 dark:text-gray-400 border-gray-400/40',
  };

  const getOutcomeIcon = (isCorrect: boolean | null) => {
    if (isCorrect === true) return <CheckCircle className="w-5 h-5 text-emerald-500" />;
    if (isCorrect === false) return <XCircle className="w-5 h-5 text-red-500" />;
    return <MinusCircle className="w-5 h-5 text-yellow-500" />;
  };

  const getOutcomeLabel = (isCorrect: boolean | null) => {
    if (isCorrect === true) return 'KAZANDI';
    if (isCorrect === false) return 'KAYBETTI';
    return 'BEKLIYOR';
  };

  const getOutcomeBg = (isCorrect: boolean | null) => {
    if (isCorrect === true) return 'bg-emerald-500/10 border-emerald-500/30';
    if (isCorrect === false) return 'bg-red-500/10 border-red-500/30';
    return 'bg-yellow-500/10 border-yellow-500/30';
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Ana Sayfa
              </Button>
            </Link>
          </div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-primary" />
            Tahmin Performans Raporu
          </h1>
          <p className="text-muted-foreground mt-1">
            Gecmis tahminlerin detayli analizi ve basari oranlari
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-5 h-5 text-blue-500" />
                <span className="text-sm text-muted-foreground">Toplam</span>
              </div>
              <div className="text-3xl font-bold">{summary.total}</div>
              <p className="text-xs text-muted-foreground mt-1">tahmin yapildi</p>
            </CardContent>
          </Card>

          <Card className="border-emerald-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <span className="text-sm text-muted-foreground">Kazanan</span>
              </div>
              <div className="text-3xl font-bold text-emerald-600">{summary.won}</div>
              <p className="text-xs text-muted-foreground mt-1">dogru tahmin</p>
            </CardContent>
          </Card>

          <Card className="border-red-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-5 h-5 text-red-500" />
                <span className="text-sm text-muted-foreground">Kaybeden</span>
              </div>
              <div className="text-3xl font-bold text-red-600">{summary.lost}</div>
              <p className="text-xs text-muted-foreground mt-1">yanlis tahmin</p>
            </CardContent>
          </Card>

          <Card className="border-yellow-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <MinusCircle className="w-5 h-5 text-yellow-500" />
                <span className="text-sm text-muted-foreground">Bekleyen</span>
              </div>
              <div className="text-3xl font-bold text-yellow-600">{summary.pending}</div>
              <p className="text-xs text-muted-foreground mt-1">sonuc bekleniyor</p>
            </CardContent>
          </Card>

          <Card className={summary.overallRate >= 55 ? 'border-emerald-500/30' : summary.overallRate >= 45 ? 'border-yellow-500/30' : 'border-red-500/30'}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Percent className="w-5 h-5 text-primary" />
                <span className="text-sm text-muted-foreground">Basari</span>
              </div>
              <div className={`text-3xl font-bold ${summary.overallRate >= 55 ? 'text-emerald-600' : summary.overallRate >= 45 ? 'text-yellow-600' : 'text-red-600'}`}>
                %{summary.overallRate}
              </div>
              <p className="text-xs text-muted-foreground mt-1">genel oran</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Type Performance Breakdown */}
      {summary && Object.keys(summary.typeStats).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Per-Type Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Tahmin Tipi Bazli Performans
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(summary.typeStats).map(([type, stats]) => {
                  const evaluated = stats.won + stats.lost;
                  return (
                    <div key={type} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{typeLabels[type] || type}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {stats.won}W / {stats.lost}L ({stats.total} toplam)
                          </span>
                          <Badge className={stats.rate >= 55 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : stats.rate >= 45 ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}>
                            %{Math.round(stats.rate * 10) / 10}
                          </Badge>
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5">
                        <div
                          className={`h-2.5 rounded-full transition-all ${stats.rate >= 55 ? 'bg-emerald-500' : stats.rate >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(100, stats.rate)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Per-Tier Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Guven Seviyesi Bazli Performans
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(summary.tierStats)
                  .sort((a, b) => {
                    const order = ['platinum', 'gold', 'silver', 'unknown'];
                    return order.indexOf(a[0]) - order.indexOf(b[0]);
                  })
                  .map(([tier, stats]) => {
                    const tierLabel = tier === 'platinum' ? 'Platinum' : tier === 'gold' ? 'Gold' : tier === 'silver' ? 'Silver' : 'Diger';
                    const tierIcon = tier === 'platinum' ? <Award className="w-4 h-4 text-purple-500" /> : tier === 'gold' ? <Trophy className="w-4 h-4 text-yellow-500" /> : <Shield className="w-4 h-4 text-gray-500" />;
                    return (
                      <div key={tier} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {tierIcon}
                            <span className="text-sm font-medium">{tierLabel}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {stats.won}W / {stats.lost}L ({stats.total} toplam)
                            </span>
                            <Badge className={stats.rate >= 55 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : stats.rate >= 45 ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}>
                              %{Math.round(stats.rate * 10) / 10}
                            </Badge>
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full transition-all ${stats.rate >= 55 ? 'bg-emerald-500' : stats.rate >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(100, stats.rate)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Baslangic</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Bitis</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tip</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 text-sm border rounded-md bg-background h-10"
              >
                <option value="">Tumu</option>
                <option value="match_winner">Mac Sonucu</option>
                <option value="ensemble">Ensemble</option>
                <option value="both_teams_score">KG</option>
                <option value="over_under_goals">Ust/Alt</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Sonuc</label>
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                className="px-3 py-2 text-sm border rounded-md bg-background h-10"
              >
                <option value="">Tumu</option>
                <option value="won">Kazanan</option>
                <option value="lost">Kaybeden</option>
                <option value="pending">Bekleyen</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tier</label>
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value)}
                className="px-3 py-2 text-sm border rounded-md bg-background h-10"
              >
                <option value="">Tumu</option>
                <option value="platinum">Platinum</option>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setDateFrom(''); setDateTo(''); setTypeFilter(''); setOutcomeFilter(''); setTierFilter(''); }}
              className="h-10"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Temizle
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Predictions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Tahmin Gecmisi
            {summary && (
              <Badge variant="secondary" className="ml-2">
                {summary.total} tahmin
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
              <div className="text-lg">Yukleniyor...</div>
            </div>
          ) : predictions.length === 0 ? (
            <div className="text-center py-12">
              <Target className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <div className="text-lg font-medium">Tahmin bulunamadi</div>
              <p className="text-muted-foreground mt-1">Filtreleri degistirmeyi deneyin</p>
            </div>
          ) : (
            <div className="space-y-3">
              {predictions.map((p) => (
                <Link href={`/predictions/${p.matchId}`} key={p.id}>
                  <div className={`flex items-center gap-4 p-4 rounded-lg border transition-all hover:shadow-md cursor-pointer ${getOutcomeBg(p.isCorrect)}`}>
                    {/* Outcome icon */}
                    <div className="flex-shrink-0">
                      {getOutcomeIcon(p.isCorrect)}
                    </div>

                    {/* Match info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {p.match.homeTeam.logo && (
                          <Image src={p.match.homeTeam.logo} alt="" width={16} height={16} className="rounded" />
                        )}
                        <span className="text-sm font-medium truncate">{p.match.homeTeam.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {p.match.homeGoals !== null ? `${p.match.homeGoals} - ${p.match.awayGoals}` : 'vs'}
                        </span>
                        <span className="text-sm font-medium truncate">{p.match.awayTeam.name}</span>
                        {p.match.awayTeam.logo && (
                          <Image src={p.match.awayTeam.logo} alt="" width={16} height={16} className="rounded" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{p.match.league.name}</span>
                        <span>-</span>
                        <span>{new Date(p.match.date).toLocaleDateString('tr-TR')}</span>
                      </div>
                    </div>

                    {/* Prediction detail */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">{typeLabels[p.predictionType] || p.predictionType}</div>
                        <div className="text-sm font-medium">{valueLabels[p.predictedValue] || p.predictedValue}</div>
                      </div>
                      {p.confidenceTier && (
                        <Badge className={`text-xs border ${tierColors[p.confidenceTier] || ''}`}>
                          {p.confidenceTier}
                        </Badge>
                      )}
                      <Badge className={`text-xs ${p.isCorrect === true ? 'bg-emerald-500 text-white' : p.isCorrect === false ? 'bg-red-500 text-white' : 'bg-yellow-500 text-white'}`}>
                        {getOutcomeLabel(p.isCorrect)}
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <Button
                onClick={() => fetchHistory(Math.max(1, page - 1))}
                disabled={page === 1}
                variant="outline"
                size="sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-4">
                Sayfa {page} / {totalPages}
              </span>
              <Button
                onClick={() => fetchHistory(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                variant="outline"
                size="sm"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
