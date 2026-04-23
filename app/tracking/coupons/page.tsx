'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Ticket, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';

interface CouponLeg {
  id: number;
  sport: string;
  fixture_id: number;
  home_team: string | null;
  away_team: string | null;
  market: string;
  market_label: string | null;
  pick_label: string | null;
  probability: number | null;
  market_odds: number | null;
  hit: boolean | null;
}

interface Coupon {
  id: string;
  created_at: string;
  stake: number;
  total_odds: number;
  total_probability: number;
  expected_return: number;
  expected_value: number;
  risk_level: string;
  status: string;
  settled_at: string | null;
  note: string | null;
  legs: CouponLeg[];
}

const RISK_LABEL: Record<string, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek' };
const STATUS_LABEL: Record<string, string> = {
  pending: 'Beklemede',
  won: 'Kazandı',
  lost: 'Kaybetti',
  partial: 'Kısmi',
};

export default function CouponsPage() {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<Coupon[]>([]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    fetch('/api/tracking/coupons?limit=100', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => j?.success && setData(j.data))
      .finally(() => setLoading(false));
  }, []);

  const totalStaked = data.reduce((s, c) => s + c.stake, 0);
  const wonCoupons = data.filter(c => c.status === 'won');
  const totalWin = wonCoupons.reduce((s, c) => s + (c.expected_return ?? 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Ticket className="h-5 w-5" />
          Kuponlarım
        </h2>
        <p className="text-sm text-muted-foreground">
          Kayıtlı kuponlar — durum, kâr/zarar, bacak detayları.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Toplam Kupon</div>
          <div className="text-xl font-bold">{data.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Toplam Yatırım</div>
          <div className="text-xl font-bold">{totalStaked.toFixed(0)} ₺</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Kazanan</div>
          <div className="text-xl font-bold text-emerald-600">{wonCoupons.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Toplam Ödeme</div>
          <div className="text-xl font-bold text-emerald-600">{totalWin.toFixed(0)} ₺</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Kuponlar</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Henüz kaydedilmiş kupon yok. <a href="/tracking/high-odds" className="underline">Yüksek Oran</a> sayfasından kupon oluştur.
            </p>
          ) : (
            <div className="space-y-2">
              {data.map(c => {
                const isExpanded = expandedId === c.id;
                const isWon = c.status === 'won';
                const isLost = c.status === 'lost';
                return (
                  <div
                    key={c.id}
                    className={`rounded-lg border transition ${
                      isWon ? 'border-emerald-500/40 bg-emerald-500/5'
                        : isLost ? 'border-rose-500/40 bg-rose-500/5'
                          : 'border-border bg-card'
                    }`}
                  >
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/30 rounded-lg"
                    >
                      <span className="text-muted-foreground">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          {c.legs.length} bacaklı kupon · Oran {c.total_odds.toFixed(2)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(c.created_at).toLocaleString('tr-TR')} · Risk: {RISK_LABEL[c.risk_level] ?? c.risk_level}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Yatırım</div>
                        <div className="text-sm font-semibold">{c.stake.toFixed(0)} ₺</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Potansiyel</div>
                        <div className="text-sm font-semibold text-emerald-600">{c.expected_return.toFixed(0)} ₺</div>
                      </div>
                      {c.status === 'won' ? (
                        <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-500/40 border">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Kazandı
                        </Badge>
                      ) : c.status === 'lost' ? (
                        <Badge className="bg-rose-500/20 text-rose-700 border-rose-500/40 border">
                          <XCircle className="w-3 h-3 mr-1" /> Kaybetti
                        </Badge>
                      ) : (
                        <Badge className="bg-sky-500/20 text-sky-700 border-sky-500/40 border">
                          <Clock className="w-3 h-3 mr-1" /> {STATUS_LABEL[c.status] ?? c.status}
                        </Badge>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border p-3 space-y-1">
                        {c.note && (
                          <p className="text-xs italic text-muted-foreground">{c.note}</p>
                        )}
                        {c.legs.map(leg => (
                          <div
                            key={leg.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                              leg.hit === true ? 'bg-emerald-500/10 border-l-2 border-emerald-500'
                                : leg.hit === false ? 'bg-rose-500/10 border-l-2 border-rose-500'
                                  : 'bg-slate-500/5 border-l-2 border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            <span className="flex-1 truncate">
                              {leg.home_team} vs {leg.away_team}
                            </span>
                            <span className="text-muted-foreground">{leg.pick_label ?? leg.market}</span>
                            <span className="font-mono tabular-nums">{leg.market_odds?.toFixed(2) ?? '—'}</span>
                            {leg.hit === true && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                            {leg.hit === false && <XCircle className="w-3 h-3 text-rose-600" />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
