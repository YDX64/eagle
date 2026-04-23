'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Flame, Trophy, Target, Zap, RefreshCw, TrendingUp, Star, AlertCircle,
} from 'lucide-react';

interface MatchBase {
  id: string;
  sport: string;
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  confidence: number | null;
  bestMarket: string;
  bestPickLabel: string;
  bestProbability: number | null;
  bestMarketOdds: number | null;
  bestExpectedValue: number | null;
}

interface MarketRow extends MatchBase {
  pick: {
    market: string;
    marketLabel: string;
    pickLabel: string;
    category: string;
    probability: number | null;
    marketOdds: number | null;
    expectedValue: number | null;
    isBest: boolean;
  };
}

interface BankoRow extends MatchBase {
  pattern: {
    id: string;
    name: string;
    category: string;
    isBanko: boolean;
    predictedMarket: string;
    hitRate: number | null;
    sampleSize: number | null;
  };
}

interface SystemRow extends MatchBase {
  system: {
    category: string;
    riskLevel: string;
    market: string;
    pickLabel: string;
    modelProbability: number | null;
    marketOdds: number | null;
    expectedValue: number | null;
    kellyStake: number | null;
  };
}

interface BulkData {
  banko: BankoRow[];
  highRoiMarkets: MarketRow[];
  systemBets: SystemRow[];
  totals: {
    pendingPredictions: number;
    bankoMatches: number;
    marketMatches: number;
    systemMatches: number;
  };
  filters: {
    markets: string[];
    patterns: string[];
    systemKeys: string[];
  };
}

const SPORTS = [
  { value: 'all', label: 'Tüm Sporlar' },
  { value: 'football', label: 'Futbol' },
  { value: 'basketball', label: 'Basketbol' },
  { value: 'hockey-2', label: 'Hockey 2' },
];

const TABS = [
  { id: 'banko' as const, label: 'BANKO Kalıplar', icon: Trophy, color: 'text-yellow-500' },
  { id: 'markets' as const, label: 'Yüksek ROI Marketler', icon: TrendingUp, color: 'text-green-500' },
  { id: 'systems' as const, label: 'Sistem Kuponları', icon: Star, color: 'text-purple-500' },
];

const MARKET_ROI: Record<string, { roi: string; winrate: string }> = {
  AH_AWAY_PLUS_1: { roi: '+161%', winrate: '%91' },
  OVER_25: { roi: '+61%', winrate: '%73' },
  HOME_WIN: { roi: '+15%', winrate: '%72' },
  UNDER_35: { roi: '+1%', winrate: '%76' },
  AH_HOME_PLUS_1: { roi: '+4%', winrate: '%94' },
  UNDER_55: { roi: 'n/a', winrate: '%94' },
  AWAY_UNDER_25: { roi: 'n/a', winrate: '%87' },
  UNDER_45: { roi: 'n/a', winrate: '%85' },
  OVER_15: { roi: '-6%', winrate: '%80' },
  HOME_UNDER_25: { roi: 'n/a', winrate: '%82' },
};

const SYSTEM_ROI: Record<string, string> = {
  'GOAL_VALUE::high': '+98.0%',
  'UPSET::medium': '+82.8%',
  'HTFT::medium': '+14.3%',
  'HTFT::high': '+5.0%',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function SportBadge({ sport }: { sport: string }) {
  const map: Record<string, string> = {
    football: '⚽ Futbol',
    basketball: '🏀 Basket',
    'hockey-2': '🏒 Hockey',
  };
  return <Badge variant="outline" className="text-xs">{map[sport] || sport}</Badge>;
}

export default function TopluAnalizPage() {
  const [sport, setSport] = useState('all');
  const [days, setDays] = useState(3);
  const [tab, setTab] = useState<'banko' | 'markets' | 'systems'>('banko');
  const [data, setData] = useState<BulkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/probet/bulk-high-value?sport=${sport}&days=${days}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Hata');
      setData(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useState(() => { fetchData(); return 0; });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors">
      <div className="container mx-auto py-6 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Flame className="w-8 h-8 text-orange-500" />
              Toplu Yüksek Değer Analizi
            </h1>
            <p className="text-muted-foreground mt-1">
              Kanıtlanmış yüksek ROI ve BANKO filtreleriyle süzülmüş tahminler
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPORTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 gün</SelectItem>
                <SelectItem value="3">3 gün</SelectItem>
                <SelectItem value="7">7 gün</SelectItem>
                <SelectItem value="14">14 gün</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={fetchData} disabled={loading} size="sm">
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Yenile
            </Button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Bekleyen Tahmin</CardDescription>
              <CardTitle className="text-3xl">{data?.totals.pendingPredictions ?? '—'}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Trophy className="w-3 h-3 text-yellow-500" />
                BANKO Eşleşme
              </CardDescription>
              <CardTitle className="text-3xl text-yellow-600 dark:text-yellow-400">
                {data?.totals.bankoMatches ?? '—'}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-green-500/50 bg-green-500/5">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-green-500" />
                Yüksek ROI Market
              </CardDescription>
              <CardTitle className="text-3xl text-green-600 dark:text-green-400">
                {data?.totals.marketMatches ?? '—'}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-purple-500/50 bg-purple-500/5">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Star className="w-3 h-3 text-purple-500" />
                Sistem Kupon
              </CardDescription>
              <CardTitle className="text-3xl text-purple-600 dark:text-purple-400">
                {data?.totals.systemMatches ?? '—'}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {TABS.map(({ id, label, icon: Icon, color }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className={`w-4 h-4 ${color}`} />
              {label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <Card className="border-red-500/50 bg-red-500/5">
            <CardContent className="pt-6 flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              {error}
            </CardContent>
          </Card>
        )}

        {/* BANKO Tab */}
        {tab === 'banko' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                BANKO Kalıp Eşleşmeleri ({data?.banko.length ?? 0})
              </CardTitle>
              <CardDescription>
                İstatistiksel olarak kanıtlanmış yüksek başarı oranlı kalıplar
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.banko.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Bu pencerede BANKO eşleşmesi yok.
                </div>
              )}
              <div className="space-y-2">
                {data?.banko.map((row, idx) => (
                  <div
                    key={`${row.id}-${row.pattern.id}-${idx}`}
                    className="border rounded-lg p-3 hover:bg-muted/50 transition-colors flex flex-wrap items-center gap-3"
                  >
                    <div className="flex-1 min-w-[280px]">
                      <div className="font-medium flex items-center gap-2">
                        <SportBadge sport={row.sport} />
                        {row.homeTeam} <span className="text-muted-foreground">vs</span> {row.awayTeam}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {row.league} · {formatDate(row.matchDate)}
                      </div>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                        {row.pattern.isBanko && <Trophy className="w-3 h-3" />}
                        {row.pattern.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.pattern.predictedMarket} · %{((row.pattern.hitRate ?? 0) * 100).toFixed(1)}
                        {row.pattern.sampleSize ? ` (n=${row.pattern.sampleSize})` : ''}
                      </div>
                    </div>
                    {row.pattern.isBanko && (
                      <Badge className="bg-yellow-500 text-white">BANKO</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Markets Tab */}
        {tab === 'markets' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                Yüksek ROI Market Seçimleri ({data?.highRoiMarkets.length ?? 0})
              </CardTitle>
              <CardDescription>
                Tarihsel pozitif ROI kaydına sahip market'lerde model seçimleri
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.highRoiMarkets.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Bu pencerede yüksek ROI market seçimi yok.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="py-2">Maç</th>
                      <th className="py-2">Lig</th>
                      <th className="py-2 text-right">Tarih</th>
                      <th className="py-2">Market (ROI)</th>
                      <th className="py-2">Seçim</th>
                      <th className="py-2 text-right">Olasılık</th>
                      <th className="py-2 text-right">Oran</th>
                      <th className="py-2 text-right">EV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.highRoiMarkets.map((row, idx) => {
                      const roiInfo = MARKET_ROI[row.pick.market];
                      return (
                        <tr key={`${row.id}-${row.pick.market}-${idx}`} className="border-b hover:bg-muted/50">
                          <td className="py-2 font-medium">
                            <div className="flex items-center gap-2">
                              <SportBadge sport={row.sport} />
                              <span className="text-xs">{row.homeTeam} vs {row.awayTeam}</span>
                            </div>
                          </td>
                          <td className="py-2 text-xs text-muted-foreground max-w-[180px] truncate">{row.league}</td>
                          <td className="py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(row.matchDate)}
                          </td>
                          <td className="py-2">
                            <div className="font-mono text-xs">{row.pick.market}</div>
                            {roiInfo && <div className="text-xs text-green-600">{roiInfo.roi} · {roiInfo.winrate}</div>}
                          </td>
                          <td className="py-2 text-xs font-medium">{row.pick.pickLabel}</td>
                          <td className="py-2 text-right font-mono">
                            {row.pick.probability ? `${(row.pick.probability * 100).toFixed(1)}%` : '-'}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {row.pick.marketOdds ? row.pick.marketOdds.toFixed(2) : '-'}
                          </td>
                          <td className="py-2 text-right font-mono text-green-600">
                            {row.pick.expectedValue !== null ? `${(row.pick.expectedValue * 100).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Systems Tab */}
        {tab === 'systems' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="w-5 h-5 text-purple-500" />
                Sistem Kupon Adayları ({data?.systemBets.length ?? 0})
              </CardTitle>
              <CardDescription>
                Pozitif ROI kaydı olan sistem kategorilerinde yüksek değer bahisleri
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.systemBets.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Bu pencerede sistem kuponu adayı yok.
                </div>
              )}
              <div className="space-y-2">
                {data?.systemBets.map((row, idx) => {
                  const key = `${row.system.category}::${row.system.riskLevel}`;
                  const roi = SYSTEM_ROI[key];
                  return (
                    <div
                      key={`${row.id}-${idx}`}
                      className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[280px]">
                          <div className="font-medium flex items-center gap-2">
                            <SportBadge sport={row.sport} />
                            {row.homeTeam} <span className="text-muted-foreground">vs</span> {row.awayTeam}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {row.league} · {formatDate(row.matchDate)}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline">
                            {row.system.category} · {row.system.riskLevel}
                          </Badge>
                          {roi && <Badge className="bg-purple-500 text-white">ROI {roi}</Badge>}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs">
                        <span><span className="text-muted-foreground">Market:</span> <span className="font-mono">{row.system.market}</span></span>
                        <span><span className="text-muted-foreground">Seçim:</span> <span className="font-semibold">{row.system.pickLabel}</span></span>
                        <span><span className="text-muted-foreground">Olasılık:</span> <span className="font-mono">{((row.system.modelProbability ?? 0) * 100).toFixed(1)}%</span></span>
                        <span><span className="text-muted-foreground">Oran:</span> <span className="font-mono">{(row.system.marketOdds ?? 0).toFixed(2)}</span></span>
                        <span><span className="text-muted-foreground">EV:</span> <span className="font-mono text-green-600">{((row.system.expectedValue ?? 0) * 100).toFixed(1)}%</span></span>
                        {row.system.kellyStake !== null && (
                          <span><span className="text-muted-foreground">Kelly:</span> <span className="font-mono">%{((row.system.kellyStake ?? 0) * 100).toFixed(1)}</span></span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
