'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Zap, Trash2, Copy, Save } from 'lucide-react';

interface ValueBetRow {
  pick_id?: number | string;
  prediction_id: string;
  sport: string;
  fixture_id?: number;
  match_date: string | null;
  home_team: string | null;
  away_team: string | null;
  league: string | null;
  market: string;
  market_label: string | null;
  pick_label: string | null;
  probability: number | null;
  market_odds: number | null;
  expected_value: number | null;
  is_high_confidence: boolean | null;
}

const SPORTS = [
  { code: 'football', label: 'Futbol', icon: '⚽' },
  { code: 'basketball', label: 'Basketbol', icon: '🏀' },
  { code: 'nba', label: 'NBA', icon: '🏆' },
  { code: 'hockey', label: 'Hokey', icon: '🏒' },
  { code: 'handball', label: 'Hentbol', icon: '🤾' },
  { code: 'volleyball', label: 'Voleybol', icon: '🏐' },
  { code: 'baseball', label: 'Beyzbol', icon: '⚾' },
];

export default function HighOddsPage() {
  const [minOdds, setMinOdds] = React.useState(1.8);
  const [minProb, setMinProb] = React.useState(0.55);
  const [sports, setSports] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<ValueBetRow[]>([]);
  const [selected, setSelected] = React.useState<Map<string, ValueBetRow>>(new Map());
  const [stake, setStake] = React.useState(100);
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      min_probability: String(minProb),
      min_expected_value: '0.02',
      limit: '500',
    });
    if (sports.length > 0) params.set('sports', sports.join(','));
    fetch(`/api/tracking/value-bets?${params}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        const data: ValueBetRow[] = (j?.data ?? []).map((r: any) => ({
          ...r,
          pick_id: r.pick_id ?? r.id,
        }));
        const filtered = data.filter(r => (r.market_odds ?? 0) >= minOdds);
        filtered.sort((a, b) => (b.expected_value ?? 0) - (a.expected_value ?? 0));
        setRows(filtered);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [minOdds, minProb, sports]);

  React.useEffect(() => { load(); }, [load]);

  const toggleSport = (code: string) => {
    setSports(prev => (prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code]));
  };

  const toggleSelect = (row: ValueBetRow) => {
    const key = `${row.prediction_id}:${row.market}`;
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });
  };

  const picks = Array.from(selected.values());
  const totalOdds = picks.reduce((acc, p) => acc * (p.market_odds ?? 1), 1);
  const totalProb = picks.reduce((acc, p) => acc * (p.probability ?? 1), 1);
  const expectedReturn = stake * totalOdds;
  const expectedValue = stake * totalOdds * totalProb - stake;
  const riskLevel =
    picks.length <= 3 && totalOdds < 2
      ? 'Düşük'
      : picks.length <= 8 && totalOdds < 10
        ? 'Orta'
        : 'Yüksek';

  const handleSave = async () => {
    if (picks.length === 0) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/tracking/coupons/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stake,
          note: note || undefined,
          legs: picks.map(p => ({
            pick_id: p.pick_id,
            sport: p.sport,
            fixture_id: p.fixture_id ?? Number((p.prediction_id ?? '').split(':')[1] ?? 0),
            home_team: p.home_team,
            away_team: p.away_team,
            match_date: p.match_date,
            league: p.league,
            market: p.market,
            market_label: p.market_label,
            pick_label: p.pick_label,
            probability: p.probability,
            market_odds: p.market_odds,
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSaveMsg(`Kupon kaydedildi (${picks.length} bacak, ${totalOdds.toFixed(2)} oran)`);
        setSelected(new Map());
      } else {
        setSaveMsg(`Hata: ${json.error}`);
      }
    } catch (err) {
      setSaveMsg(`Hata: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    const text = picks
      .map(p => `${p.home_team} vs ${p.away_team} - ${p.pick_label ?? p.market} @ ${p.market_odds?.toFixed(2) ?? '?'}`)
      .join('\n');
    navigator.clipboard?.writeText(text);
    setSaveMsg('Panoya kopyalandı');
    setTimeout(() => setSaveMsg(null), 2500);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            Yüksek Oran Taraması
          </h2>
          <p className="text-sm text-muted-foreground">
            Pozitif edge + yüksek oranlı picks. Satırlara tıklayarak sağdaki kupon kasasına ekle.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Filtreler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground uppercase">
                  Min. Oran: {minOdds.toFixed(2)}
                </Label>
                <Slider
                  value={[minOdds * 100]}
                  min={100}
                  max={800}
                  step={5}
                  onValueChange={v => setMinOdds(v[0] / 100)}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase">
                  Min. Olasılık: %{(minProb * 100).toFixed(0)}
                </Label>
                <Slider
                  value={[minProb * 100]}
                  min={40}
                  max={90}
                  step={1}
                  onValueChange={v => setMinProb(v[0] / 100)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map(s => (
                <button
                  key={s.code}
                  onClick={() => toggleSport(s.code)}
                  className={`px-3 py-1 rounded-full text-xs border transition ${
                    sports.includes(s.code)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-foreground border-border hover:bg-accent'
                  }`}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-base">
              {loading ? 'Yükleniyor...' : `${rows.length} pick eşleşti`}
            </CardTitle>
            <Badge variant="secondary">Seçili: {picks.length}</Badge>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Filtrelere uyan bekleyen pick yok. Eşiği düşürmeyi dene.
              </p>
            ) : (
              <div className="rounded-md border overflow-auto max-h-[70vh]">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Maç</TableHead>
                      <TableHead>Market</TableHead>
                      <TableHead className="text-right">Olasılık</TableHead>
                      <TableHead className="text-right">Oran</TableHead>
                      <TableHead className="text-right">Edge</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(row => {
                      const key = `${row.prediction_id}:${row.market}`;
                      const sel = selected.has(key);
                      return (
                        <TableRow
                          key={key}
                          className={sel ? 'bg-amber-500/10' : ''}
                          onClick={() => toggleSelect(row)}
                        >
                          <TableCell className="w-10">
                            <Checkbox checked={sel} onCheckedChange={() => toggleSelect(row)} />
                          </TableCell>
                          <TableCell className="max-w-[240px]">
                            <div className="font-medium text-xs truncate">
                              {SPORTS.find(s => s.code === row.sport)?.icon} {row.home_team} vs {row.away_team}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {row.league} {row.match_date ? '· ' + new Date(row.match_date).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            <div className="text-xs font-medium truncate">
                              {row.pick_label ?? row.market_label ?? row.market}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            %{((row.probability ?? 0) * 100).toFixed(0)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums font-semibold">
                            {row.market_odds?.toFixed(2) ?? '-'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                            +%{((row.expected_value ?? 0) * 100).toFixed(1)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-1 space-y-3 lg:sticky lg:top-4 lg:self-start">
        <Card className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Kupon Kasası</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {picks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sol taraftan pick seç, buraya eklenir
              </p>
            ) : (
              <>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {picks.map(p => (
                    <div
                      key={`${p.prediction_id}:${p.market}`}
                      className="flex items-center gap-2 text-xs p-1.5 border border-amber-500/20 rounded bg-white/60 dark:bg-slate-900/40"
                    >
                      <span className="flex-1 truncate">
                        {p.home_team?.slice(0, 12)} vs {p.away_team?.slice(0, 12)}
                      </span>
                      <span className="font-mono tabular-nums">{p.market_odds?.toFixed(2)}</span>
                      <button onClick={() => toggleSelect(p)} className="text-rose-600 hover:text-rose-700">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-amber-500/20">
                  <div>
                    <div className="text-muted-foreground">Toplam Oran</div>
                    <div className="font-bold font-mono text-lg">{totalOdds.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Ort. Olasılık</div>
                    <div className="font-bold font-mono text-lg">%{(totalProb * 100).toFixed(1)}</div>
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <Label className="text-xs">Pay (TL)</Label>
                  <Input
                    type="number"
                    value={stake}
                    onChange={e => setStake(Number(e.target.value) || 0)}
                    min={1}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Muhtemel Kazanç</div>
                    <div className="font-bold text-emerald-700 dark:text-emerald-400">
                      {expectedReturn.toFixed(2)} TL
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Beklenen Değer</div>
                    <div className={`font-bold ${expectedValue >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {expectedValue >= 0 ? '+' : ''}{expectedValue.toFixed(2)} TL
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-muted-foreground">Risk</span>
                  <Badge
                    className={
                      riskLevel === 'Düşük'
                        ? 'bg-emerald-500/20 text-emerald-700 border-emerald-500/40'
                        : riskLevel === 'Orta'
                          ? 'bg-amber-500/20 text-amber-700 border-amber-500/40'
                          : 'bg-rose-500/20 text-rose-700 border-rose-500/40'
                    }
                  >
                    {riskLevel}
                  </Badge>
                </div>

                <Textarea
                  placeholder="Not (opsiyonel)..."
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="text-xs h-16"
                />

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button onClick={handleCopy} variant="outline" size="sm">
                    <Copy className="w-3 h-3 mr-1" />
                    Kopyala
                  </Button>
                  <Button onClick={handleSave} disabled={saving} size="sm">
                    <Save className="w-3 h-3 mr-1" />
                    {saving ? 'Kaydediliyor...' : 'Kaydet'}
                  </Button>
                </div>

                {saveMsg && (
                  <p className="text-xs text-center pt-1 text-muted-foreground">{saveMsg}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground">Nasıl çalışır?</div>
            <p>1. Solda pickleri incele, checkbox ile seç.</p>
            <p>2. Kasada toplam oran + beklenen kazanç canlı hesaplanır.</p>
            <p>3. Kaydet butonuna basıp <Link href="/tracking/coupons" className="underline">Kuponlarım</Link> sayfasından takip et.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
