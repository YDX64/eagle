'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Snowflake, Trophy, TrendingUp, Zap, Shield, Flame,
  RefreshCw, CheckCircle2, Ticket, BarChart3, Target, ChevronDown, ChevronUp,
} from 'lucide-react';

interface Recommendation {
  pick: string;
  side: 'home' | 'draw' | 'away';
  odds: number;
  fairProb: number;
  ev: number;
  tier: string;
  reason: string;
  match: {
    matchId: number;
    homeTeam: string;
    awayTeam: string;
    league: string;
    time: string;
    oddsHome: number;
    oddsDraw: number;
    oddsAway: number;
  };
}

interface Data {
  generatedAt: string;
  totalMatches: number;
  matchesWithPicks: number;
  totalPicks: number;
  safeFavorites: Recommendation[];
  value: Recommendation[];
  highOdds: Recommendation[];
  drawValue: Recommendation[];
  suggestedCoupon: {
    picks: Recommendation[];
    minOddsIfThreeWin: number;
    systemType: string;
  };
  allMatches: any[];
}

export default function IddaaHockeyPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/probet/iddaa-hockey');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Veri alınamadı');
      }
    } catch (e) {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const PickCard = ({ p, accent }: { p: Recommendation; accent: string }) => (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${accent}`}>
      <div className="text-xs font-mono bg-muted/60 px-2 py-1 rounded shrink-0">{p.match.time}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] shrink-0">{p.match.league}</Badge>
          <span className="text-sm font-medium truncate">{p.match.homeTeam}</span>
          <span className="text-xs text-muted-foreground">vs</span>
          <span className="text-sm font-medium truncate">{p.match.awayTeam}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">{p.reason}</div>
        <div className="text-[10px] text-muted-foreground flex gap-3 mt-1">
          <span>MS1: @{p.match.oddsHome.toFixed(2)}</span>
          {p.match.oddsDraw > 0 && <span>0: @{p.match.oddsDraw.toFixed(2)}</span>}
          <span>MS2: @{p.match.oddsAway.toFixed(2)}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-medium">{p.pick}</div>
        <div className="flex items-center gap-2 mt-0.5 justify-end">
          <span className="text-[10px] text-muted-foreground">%{(p.fairProb * 100).toFixed(0)}</span>
          <Badge className={`text-xs font-bold ${
            p.odds >= 3 ? 'bg-red-500/15 text-red-700 border-red-500/40' :
            p.odds >= 2 ? 'bg-orange-500/15 text-orange-700 border-orange-500/40' :
            'bg-emerald-500/15 text-emerald-700 border-emerald-500/40'
          }`}>@{p.odds.toFixed(2)}</Badge>
          {p.ev > 0 && <Badge className="text-[9px] bg-emerald-500/20 text-emerald-700">EV+{(p.ev * 100).toFixed(0)}%</Badge>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Ana Sayfa</Button></Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 mt-2">
            <Snowflake className="w-7 h-7 text-cyan-500" />
            iddaa Buz Hokeyi Tahminleri
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            iddaa.com program verisi ile EV analizi — her gün güncel
          </p>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline">
          {loading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Yenile
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded bg-red-500/10 border border-red-500/30 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
          <div>iddaa verisi çekiliyor ve analiz ediliyor...</div>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Toplam Maç</div>
              <div className="text-2xl font-bold">{data.totalMatches}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Analiz Edilen</div>
              <div className="text-2xl font-bold text-cyan-600">{data.matchesWithPicks}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Güvenli Favori</div>
              <div className="text-2xl font-bold text-emerald-600">{data.safeFavorites.length}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Değer Tahmin</div>
              <div className="text-2xl font-bold text-orange-600">{data.value.length}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Yüksek Oran</div>
              <div className="text-2xl font-bold text-red-600">{data.highOdds.length}</div>
            </CardContent></Card>
          </div>

          {data.suggestedCoupon.picks.length >= 3 && (
            <Card className="mb-6 border-primary/40 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Ticket className="w-5 h-5 text-primary" />
                  Önerilen Sistem Kupon ({data.suggestedCoupon.systemType})
                  {data.suggestedCoupon.minOddsIfThreeWin > 0 && (
                    <Badge className="ml-2 bg-emerald-500 text-white">
                      3 tutarsa min {data.suggestedCoupon.minOddsIfThreeWin.toFixed(1)}x
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.suggestedCoupon.picks.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded bg-background">
                      <span className="text-xs bg-primary/15 text-primary px-2 py-1 rounded font-bold">#{i + 1}</span>
                      <div className="flex-1 min-w-0 text-sm">
                        <span className="font-medium">{p.match.homeTeam}</span>
                        <span className="text-muted-foreground mx-1">vs</span>
                        <span className="font-medium">{p.match.awayTeam}</span>
                        <span className="text-[10px] text-muted-foreground ml-2">[{p.match.league} {p.match.time}]</span>
                      </div>
                      <div className="text-sm font-medium">{p.pick}</div>
                      <Badge className="font-bold">@{p.odds.toFixed(2)}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.safeFavorites.length > 0 && (
            <Card className="mb-4">
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-500" />
                Güvenli Favoriler (oran &lt;= 1.90)
                <Badge variant="secondary" className="ml-2">{data.safeFavorites.length}</Badge>
              </CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.safeFavorites.slice(0, 10).map((p, i) => (
                    <PickCard key={i} p={p} accent="bg-emerald-500/5 border-emerald-500/30" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.value.length > 0 && (
            <Card className="mb-4">
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-500" />
                Değer Tahminleri (oran 1.90-3.20, EV+)
                <Badge variant="secondary" className="ml-2">{data.value.length}</Badge>
              </CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.value.slice(0, 10).map((p, i) => (
                    <PickCard key={i} p={p} accent="bg-orange-500/5 border-orange-500/30" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.highOdds.length > 0 && (
            <Card className="mb-4">
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <Flame className="w-5 h-5 text-red-500" />
                Yüksek Oranlı (oran &gt;= 3.0, sistem kupon için)
                <Badge variant="secondary" className="ml-2">{data.highOdds.length}</Badge>
              </CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.highOdds.slice(0, 10).map((p, i) => (
                    <PickCard key={i} p={p} accent="bg-red-500/5 border-red-500/30" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.drawValue.length > 0 && (
            <Card className="mb-4">
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <Target className="w-5 h-5 text-yellow-500" />
                Beraberlik Değer (hokeyde uzatma var)
                <Badge variant="secondary" className="ml-2">{data.drawValue.length}</Badge>
              </CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.drawValue.slice(0, 6).map((p, i) => (
                    <PickCard key={i} p={p} accent="bg-yellow-500/5 border-yellow-500/30" />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <button
                type="button"
                onClick={() => setShowAllMatches(!showAllMatches)}
                className="w-full flex items-center justify-between"
              >
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Tüm Maçlar ({data.allMatches.length})
                </CardTitle>
                {showAllMatches ? <ChevronUp /> : <ChevronDown />}
              </button>
            </CardHeader>
            {showAllMatches && (
              <CardContent>
                <div className="space-y-1.5">
                  {data.allMatches.map((m: any) => (
                    <div key={m.matchId} className="flex items-center gap-3 p-2 rounded bg-muted/20 text-xs">
                      <span className="font-mono shrink-0">{m.time}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{m.league}</Badge>
                      <span className="flex-1 truncate">{m.homeTeam} vs {m.awayTeam}</span>
                      <span className="font-mono text-emerald-600">{m.oddsHome.toFixed(2)}</span>
                      <span className="font-mono text-muted-foreground">{m.oddsDraw > 0 ? m.oddsDraw.toFixed(2) : '-'}</span>
                      <span className="font-mono text-blue-600">{m.oddsAway.toFixed(2)}</span>
                      <Badge className="text-[9px]">{m.recommendations.length} pick</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          <div className="text-[10px] text-muted-foreground mt-4 text-center">
            Veri: iddaa.com • Güncellenme: {new Date(data.generatedAt).toLocaleString('tr-TR')}
          </div>
        </>
      )}
    </div>
  );
}
