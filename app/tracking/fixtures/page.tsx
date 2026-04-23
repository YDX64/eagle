'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock } from 'lucide-react';

const SPORTS = [
  { code: 'all', label: 'Tümü' },
  { code: 'football', label: 'Futbol' },
  { code: 'basketball', label: 'Basketbol' },
  { code: 'nba', label: 'NBA' },
  { code: 'hockey', label: 'Buz Hokeyi' },
  { code: 'handball', label: 'Hentbol' },
  { code: 'volleyball', label: 'Voleybol' },
];

const STATUSES = [
  { code: 'all', label: 'Tümü' },
  { code: 'resolved', label: 'Sonuçlandı' },
  { code: 'pending', label: 'Bekliyor' },
];

interface PredictionRow {
  id: string;
  sport: string;
  fixture_id: number;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
  match_date: string | null;
  status: string;
  best_market: string | null;
  best_pick_label: string | null;
  best_probability: number | null;
  best_pick_hit: boolean | null;
  actual_home: number | null;
  actual_away: number | null;
  confidence: number | null;
  picks: Array<{
    id: number;
    market: string;
    market_label: string | null;
    pick_label: string | null;
    probability: number | null;
    market_odds: number | null;
    hit: boolean | null;
    is_best: boolean | null;
  }>;
}

export default function FixturesPage() {
  const [sport, setSport] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<PredictionRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: '30',
    });
    if (sport !== 'all') params.set('sport', sport);
    if (status !== 'all') params.set('status', status);
    fetch(`/api/tracking/predictions?${params}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (j?.success) {
          setData(j.data);
          setTotal(j.pagination?.total ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [sport, status, page]);

  const filtered = data.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.home_team?.toLowerCase().includes(q) ||
      r.away_team?.toLowerCase().includes(q) ||
      r.league?.toLowerCase().includes(q) ||
      r.best_market?.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.ceil(total / 30);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Maç Tahminleri — Kazandı / Kaybetti</h2>
        <p className="text-sm text-muted-foreground">
          Tüm sporlar, her maç için kaydedilen tahminler ve sonuçlar. Sütun başlıklarına tıklayarak detaya in.
        </p>
      </div>

      <Card className="bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Spor</label>
              <Select value={sport} onValueChange={v => { setSport(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SPORTS.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Durum</label>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">Arama</label>
              <Input
                placeholder="Takım, lig, market ara…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">
            {loading ? 'Yükleniyor…' : `${total.toLocaleString('tr-TR')} tahmin · Sayfa ${page}/${totalPages || 1}`}
          </CardTitle>
          <div className="flex gap-1">
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              ← Önceki
            </button>
            <button
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              Sonraki →
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sonuç yok — filtreleri değiştir.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(row => {
                const isExpanded = expandedId === row.id;
                const settledPicks = row.picks.filter(p => p.hit !== null);
                const wonPicks = settledPicks.filter(p => p.hit === true);
                const lostPicks = settledPicks.filter(p => p.hit === false);
                const pendingPicks = row.picks.filter(p => p.hit === null);
                const winRate = settledPicks.length > 0 ? wonPicks.length / settledPicks.length : null;
                const bestHit = row.best_pick_hit;
                const isResolved = row.status === 'resolved';

                return (
                  <div
                    key={row.id}
                    className={`rounded-lg border transition-colors ${
                      isResolved && bestHit === true
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : isResolved && bestHit === false
                          ? 'border-rose-500/40 bg-rose-500/5'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                    }`}
                  >
                    <button
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50/50 dark:hover:bg-slate-800/30 rounded-lg"
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    >
                      <span className="text-slate-400">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                      <Badge variant="outline" className="text-xs uppercase font-semibold">
                        {row.sport}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {row.home_team} <span className="text-muted-foreground">vs</span> {row.away_team}
                          {row.actual_home != null && row.actual_away != null && (
                            <span className="ml-2 text-xs font-bold">
                              {row.actual_home}-{row.actual_away}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {row.league} · {row.match_date ? new Date(row.match_date).toLocaleString('tr-TR') : '—'}
                        </div>
                      </div>
                      {row.best_pick_label && (
                        <div className="hidden md:block text-xs max-w-[220px] truncate text-slate-600 dark:text-slate-400">
                          {row.best_pick_label}
                        </div>
                      )}
                      {/* Result badge */}
                      {isResolved ? (
                        bestHit === true ? (
                          <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 border">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Kazandı %{winRate ? Math.round(winRate * 100) : 0}
                          </Badge>
                        ) : bestHit === false ? (
                          <Badge className="bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40 border">
                            <XCircle className="w-3 h-3 mr-1" /> Kaybetti %{winRate ? Math.round(winRate * 100) : 0}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Sonuçlandı</Badge>
                        )
                      ) : (
                        <Badge className="bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/40 border">
                          <Clock className="w-3 h-3 mr-1" /> Bekliyor
                        </Badge>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2 text-xs">
                        <div className="grid grid-cols-4 gap-3 text-center">
                          <div>
                            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{wonPicks.length}</div>
                            <div className="text-muted-foreground">Kazandı</div>
                          </div>
                          <div>
                            <div className="text-lg font-bold text-rose-600 dark:text-rose-400">{lostPicks.length}</div>
                            <div className="text-muted-foreground">Kaybetti</div>
                          </div>
                          <div>
                            <div className="text-lg font-bold text-sky-600 dark:text-sky-400">{pendingPicks.length}</div>
                            <div className="text-muted-foreground">Bekliyor</div>
                          </div>
                          <div>
                            <div className="text-lg font-bold text-slate-700 dark:text-slate-300">
                              {winRate != null ? `%${Math.round(winRate * 100)}` : '—'}
                            </div>
                            <div className="text-muted-foreground">İsabet</div>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                          <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1.5">
                            Tüm marketler ({row.picks.length})
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                            {row.picks.map(p => (
                              <div
                                key={p.id}
                                className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${
                                  p.hit === true
                                    ? 'bg-emerald-500/10 border-l-2 border-emerald-500'
                                    : p.hit === false
                                      ? 'bg-rose-500/10 border-l-2 border-rose-500'
                                      : 'bg-slate-500/5 border-l-2 border-slate-300 dark:border-slate-600'
                                }`}
                              >
                                {p.is_best && <span className="text-amber-500" title="En iyi pick">★</span>}
                                <span className="flex-1 truncate">{p.pick_label ?? p.market_label ?? p.market}</span>
                                <span className="text-muted-foreground">
                                  {p.probability != null ? `%${Math.round(p.probability * 100)}` : '—'}
                                </span>
                                {p.market_odds != null && (
                                  <span className="font-mono text-slate-500">{p.market_odds.toFixed(2)}</span>
                                )}
                                {p.hit === true && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                                {p.hit === false && <XCircle className="w-3 h-3 text-rose-600" />}
                              </div>
                            ))}
                          </div>
                        </div>
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
