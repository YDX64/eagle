'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Flame, TrendingUp, Trophy, Target, RefreshCw,
  CheckCircle2, XCircle, DollarSign, Zap,
} from 'lucide-react';

interface OddsRange {
  range: string; total: number; hits: number; misses: number;
  avgOdds: number; maxOdds: number; minOdds: number; accuracy: number;
}

interface TopMarket {
  market: string; label: string; total: number; hits: number;
  accuracy: number; avgOdds: number;
}

interface Pick {
  sport: string; fixtureId: number;
  homeTeam: string; awayTeam: string; league: string;
  matchDate: string; score: string | null;
  market: string; marketLabel: string; pickLabel: string; category: string;
  probability: number; marketOdds: number;
  hit: boolean | null; isBest: boolean;
}

interface WinnerStats {
  total: number; avgOdds: number; maxOdds: number;
}

export default function HighOddsWinnersPage() {
  const [ranges, setRanges] = useState<OddsRange[]>([]);
  const [topMarkets, setTopMarkets] = useState<TopMarket[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [winnerStats, setWinnerStats] = useState<WinnerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [minOdds, setMinOdds] = useState('3.0');
  const [onlyWinners, setOnlyWinners] = useState(true);
  const [sportFilter, setSportFilter] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        minOdds,
        onlyWinners: onlyWinners.toString(),
        limit: '100',
      });
      if (sportFilter) params.set('sport', sportFilter);
      const res = await fetch('/api/probet/high-odds-winners?' + params);
      const data = await res.json();
      if (data.success) {
        setRanges(data.data.oddsRangeStats || []);
        setTopMarkets(data.data.topMarkets || []);
        setPicks(data.data.picks || []);
        setWinnerStats(data.data.winnerStats || null);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [minOdds, onlyWinners, sportFilter]);

  const sportLabels: Record<string, string> = {
    football: 'Futbol', basketball: 'Basketbol', hockey: 'Hokey',
    volleyball: 'Voleybol', handball: 'Hentbol',
  };

  const pctColor = (p: number) =>
    p >= 70 ? 'text-emerald-600 bg-emerald-500/15 border-emerald-500/40' :
    p >= 55 ? 'text-blue-600 bg-blue-500/15 border-blue-500/40' :
    p >= 45 ? 'text-yellow-600 bg-yellow-500/15 border-yellow-500/40' :
    'text-red-600 bg-red-500/15 border-red-500/40';

  const oddsColor = (odd: number) =>
    odd >= 5 ? 'text-red-600 font-bold' :
    odd >= 3 ? 'text-orange-600 font-bold' :
    odd >= 2 ? 'text-yellow-600 font-semibold' : 'text-primary';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors"><div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Ana Sayfa</Button></Link>
        <h1 className="text-2xl font-bold flex items-center gap-2 mt-2">
          <Flame className="w-7 h-7 text-orange-500" />Yuksek Oranli Kazananlar
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Bitmis ve kazanan yuksek oranli tahminler — sistem kupon secimi icin
        </p>
      </div>

      {/* Odds Range Overview - THE KEY INSIGHT */}
      <Card className="mb-6 border-orange-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="w-5 h-5 text-orange-500" />
            Oran Araligina Gore Basari Orani
            <Badge variant="outline" className="text-xs ml-2">En onemli analiz</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {ranges.map(r => (
              <div key={r.range} className={'p-3 rounded-lg border ' + (r.accuracy >= 70 ? 'bg-emerald-500/10 border-emerald-500/40' : r.accuracy >= 50 ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-red-500/10 border-red-500/40')}>
                <div className="text-xs text-muted-foreground">Oran</div>
                <div className="text-lg font-bold">{r.range}</div>
                <div className="text-2xl font-bold mt-1">%{r.accuracy}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {r.hits}W / {r.misses}L ({r.total} pick)
                </div>
                <div className="text-[10px] text-muted-foreground">ort: {r.avgOdds}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Winner Summary */}
      {winnerStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <Card className="border-emerald-500/30"><CardContent className="pt-5">
            <div className="flex items-center gap-1 mb-1"><Trophy className="w-4 h-4 text-emerald-500" /><span className="text-xs text-muted-foreground">Yuksek Oranli Kazanan Pick</span></div>
            <div className="text-3xl font-bold text-emerald-600">{winnerStats.total}</div>
            <div className="text-[10px] text-muted-foreground">oran &gt;= {minOdds}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-5">
            <div className="flex items-center gap-1 mb-1"><TrendingUp className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Ortalama Oran</span></div>
            <div className="text-3xl font-bold">{winnerStats.avgOdds}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-5">
            <div className="flex items-center gap-1 mb-1"><Flame className="w-4 h-4 text-red-500" /><span className="text-xs text-muted-foreground">En Yuksek Oran</span></div>
            <div className="text-3xl font-bold text-red-600">{winnerStats.maxOdds}</div>
          </CardContent></Card>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div>
              <label className="text-[10px] text-muted-foreground block">Min Oran</label>
              <Input type="number" step="0.5" min="1" value={minOdds} onChange={e => setMinOdds(e.target.value)} className="w-24 h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block">Sadece</label>
              <select value={onlyWinners.toString()} onChange={e => setOnlyWinners(e.target.value === 'true')} className="h-8 text-xs border rounded-md px-2 bg-background">
                <option value="true">Kazananlar</option>
                <option value="false">Hepsi</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block">Spor</label>
              <select value={sportFilter} onChange={e => setSportFilter(e.target.value)} className="h-8 text-xs border rounded-md px-2 bg-background">
                <option value="">Tumu</option>
                <option value="football">Futbol</option>
                <option value="basketball">Basketbol</option>
                <option value="hockey">Hokey</option>
                <option value="volleyball">Voleybol</option>
                <option value="handball">Hentbol</option>
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} className="mt-4">
              {loading ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
              Yenile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Top performing high-odds markets */}
      {topMarkets.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />En Iyi Yuksek Oranli Marketler (oran &gt;= 2.0)
          </CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {topMarkets.map(m => (
                <div key={m.market + m.label} className="flex items-center gap-2 p-2 rounded border bg-muted/10 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{m.label}</div>
                    <div className="text-[10px] text-muted-foreground">{m.hits}/{m.total} — ort oran {m.avgOdds}</div>
                  </div>
                  <Badge className={'text-[10px] shrink-0 border ' + pctColor(m.accuracy)}>%{m.accuracy}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pick list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-emerald-500" />
            Kazanan Picks (oran &gt;= {minOdds})
            <Badge variant="secondary" className="text-xs ml-2">{picks.length} pick</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" /><div className="text-sm">Yukleniyor...</div></div>
          ) : picks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Kayit bulunamadi</div>
          ) : (
            <div className="space-y-1.5">
              {picks.map((p, i) => (
                <div key={i} className={'flex items-center gap-3 p-3 rounded-lg border text-sm ' + (p.hit === true ? 'bg-emerald-500/5 border-emerald-500/30' : p.hit === false ? 'bg-red-500/5 border-red-500/30' : 'bg-yellow-500/5 border-yellow-500/30')}>
                  <div className="shrink-0">
                    {p.hit === true ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : p.hit === false ? <XCircle className="w-5 h-5 text-red-500" /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{sportLabels[p.sport] || p.sport}</Badge>
                      <span className="font-medium truncate">{p.homeTeam} vs {p.awayTeam}</span>
                      {p.score && <span className="text-xs font-bold">({p.score})</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {p.league} — {new Date(p.matchDate).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-medium truncate max-w-[180px]">{p.pickLabel}</div>
                    <div className="text-[10px] text-muted-foreground">{p.marketLabel} • %{(p.probability * 100).toFixed(0)}</div>
                  </div>
                  <div className={'text-lg shrink-0 ' + oddsColor(p.marketOdds)}>
                    @{p.marketOdds.toFixed(2)}
                  </div>
                  {p.isBest && <Badge className="text-[8px] bg-primary/20 text-primary shrink-0">BEST</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </main>
  );
}
