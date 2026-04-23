'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Ticket,
  TrendingUp,
  Shield,
  Zap,
  DollarSign,
  Target,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Trophy,
} from 'lucide-react';

interface Pick {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  predictionType: string;
  predictedValue: string;
  displayLabel: string;
  odds: number;
  confidenceScore: number;
  reasoning: string;
}

interface ReturnScenario {
  hitsNeeded: number;
  winningCombos: number;
  estimatedReturn: number;
  profit: number;
}

interface Coupon {
  id: string;
  name: string;
  picks: Pick[];
  systemType: string;
  totalCombinations: number;
  minHitsForProfit: number;
  stakePerCombo: number;
  totalStake: number;
  potentialReturns: ReturnScenario[];
  riskLevel: string;
  expectedROI: number;
  createdAt: string;
}

interface HistoricalPerf {
  type: string;
  total: number;
  correct: number;
  rate: number;
  avgConfidence: number;
}

export default function SystemCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [budget, setBudget] = useState('100');
  const [historical, setHistorical] = useState<HistoricalPerf[]>([]);
  const [availablePicks, setAvailablePicks] = useState(0);
  const [expandedCoupon, setExpandedCoupon] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchCoupons = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/system-coupons?date=${encodeURIComponent(date)}&budget=${encodeURIComponent(budget)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setCoupons(data.data.coupons);
          setHistorical(data.data.historicalPerformance || []);
          setAvailablePicks(data.data.availablePicks);
        } else {
          console.error('[system-coupons] API returned success=false:', data.error);
        }
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return;
        console.error('[system-coupons] fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [date, budget, refreshKey]);

  const riskColors: Record<string, string> = {
    low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40',
    medium: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/40',
    high: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40',
    very_high: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40',
  };

  const riskLabels: Record<string, string> = {
    low: 'Düşük Risk',
    medium: 'Orta Risk',
    high: 'Yüksek Risk',
    very_high: 'Çok Yüksek Risk',
  };

  const typeLabels: Record<string, string> = {
    match_winner: 'Maç Sonucu',
    ensemble: 'Ensemble',
    both_teams_score: 'KG',
    over_under_goals: 'Üst/Alt 2.5',
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Ana Sayfa
            </Button>
          </Link>
        </div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Ticket className="w-8 h-8 text-primary" />
          Sistem Kupon Motoru
        </h1>
        <p className="text-muted-foreground mt-1">
          Yuksek oranli tahminlerden otomatik sistem kuponlar olustur. 6 mactan 3'u tutarsa kar et.
        </p>
      </div>

      {/* Controls */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tarih</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Butce (birim)</label>
              <Input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-32"
                min="10"
                step="10"
              />
            </div>
            <Button onClick={fetchCoupons} disabled={loading}>
              {loading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
              Kupon Olustur
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Historical Performance */}
      {historical.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="w-5 h-5 text-primary" />
              Gecmis Performans (Referans)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {historical.map(h => (
                <div key={h.type} className="p-3 rounded-lg bg-muted/50">
                  <div className="text-xs text-muted-foreground">{typeLabels[h.type] || h.type}</div>
                  <div className={`text-xl font-bold ${h.rate >= 55 ? 'text-emerald-600' : h.rate >= 45 ? 'text-yellow-600' : 'text-red-600'}`}>
                    %{h.rate}
                  </div>
                  <div className="text-xs text-muted-foreground">{h.correct}/{h.total} dogru</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-blue-500 mt-0.5" />
          <div>
            <div className="font-medium text-blue-800 dark:text-blue-300">Sistem Kupon Nasil Calisir?</div>
            <div className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              Ornegin <strong>Sistem 3/6</strong>: 6 mac secer, tum 3'lu kombinasyonlari olusturur (20 adet).
              Her kombinasyon ayri bir kupondur. <strong>6 mactan 3'u bile tutsa en az 1 kupon kazanir.</strong>
              Yuksek oranli maclarla (3.0+) 3/6 tutsa bile butcenin katlarca fazlasi kazanilabilir.
            </div>
          </div>
        </div>
      </div>

      {/* Coupons */}
      {loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <div className="text-lg">Kuponlar olusturuluyor...</div>
        </div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-12">
          <Ticket className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <div className="text-lg font-medium">Yeterli yuksek oranli tahmin bulunamadi</div>
          <p className="text-muted-foreground mt-1">
            {availablePicks} adet yuksek oranli tahmin mevcut (minimum 4 gerekli).
            Farkli bir tarih secmeyi deneyin.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {coupons.map(coupon => (
            <Card key={coupon.id} className="overflow-hidden">
              <CardHeader
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedCoupon(expandedCoupon === coupon.id ? null : coupon.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Ticket className="w-6 h-6 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{coupon.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {coupon.picks.length} mac, {coupon.totalCombinations} kombinasyon
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={`border ${riskColors[coupon.riskLevel] || ''}`}>
                      <Shield className="w-3 h-3 mr-1" />
                      {riskLabels[coupon.riskLevel] || coupon.riskLevel}
                    </Badge>
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Toplam Yatirim</div>
                      <div className="text-lg font-bold">{coupon.totalStake} birim</div>
                    </div>
                    {expandedCoupon === coupon.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </div>
              </CardHeader>

              {expandedCoupon === coupon.id && (
                <CardContent className="border-t">
                  {/* Picks */}
                  <div className="mb-6">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Secilen Maclar
                    </h4>
                    <div className="space-y-2">
                      {coupon.picks.map((pick, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">
                                #{idx + 1}
                              </span>
                              <span className="font-medium text-sm">{pick.homeTeam} vs {pick.awayTeam}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {pick.league} | {new Date(pick.matchDate).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="text-xs">
                              {pick.displayLabel}
                            </Badge>
                            <div className="text-right">
                              <div className="text-sm font-bold text-primary">{pick.odds.toFixed(2)}</div>
                              <div className="text-xs text-muted-foreground">%{Math.round(pick.confidenceScore * 100)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Return Scenarios */}
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      Kazanc Senaryolari (Yatirim: {coupon.totalStake} birim)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {coupon.potentialReturns.map((scenario, idx) => (
                        <div
                          key={idx}
                          className={`p-4 rounded-lg border ${scenario.profit > 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800'}`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            {scenario.profit > 0 ? (
                              <CheckCircle className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-red-500" />
                            )}
                            <span className="font-medium text-sm">
                              {scenario.hitsNeeded}/{coupon.picks.length} Tutarsa
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {scenario.winningCombos} kupon kazanir
                          </div>
                          <div className={`text-xl font-bold mt-1 ${scenario.profit > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {scenario.profit > 0 ? '+' : ''}{scenario.profit.toFixed(0)} birim
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Toplam donus: {scenario.estimatedReturn.toFixed(0)} birim
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
